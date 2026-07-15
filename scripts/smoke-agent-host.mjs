import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);
let stderr = "";

async function main() {
const binaryArgument = argument("--binary");
if (!binaryArgument) throw new Error("--binary <path> is required");
const binary = resolve(binaryArgument);
const maxStartupMs = positiveNumber(argument("--max-startup-ms") ?? "10000");
const maxRssMb = positiveNumber(argument("--max-rss-mb") ?? "200");
await access(binary, process.platform === "win32" ? constants.F_OK : constants.X_OK);

const startedAt = performance.now();
const child = spawn(binary, [], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-8_000);
});
const peer = new SmokePeer(child);
let modelCalls = 0;
let toolCalls = 0;
let graphCheckpointPuts = 0;
const graphCheckpoints = new Map();
const pendingGraphWrites = new Map();
let finalAnswer;
let resolveCompleted;
let rejectCompleted;
const completed = new Promise((resolvePromise, rejectPromise) => {
  resolveCompleted = resolvePromise;
  rejectCompleted = rejectPromise;
});

peer.register("model.complete", (request) => {
  modelCalls += 1;
  if (modelCalls === 1) {
    const names = Array.isArray(request?.tools)
      ? request.tools.map((tool) => tool?.name)
      : [];
    if (!names.includes("metadata.listObjects")) {
      throw new Error(`plan model did not receive the proxy tool: ${JSON.stringify(names)}`);
    }
    return {
      content: "",
      model: "smoke-model",
      finishReason: "tool_calls",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      toolCalls: [
        {
          id: "smoke-tool-call",
          name: "metadata.listObjects",
          args: { scope: "all" },
        },
      ],
    };
  }
  return {
    content: "Packaged Deep Agents runtime is ready.",
    model: "smoke-model",
    finishReason: "stop",
    usage: { inputTokens: 18, outputTokens: 8, totalTokens: 26 },
    toolCalls: [],
  };
});
peer.register("tool.invoke", (request) => {
  toolCalls += 1;
  if (request?.toolName !== "metadata.listObjects") {
    throw new Error(`unexpected proxy tool: ${String(request?.toolName)}`);
  }
  return {
    summary: "Found one smoke table.",
    data: { objects: [{ name: "smoke_table", type: "table" }] },
    rowCount: 1,
    byteCount: 64,
    truncated: false,
    artifactRef: null,
  };
});
peer.register("checkpoint.load", () => ({
  checkpointVersion: 1,
  checkpoint: null,
}));
peer.register("checkpoint.save", () => ({ saved: true }));
peer.register("graph.checkpoint.get", (request) => {
  const records = graphRecordsForScope(graphCheckpoints, request);
  const record = request?.checkpointId
    ? records.find((candidate) => candidate.checkpointId === request.checkpointId)
    : records.at(-1);
  return { record: record ?? null };
});
peer.register("graph.checkpoint.list", (request) => {
  let records = graphRecordsForScope(graphCheckpoints, request).reverse();
  if (request?.checkpointId) {
    records = records.filter(
      (candidate) => candidate.checkpointId === request.checkpointId,
    );
  }
  if (request?.beforeCheckpointId) {
    const beforeIndex = records.findIndex(
      (candidate) => candidate.checkpointId === request.beforeCheckpointId,
    );
    records = beforeIndex < 0 ? [] : records.slice(beforeIndex + 1);
  }
  return { records: records.slice(0, request?.limit ?? 100) };
});
peer.register("graph.checkpoint.put", (request) => {
  graphCheckpointPuts += 1;
  const key = graphCheckpointKey(request, request?.checkpointId);
  graphCheckpoints.set(key, {
    checkpointThreadId: request.checkpointThreadId,
    checkpointNs: request.checkpointNs ?? "",
    checkpointId: request.checkpointId,
    parentCheckpointId: request.parentCheckpointId ?? null,
    checkpoint: request.checkpoint,
    metadata: request.metadata,
    pendingWrites: pendingGraphWrites.get(key) ?? [],
    projectId: request.projectId,
  });
  return { saved: true, checkpointId: request.checkpointId };
});
peer.register("graph.checkpoint.putWrites", (request) => {
  const key = graphCheckpointKey(request, request?.checkpointId);
  const writes = mergeGraphWrites(
    graphCheckpoints.get(key)?.pendingWrites ?? pendingGraphWrites.get(key) ?? [],
    request?.writes ?? [],
  );
  pendingGraphWrites.set(key, writes);
  const record = graphCheckpoints.get(key);
  if (record) record.pendingWrites = writes;
  return { saved: true, writeCount: request?.writes?.length ?? 0 };
});
peer.register("graph.checkpoint.deleteThread", (request) => {
  let deleted = 0;
  for (const [key, record] of graphCheckpoints) {
    if (
      record.projectId === request?.projectId &&
      record.checkpointThreadId === request?.checkpointThreadId
    ) {
      graphCheckpoints.delete(key);
      pendingGraphWrites.delete(key);
      deleted += 1;
    }
  }
  return { deleted };
});
peer.onNotification("agent.event", (event) => {
  if (event?.type === "final.answer") finalAnswer = event.content;
  if (event?.type === "turn.status" && event.status === "completed") {
    resolveCompleted();
  }
  if (event?.type === "failure") {
    rejectCompleted(
      new Error(`agent turn failed (${String(event.code)}): ${String(event.message)}`),
    );
  }
});

let primaryError;
try {
  const result = await peer.request(
    "host.initialize",
    {
      protocolVersion: 1,
      appVersion: "smoke",
      maxFrameBytes: 4 * 1024 * 1024,
      requiredCapabilities: [
        "chat",
        "plan",
        "agent",
        "model-proxy",
        "tool-proxy",
        "checkpoint-proxy",
        "artifact-proxy",
        "clarification",
        "approval",
        "subagents",
        "context-compaction",
      ],
    },
    15_000,
  );
  const startupMs = performance.now() - startedAt;
  if (
    result?.protocolVersion !== 1 ||
    result?.runtime !== "deepagents-typescript" ||
    result?.runtimeVersion !== "1.10.8" ||
    !String(result?.nodeVersion ?? "").startsWith("v22.")
  ) {
    throw new Error(`unexpected agent host handshake: ${JSON.stringify(result)}`);
  }
  if (startupMs > maxStartupMs) {
    throw new Error(
      `agent host startup ${startupMs.toFixed(0)}ms exceeds ${maxStartupMs}ms`,
    );
  }

  const deadline = Date.now() + 30_000;
  const metadata = {
    requestId: "smoke-request",
    threadId: "smoke-thread",
    turnId: "smoke-turn",
    contextVersion: "smoke-context-v1",
    deadline,
  };
  await peer.request("thread.open", {
    ...metadata,
    projectId: "smoke-project",
    profile: "plan",
  });
  const accepted = await peer.request("turn.start", {
    ...metadata,
    projectId: "smoke-project",
    profile: "plan",
    messages: [],
    prompt: "Inspect the available objects.",
    provider: {
      model: "smoke-model",
      capabilities: {
        streaming: false,
        toolCalling: true,
        structuredOutput: false,
        maxInputTokens: 32_000,
        maxOutputTokens: 4_000,
      },
    },
    workspace: {
      projectId: "smoke-project",
      connectionId: null,
      database: null,
      namespace: null,
      activeTabId: null,
      configRevision: null,
      fingerprint: "smoke-fingerprint",
      summary: {},
    },
    tools: [
      {
        name: "metadata.listObjects",
        description: "List visible database objects without modifying them.",
        inputSchema: {
          type: "object",
          properties: { scope: { type: "string" } },
          additionalProperties: false,
        },
        permissions: ["read"],
      },
    ],
  });
  if (accepted?.accepted !== true) {
    throw new Error(`agent host rejected smoke turn: ${JSON.stringify(accepted)}`);
  }
  await withTimeout(completed, 25_000, "agent turn completion", () => stderr);
  if (modelCalls < 2 || toolCalls !== 1 || graphCheckpointPuts < 1) {
    throw new Error(
      `incomplete agent loop: modelCalls=${modelCalls}, toolCalls=${toolCalls}, graphCheckpointPuts=${graphCheckpointPuts}`,
    );
  }
  if (finalAnswer !== "Packaged Deep Agents runtime is ready.") {
    throw new Error(`unexpected final answer: ${JSON.stringify(finalAnswer)}`);
  }

  const rssBytes = await readRssBytes(child.pid);
  if (rssBytes !== null && rssBytes > maxRssMb * 1024 * 1024) {
    throw new Error(
      `agent host RSS ${(rssBytes / 1024 / 1024).toFixed(1)}MiB exceeds ${maxRssMb}MiB`,
    );
  }
  process.stdout.write(
    [
      `Agent host smoke passed (${result.runtime} ${result.runtimeVersion}, ${result.nodeVersion})`,
      `startup=${startupMs.toFixed(0)}ms`,
      `modelCalls=${modelCalls}`,
      `toolCalls=${toolCalls}`,
      `graphCheckpointPuts=${graphCheckpointPuts}`,
      rssBytes === null ? "rss=unavailable" : `rss=${(rssBytes / 1024 / 1024).toFixed(1)}MiB`,
    ].join(", ") + ".\n",
  );
} catch (error) {
  primaryError = error;
} finally {
  const gracefulError = await closeGracefully(child, stderr);
  peer.close();
  if (!primaryError && gracefulError) primaryError = gracefulError;
}

if (primaryError) throw primaryError;
}

class SmokePeer {
  #child;
  #buffer = Buffer.alloc(0);
  #expectedBytes = null;
  #sequence = 0;
  #pending = new Map();
  #handlers = new Map();
  #notificationHandlers = new Map();
  #dispatchChain = Promise.resolve();

  constructor(childProcess) {
    this.#child = childProcess;
    childProcess.stdout.on("data", (chunk) => this.#consume(Buffer.from(chunk)));
    childProcess.stdout.on("error", (error) => this.#fail(error));
    childProcess.once("error", (error) => this.#fail(error));
    childProcess.once("exit", (code, signal) => {
      this.#fail(
        new Error(
          `agent host exited with ${code ?? "no code"}${signal ? ` (${signal})` : ""}; stderr: ${stderr}`,
        ),
      );
    });
  }

  register(method, handler) {
    this.#handlers.set(method, handler);
  }

  onNotification(method, handler) {
    this.#notificationHandlers.set(method, handler);
  }

  request(method, params, timeoutMs = 10_000) {
    const id = `smoke-${++this.#sequence}`;
    const response = new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        rejectPromise(
          new Error(`${method} timed out after ${timeoutMs}ms; stderr: ${stderr}`),
        );
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
    });
    this.#write({ jsonrpc: "2.0", id, method, params });
    return response;
  }

  close() {
    this.#fail(new Error("smoke peer closed"));
  }

  #consume(chunk) {
    this.#buffer =
      this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    while (true) {
      if (this.#expectedBytes === null) {
        const headerEnd = this.#buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        if (headerEnd > 8 * 1024) {
          this.#fail(new Error("agent host returned an oversized frame header"));
          return;
        }
        const header = this.#buffer.subarray(0, headerEnd).toString("ascii");
        const length = Number(
          header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/iu)?.[1],
        );
        if (!Number.isSafeInteger(length) || length <= 0 || length > 4 * 1024 * 1024) {
          this.#fail(new Error("agent host returned an invalid Content-Length"));
          return;
        }
        this.#expectedBytes = length;
        this.#buffer = this.#buffer.subarray(headerEnd + 4);
      }
      if (this.#buffer.length < this.#expectedBytes) return;
      const payload = this.#buffer.subarray(0, this.#expectedBytes);
      this.#buffer = this.#buffer.subarray(this.#expectedBytes);
      this.#expectedBytes = null;
      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch (error) {
        this.#fail(error);
        return;
      }
      this.#dispatchChain = this.#dispatchChain
        .then(() => this.#dispatch(message))
        .catch((error) => this.#fail(error));
    }
  }

  async #dispatch(message) {
    if (message && typeof message === "object" && "method" in message) {
      if ("id" in message) {
        const handler = this.#handlers.get(message.method);
        if (!handler) {
          this.#write({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" },
          });
          return;
        }
        try {
          const result = await handler(message.params);
          this.#write({ jsonrpc: "2.0", id: message.id, result });
        } catch (error) {
          this.#write({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        }
        return;
      }
      await this.#notificationHandlers.get(message.method)?.(message.params);
      return;
    }

    const pending = this.#pending.get(message?.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    if (message.error) {
      pending.reject(
        new Error(
          `${message.error.message ?? "RPC error"} (${message.error.code ?? "unknown"})`,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  #write(value) {
    const payload = Buffer.from(JSON.stringify(value), "utf8");
    if (payload.length > 4 * 1024 * 1024) {
      throw new Error("smoke request exceeds maximum frame size");
    }
    this.#child.stdin.write(
      Buffer.concat([
        Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "ascii"),
        payload,
      ]),
    );
  }

  #fail(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

async function closeGracefully(childProcess, capturedStderr) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return childProcess.exitCode === 0
      ? null
      : new Error(
          `agent host exited before shutdown (${childProcess.exitCode ?? childProcess.signalCode}); stderr: ${capturedStderr}`,
        );
  }
  const exit = new Promise((resolveExit) => {
    childProcess.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  childProcess.stdin.end();
  let shutdownTimer;
  const result = await Promise.race([
    exit,
    new Promise((resolveTimeout) => {
      shutdownTimer = setTimeout(() => resolveTimeout(null), 2_000);
    }),
  ]);
  clearTimeout(shutdownTimer);
  if (result === null) {
    childProcess.kill("SIGKILL");
    await exit;
    return new Error("agent host did not exit cleanly within 2000ms");
  }
  if (result.code !== 0) {
    return new Error(
      `agent host clean shutdown returned ${result.code ?? result.signal}; stderr: ${capturedStderr}`,
    );
  }
  return null;
}

async function readRssBytes(pid) {
  if (!pid) return null;
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`,
        ],
        { encoding: "utf8", timeout: 5_000 },
      );
      const bytes = Number(stdout.trim());
      return Number.isFinite(bytes) ? bytes : null;
    }
    const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const kibibytes = Number(stdout.trim());
    return Number.isFinite(kibibytes) ? kibibytes * 1024 : null;
  } catch {
    return null;
  }
}

async function withTimeout(promise, timeoutMs, label, stderrValue) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rejectPromise) => {
        timer = setTimeout(
          () =>
            rejectPromise(
              new Error(`${label} timed out after ${timeoutMs}ms; stderr: ${stderrValue()}`),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function argument(name) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function positiveNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function graphCheckpointKey(request, checkpointId) {
  return JSON.stringify([
    request?.projectId,
    request?.checkpointThreadId,
    request?.checkpointNs ?? "",
    checkpointId,
  ]);
}

function graphRecordsForScope(checkpoints, request) {
  return [...checkpoints.values()].filter(
    (record) =>
      record.projectId === request?.projectId &&
      record.checkpointThreadId === request?.checkpointThreadId &&
      record.checkpointNs === (request?.checkpointNs ?? ""),
  );
}

function mergeGraphWrites(existing, incoming) {
  const writes = new Map(
    existing.map((write) => [`${write.taskId}\u0000${write.index}`, write]),
  );
  for (const write of incoming) {
    writes.set(`${write.taskId}\u0000${write.index}`, write);
  }
  return [...writes.values()];
}

await main();
