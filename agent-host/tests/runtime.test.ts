import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  AGENT_HOST_MAX_FRAME_BYTES,
  AGENT_HOST_PROTOCOL_VERSION,
  HOST_METHODS,
  SIDECAR_METHODS,
  agentEventSchema,
  type AgentEvent,
  type ModelRequest,
  type StartTurnParams,
} from "@oxide/agent-contract";
import { AgentProtocolError, JsonRpcPeer } from "../src/rpc.js";
import {
  AgentRuntime,
  modelUsage,
  splitPromptAtBoundaries,
} from "../src/runtime.js";
import { toolObservationDetail } from "../src/tools.js";

describe("long prompt segmentation", () => {
  it("preserves every character and does not split surrogate pairs", () => {
    const prompt = `${"requirement line\n".repeat(700)}tail constraint 😀 MUST remain`;
    const chunks = splitPromptAtBoundaries(prompt, 4_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(prompt);
    expect(chunks.at(-1)?.text).toContain("tail constraint 😀 MUST remain");
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]?.start).toBe(chunks[index - 1]?.end);
    }
  });
});

describe("model usage projection", () => {
  it("accepts complete provider usage and rejects partial metadata", () => {
    expect(
      modelUsage({
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 30,
          total_tokens: 150,
        },
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
    expect(
      modelUsage({
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 30,
        },
      }),
    ).toBeNull();
  });
});

describe("tool observation presentation", () => {
  it("keeps a bounded output preview and reports truncation metadata", () => {
    const detail = toolObservationDetail({
      summary: "query.runReadOnly returned a bounded result",
      data: [{ id: 1, name: "Ada" }, { id: 2, name: "Lin" }],
      rowCount: 2,
      byteCount: 64,
      truncated: false,
      artifactRef: null,
    });

    expect(detail).toContain("2 rows · 64 bytes");
    expect(detail).toContain("Output preview");
    expect(detail).toContain('"name": "Ada"');
  });

  it("does not inline an offloaded artifact", () => {
    const detail = toolObservationDetail({
      summary: "metadata.listObjects result was offloaded",
      rowCount: 500,
      byteCount: 80_000,
      truncated: true,
      artifactRef: "tool-result-1",
    });

    expect(detail).toContain("500 rows · 80,000 bytes · truncated");
    expect(detail).not.toContain("Output preview");
    expect(detail.length).toBeLessThanOrEqual(2_400);
  });
});

describe("AgentRuntime", () => {
  it("runs Chat through the Rust model proxy without exposing host tools", async () => {
    const hostToSidecar = new PassThrough();
    const sidecarToHost = new PassThrough();
    const host = new JsonRpcPeer(sidecarToHost, hostToSidecar);
    const sidecar = new JsonRpcPeer(hostToSidecar, sidecarToHost);
    const runtime = new AgentRuntime(sidecar);
    const events: AgentEvent[] = [];
    let boundToolNames: string[] = [];
    let resolveFinal!: (event: AgentEvent) => void;
    let resolveCompleted!: () => void;
    const final = new Promise<AgentEvent>((resolve) => {
      resolveFinal = resolve;
    });
    const turnCompleted = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });

    host.register(SIDECAR_METHODS.modelComplete, (params) => {
      const request = params as ModelRequest;
      boundToolNames = request.tools.map((tool) => tool.name);
      return {
        content: "Oxide runtime is ready.",
        model: "test-model",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        toolCalls: [],
      };
    });
    registerGraphCheckpointMock(host);
    host.register(SIDECAR_METHODS.checkpointSave, () => ({ saved: true }));
    host.registerNotification(SIDECAR_METHODS.event, (params) => {
      const event = agentEventSchema.parse(params);
      events.push(event);
      if (event.type === "final.answer") resolveFinal(event);
      if (event.type === "turn.status" && event.status === "completed") {
        resolveCompleted();
      }
    });

    const hostRun = host.run();
    const sidecarRun = sidecar.run();
    await host.call(HOST_METHODS.initialize, {
      protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
      appVersion: "0.1.2",
      maxFrameBytes: AGENT_HOST_MAX_FRAME_BYTES,
      requiredCapabilities: ["chat", "model-proxy"],
    });

    const turn: StartTurnParams = {
      requestId: "request",
      threadId: "thread",
      turnId: "turn",
      contextVersion: "context-v1",
      deadline: Date.now() + 15_000,
      projectId: "project",
      profile: "chat",
      messages: [],
      prompt: "Hello",
      provider: {
        model: "test-model",
        capabilities: {
          streaming: false,
          toolCalling: true,
          structuredOutput: false,
          maxInputTokens: 32_000,
          maxOutputTokens: 4_000,
        },
      },
      workspace: {
        projectId: "project",
        connectionId: null,
        database: null,
        namespace: null,
        activeTabId: null,
        configRevision: null,
        fingerprint: "fingerprint",
        summary: {},
      },
      tools: [
        {
          name: "metadata.listObjects",
          description: "List objects",
          inputSchema: { type: "object" },
          permissions: ["read"],
        },
      ],
    };
    await host.call(HOST_METHODS.startTurn, turn);
    const completed = await Promise.race([
      final,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    expect(completed, JSON.stringify(events)).not.toBeNull();
    expect(completed).toMatchObject({
      type: "final.answer",
      content: "Oxide runtime is ready.",
    });
    expect(boundToolNames).toContain("ask_user");
    expect(boundToolNames).toContain("context_read_artifact");
    expect(boundToolNames).toContain("context_search_artifact");
    expect(boundToolNames).not.toContain("metadata.listObjects");
    expect(boundToolNames).not.toContain("read_file");
    await turnCompleted;
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model.usage",
        calls: 1,
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "turn.status",
      status: "completed",
    });

    runtime.cancelAll();
    host.close();
    sidecar.close();
    hostToSidecar.end();
    sidecarToHost.end();
    await Promise.allSettled([hostRun, sidecarRun]);
  }, 20_000);

  it("bootstraps a checkpointed thread once and only appends later prompts", async () => {
    const hostToSidecar = new PassThrough();
    const sidecarToHost = new PassThrough();
    const host = new JsonRpcPeer(sidecarToHost, hostToSidecar);
    const sidecar = new JsonRpcPeer(hostToSidecar, sidecarToHost);
    const runtime = new AgentRuntime(sidecar);
    const requests: ModelRequest[] = [];
    const completedTurns = new Set<string>();
    const completionWaiters = new Map<string, () => void>();

    host.register(SIDECAR_METHODS.modelComplete, (params) => {
      const request = params as ModelRequest;
      requests.push(request);
      return {
        content: requests.length === 1 ? "First answer" : "Second answer",
        model: "test-model",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        toolCalls: [],
      };
    });
    host.register(SIDECAR_METHODS.checkpointLoad, () => ({
      checkpointVersion: 1,
      checkpoint: null,
    }));
    registerGraphCheckpointMock(host);
    host.register(SIDECAR_METHODS.checkpointSave, () => ({ saved: true }));
    host.registerNotification(SIDECAR_METHODS.event, (params) => {
      const event = agentEventSchema.parse(params);
      if (event.type === "turn.status" && event.status === "completed") {
        completedTurns.add(event.turnId);
        completionWaiters.get(event.turnId)?.();
      }
    });

    const hostRun = host.run();
    const sidecarRun = sidecar.run();
    await host.call(HOST_METHODS.initialize, {
      protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
      appVersion: "0.1.2",
      maxFrameBytes: AGENT_HOST_MAX_FRAME_BYTES,
      requiredCapabilities: ["chat", "model-proxy"],
    });

    const baseTurn: Omit<StartTurnParams, "turnId" | "prompt"> = {
      requestId: "request",
      threadId: "thread-bootstrap-once",
      contextVersion: "context-v1",
      deadline: Date.now() + 15_000,
      projectId: "project",
      profile: "chat",
      messages: [{ role: "user", content: "bootstrap message" }],
      provider: {
        model: "test-model",
        capabilities: {
          streaming: false,
          toolCalling: true,
          structuredOutput: false,
          maxInputTokens: 32_000,
          maxOutputTokens: 4_000,
        },
      },
      workspace: {
        projectId: "project",
        connectionId: null,
        database: null,
        namespace: null,
        activeTabId: null,
        configRevision: null,
        fingerprint: "fingerprint",
        summary: {},
      },
      tools: [],
    };

    const waitForTurn = (turnId: string) => {
      if (completedTurns.has(turnId)) return Promise.resolve();
      return new Promise<void>((resolve) => completionWaiters.set(turnId, resolve));
    };
    await host.call(HOST_METHODS.startTurn, {
      ...baseTurn,
      turnId: "turn-1",
      prompt: "first prompt",
    });
    await waitForTurn("turn-1");
    await host.call(HOST_METHODS.startTurn, {
      ...baseTurn,
      requestId: "request-2",
      turnId: "turn-2",
      prompt: "second prompt",
    });
    await waitForTurn("turn-2");

    const secondRequest = requests.at(-1);
    const bootstrapOccurrences = secondRequest?.messages.filter(
      (message) => message.content === "bootstrap message",
    ).length;
    expect(bootstrapOccurrences).toBe(1);
    expect(
      secondRequest?.messages.some(
        (message) => message.content === "second prompt",
      ),
    ).toBe(true);

    runtime.cancelAll();
    host.close();
    sidecar.close();
    hostToSidecar.end();
    sidecarToHost.end();
    await Promise.allSettled([hostRun, sidecarRun]);
  }, 20_000);

  it("persists an ask_user interrupt and resumes the same turn with Command", async () => {
    const hostToSidecar = new PassThrough();
    const sidecarToHost = new PassThrough();
    const host = new JsonRpcPeer(sidecarToHost, hostToSidecar);
    const sidecar = new JsonRpcPeer(hostToSidecar, sidecarToHost);
    const runtime = new AgentRuntime(sidecar);
    let modelCalls = 0;
    let resolveClarification!: (event: AgentEvent) => void;
    let resolveFinal!: (event: AgentEvent) => void;
    let resolveAwaiting!: () => void;
    const clarification = new Promise<AgentEvent>((resolve) => {
      resolveClarification = resolve;
    });
    const final = new Promise<AgentEvent>((resolve) => {
      resolveFinal = resolve;
    });
    const awaiting = new Promise<void>((resolve) => {
      resolveAwaiting = resolve;
    });

    host.register(SIDECAR_METHODS.modelComplete, () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: "",
          model: "test-model",
          finishReason: "tool_calls",
          usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
          toolCalls: [
            {
              id: "ask-user-call",
              name: "ask_user",
              args: {
                questions: [
                  {
                    id: "scope",
                    prompt: "Which database scope should I use?",
                    options: [
                      { id: "current", label: "Current database" },
                      { id: "all", label: "All databases" },
                      { id: "saved", label: "All saved connections" },
                      {
                        id: "other",
                        label: "Other (I will describe it below)",
                      },
                    ],
                    // Models may try to disable free text even though this is
                    // an OxideStudio interaction policy. The tool must accept
                    // and normalize this legacy/model-generated field.
                    allowFreeText: false,
                  },
                ],
              },
            },
          ],
        };
      }
      return {
        content: "I will use the current database.",
        model: "test-model",
        finishReason: "stop",
        usage: { inputTokens: 18, outputTokens: 7, totalTokens: 25 },
        toolCalls: [],
      };
    });
    registerGraphCheckpointMock(host);
    host.register(SIDECAR_METHODS.checkpointSave, () => ({ saved: true }));
    host.registerNotification(SIDECAR_METHODS.event, (params) => {
      const event = agentEventSchema.parse(params);
      if (event.type === "clarification") resolveClarification(event);
      if (event.type === "final.answer") resolveFinal(event);
      if (event.type === "turn.status" && event.status === "awaiting_input") {
        resolveAwaiting();
      }
    });

    const hostRun = host.run();
    const sidecarRun = sidecar.run();
    await host.call(HOST_METHODS.initialize, {
      protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
      appVersion: "0.1.2",
      maxFrameBytes: AGENT_HOST_MAX_FRAME_BYTES,
      requiredCapabilities: ["chat", "model-proxy", "clarification"],
    });
    const turn: StartTurnParams = {
      requestId: "request-hitl",
      threadId: "thread-hitl",
      turnId: "turn-hitl",
      contextVersion: "context-v1",
      deadline: Date.now() + 15_000,
      projectId: "project",
      profile: "chat",
      messages: [],
      prompt: "Inspect my database",
      provider: {
        model: "test-model",
        capabilities: {
          streaming: false,
          toolCalling: true,
          structuredOutput: false,
          maxInputTokens: 32_000,
          maxOutputTokens: 4_000,
        },
      },
      workspace: {
        projectId: "project",
        connectionId: null,
        database: null,
        namespace: null,
        activeTabId: null,
        configRevision: null,
        fingerprint: "fingerprint",
        summary: {},
      },
      tools: [],
    };
    await host.call(HOST_METHODS.startTurn, turn);
    const clarificationEvent = await clarification;
    await awaiting;
    if (clarificationEvent.type !== "clarification") {
      throw new Error("expected clarification event");
    }
    expect(clarificationEvent.questions[0]?.allowFreeText).toBe(true);
    expect(clarificationEvent.questions[0]?.options).toEqual([
      { id: "current", label: "Current database" },
      { id: "all", label: "All databases" },
      { id: "saved", label: "All saved connections" },
    ]);
    const resume = await host.call<{ resumed: boolean }>(HOST_METHODS.resumeTurn, {
      ...turn,
      requestId: "request-hitl-resume",
      deadline: Date.now() + 15_000,
      resume: {
        kind: "clarification",
        clarificationId: clarificationEvent.clarificationId,
        answers: { scope: "Current database" },
      },
      transientApprovalLease: null,
    });
    expect(resume.resumed).toBe(true);
    await expect(final).resolves.toMatchObject({
      type: "final.answer",
      content: "I will use the current database.",
    });
    expect(modelCalls).toBe(2);

    runtime.cancelAll();
    host.close();
    sidecar.close();
    hostToSidecar.end();
    sidecarToHost.end();
    await Promise.allSettled([hostRun, sidecarRun]);
  }, 20_000);

  it("asks for an ambiguous connection and retries the read-only tool", async () => {
    const hostToSidecar = new PassThrough();
    const sidecarToHost = new PassThrough();
    const host = new JsonRpcPeer(sidecarToHost, hostToSidecar);
    const sidecar = new JsonRpcPeer(hostToSidecar, sidecarToHost);
    const runtime = new AgentRuntime(sidecar);
    let modelCalls = 0;
    let selectedConnectionId: unknown;
    let resolveClarification!: (event: AgentEvent) => void;
    let resolveFinal!: (event: AgentEvent) => void;
    let resolveAwaiting!: () => void;
    const clarification = new Promise<AgentEvent>((resolve) => {
      resolveClarification = resolve;
    });
    const final = new Promise<AgentEvent>((resolve) => {
      resolveFinal = resolve;
    });
    const awaiting = new Promise<void>((resolve) => {
      resolveAwaiting = resolve;
    });

    host.register(SIDECAR_METHODS.modelComplete, () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: "",
          model: "test-model",
          finishReason: "tool_calls",
          usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
          toolCalls: [
            {
              id: "metadata-call",
              name: "metadata.listObjects",
              args: {},
            },
          ],
        };
      }
      return {
        content: "The Elasticsearch connection has two indexes.",
        model: "test-model",
        finishReason: "stop",
        usage: { inputTokens: 18, outputTokens: 7, totalTokens: 25 },
        toolCalls: [],
      };
    });
    host.register(SIDECAR_METHODS.toolInvoke, (raw) => {
      const input = (raw as { input?: Record<string, unknown> }).input ?? {};
      selectedConnectionId = input.connectionId;
      if (!selectedConnectionId) {
        throw new AgentProtocolError(
          "CONNECTION_SELECTION_REQUIRED",
          "multiple database connections are available",
          {
            kind: "connection_selection_required",
            candidates: [
              { id: "es-1", name: "Elasticsearch", driver: "elasticsearch" },
              { id: "mysql-1", name: "MySQL", driver: "mysql" },
            ],
          },
        );
      }
      return {
        summary: "2 indexes",
        data: null,
        byteCount: 42,
        truncated: true,
        artifactRef: "tool-result-indexes",
      };
    });
    registerGraphCheckpointMock(host);
    host.register(SIDECAR_METHODS.checkpointSave, () => ({ saved: true }));
    host.registerNotification(SIDECAR_METHODS.event, (params) => {
      const event = agentEventSchema.parse(params);
      if (event.type === "clarification") resolveClarification(event);
      if (event.type === "final.answer") resolveFinal(event);
      if (event.type === "turn.status" && event.status === "awaiting_input") {
        resolveAwaiting();
      }
    });

    const hostRun = host.run();
    const sidecarRun = sidecar.run();
    await host.call(HOST_METHODS.initialize, {
      protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
      appVersion: "0.1.2",
      maxFrameBytes: AGENT_HOST_MAX_FRAME_BYTES,
      requiredCapabilities: [
        "agent",
        "model-proxy",
        "tool-proxy",
        "clarification",
      ],
    });
    const turn: StartTurnParams = {
      requestId: "request-connection",
      threadId: "thread-connection",
      turnId: "turn-connection",
      contextVersion: "context-v1",
      deadline: Date.now() + 15_000,
      projectId: "project",
      profile: "agent",
      messages: [],
      prompt: "List database objects",
      provider: {
        model: "test-model",
        capabilities: {
          streaming: false,
          toolCalling: true,
          structuredOutput: false,
          maxInputTokens: 32_000,
          maxOutputTokens: 4_000,
        },
      },
      workspace: {
        projectId: "project",
        connectionId: null,
        database: null,
        namespace: null,
        activeTabId: null,
        configRevision: null,
        fingerprint: "fingerprint",
        summary: {},
      },
      tools: [
        {
          name: "metadata.listObjects",
          description: "List database objects",
          inputSchema: { type: "object", additionalProperties: false },
          permissions: ["read"],
        },
      ],
    };
    await host.call(HOST_METHODS.startTurn, turn);
    const clarificationEvent = await clarification;
    await awaiting;
    if (clarificationEvent.type !== "clarification") {
      throw new Error("expected clarification event");
    }
    expect(clarificationEvent.questions[0]?.options).toEqual([
      {
        id: "es-1",
        label: "Elasticsearch",
        description: "elasticsearch",
      },
      { id: "mysql-1", label: "MySQL", description: "mysql" },
    ]);

    await host.call(HOST_METHODS.resumeTurn, {
      ...turn,
      requestId: "request-connection-resume",
      deadline: Date.now() + 15_000,
      resume: {
        kind: "clarification",
        clarificationId: clarificationEvent.clarificationId,
        answers: { connectionId: "es-1" },
      },
      transientApprovalLease: null,
    });
    await expect(final).resolves.toMatchObject({
      type: "final.answer",
      content: "The Elasticsearch connection has two indexes.",
      artifacts: ["tool-result-indexes"],
    });
    expect(selectedConnectionId).toBe("es-1");
    expect(modelCalls).toBe(2);

    runtime.cancelAll();
    host.close();
    sidecar.close();
    hostToSidecar.end();
    sidecarToHost.end();
    await Promise.allSettled([hostRun, sidecarRun]);
  }, 20_000);

  it("keeps an approval lease transient while resuming an approved mutation", async () => {
    const hostToSidecar = new PassThrough();
    const sidecarToHost = new PassThrough();
    const host = new JsonRpcPeer(sidecarToHost, hostToSidecar);
    const sidecar = new JsonRpcPeer(hostToSidecar, sidecarToHost);
    const runtime = new AgentRuntime(sidecar);
    const lease = "single-use-secret-lease";
    const checkpointFrames: unknown[] = [];
    let modelCalls = 0;
    let receivedLease: unknown;
    let resolveApproval!: (event: AgentEvent) => void;
    let resolveAwaiting!: () => void;
    let resolveFinal!: (event: AgentEvent) => void;
    const approval = new Promise<AgentEvent>((resolve) => {
      resolveApproval = resolve;
    });
    const awaiting = new Promise<void>((resolve) => {
      resolveAwaiting = resolve;
    });
    const final = new Promise<AgentEvent>((resolve) => {
      resolveFinal = resolve;
    });

    host.register(SIDECAR_METHODS.modelComplete, () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: "",
          model: "test-model",
          finishReason: "tool_calls",
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          toolCalls: [
            {
              id: "mutation-call",
              name: "database.mutate",
              args: { statement: "UPDATE widgets SET active = true" },
            },
          ],
        };
      }
      return {
        content: "Mutation completed after approval.",
        model: "test-model",
        finishReason: "stop",
        usage: { inputTokens: 15, outputTokens: 6, totalTokens: 21 },
        toolCalls: [],
      };
    });
    host.register(SIDECAR_METHODS.toolInvoke, (raw) => {
      receivedLease = (raw as Record<string, unknown>).approvalLease;
      return {
        summary: "one row updated",
        byteCount: 16,
        truncated: false,
        artifactRef: null,
      };
    });
    registerGraphCheckpointMock(host, (raw) => checkpointFrames.push(raw));
    host.register(SIDECAR_METHODS.checkpointSave, () => ({ saved: true }));
    host.registerNotification(SIDECAR_METHODS.event, (params) => {
      const event = agentEventSchema.parse(params);
      if (event.type === "approval") resolveApproval(event);
      if (event.type === "turn.status" && event.status === "awaiting_approval") {
        resolveAwaiting();
      }
      if (event.type === "final.answer") resolveFinal(event);
    });

    const hostRun = host.run();
    const sidecarRun = sidecar.run();
    await host.call(HOST_METHODS.initialize, {
      protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
      appVersion: "0.1.2",
      maxFrameBytes: AGENT_HOST_MAX_FRAME_BYTES,
      requiredCapabilities: ["agent", "model-proxy", "tool-proxy", "approval"],
    });
    const turn: StartTurnParams = {
      requestId: "request-approval",
      threadId: "thread-approval",
      turnId: "turn-approval",
      contextVersion: "context-v1",
      deadline: Date.now() + 15_000,
      projectId: "project",
      profile: "agent",
      messages: [],
      prompt: "Activate all widgets",
      provider: {
        model: "test-model",
        capabilities: {
          streaming: false,
          toolCalling: true,
          structuredOutput: false,
          maxInputTokens: 32_000,
          maxOutputTokens: 4_000,
        },
      },
      workspace: {
        projectId: "project",
        connectionId: "connection",
        database: "database",
        namespace: null,
        activeTabId: null,
        configRevision: "revision",
        fingerprint: "fingerprint",
        summary: {},
      },
      tools: [
        {
          name: "database.mutate",
          description: "Execute an approved mutation",
          inputSchema: {
            type: "object",
            properties: { statement: { type: "string" } },
            required: ["statement"],
            additionalProperties: false,
          },
          permissions: ["write"],
        },
      ],
    };
    await host.call(HOST_METHODS.startTurn, turn);
    const approvalEvent = await approval;
    await awaiting;
    if (approvalEvent.type !== "approval") {
      throw new Error("expected approval event");
    }
    await host.call(HOST_METHODS.resumeTurn, {
      ...turn,
      requestId: "request-approval-resume",
      deadline: Date.now() + 15_000,
      resume: {
        kind: "approval",
        approvalId: approvalEvent.approvalId,
        decision: "approve",
      },
      transientApprovalLease: {
        approvalId: approvalEvent.approvalId,
        lease,
      },
    });
    await expect(final).resolves.toMatchObject({
      type: "final.answer",
      content: "Mutation completed after approval.",
    });
    expect(receivedLease).toBe(lease);
    expect(serializedCheckpointText(checkpointFrames)).not.toContain(lease);

    runtime.cancelAll();
    host.close();
    sidecar.close();
    hostToSidecar.end();
    sidecarToHost.end();
    await Promise.allSettled([hostRun, sidecarRun]);
  }, 20_000);
});

function registerGraphCheckpointMock(
  host: JsonRpcPeer,
  onWrite?: (raw: unknown) => void,
) {
  const records = new Map<string, Record<string, unknown>>();
  const key = (value: Record<string, unknown>, checkpointId: string) =>
    `${String(value.checkpointThreadId)}\u0000${String(value.checkpointNs ?? "")}\u0000${checkpointId}`;

  host.register(SIDECAR_METHODS.graphCheckpointGet, (raw) => {
    const params = raw as Record<string, unknown>;
    const prefix = `${String(params.checkpointThreadId)}\u0000${String(params.checkpointNs ?? "")}\u0000`;
    const requested =
      typeof params.checkpointId === "string" ? params.checkpointId : null;
    const record = requested
      ? records.get(key(params, requested))
      : [...records.entries()]
          .filter(([entryKey]) => entryKey.startsWith(prefix))
          .sort(([left], [right]) => right.localeCompare(left))[0]?.[1];
    return { record: record ?? null };
  });
  host.register(SIDECAR_METHODS.graphCheckpointList, (raw) => {
    const params = raw as Record<string, unknown>;
    const prefix = `${String(params.checkpointThreadId)}\u0000${String(params.checkpointNs ?? "")}\u0000`;
    return {
      records: [...records.entries()]
        .filter(([entryKey]) => entryKey.startsWith(prefix))
        .sort(([left], [right]) => right.localeCompare(left))
        .map(([, record]) => record),
    };
  });
  host.register(SIDECAR_METHODS.graphCheckpointPut, (raw) => {
    onWrite?.(raw);
    const params = raw as Record<string, unknown>;
    const checkpointId = String(params.checkpointId);
    records.set(key(params, checkpointId), {
      checkpointThreadId: params.checkpointThreadId,
      checkpointNs: params.checkpointNs ?? "",
      checkpointId,
      parentCheckpointId: params.parentCheckpointId ?? null,
      checkpoint: params.checkpoint,
      metadata: params.metadata,
      pendingWrites: [],
    });
    return { saved: true };
  });
  host.register(SIDECAR_METHODS.graphCheckpointPutWrites, (raw) => {
    onWrite?.(raw);
    const params = raw as Record<string, unknown>;
    const checkpointId = String(params.checkpointId);
    const record = records.get(key(params, checkpointId));
    if (record) {
      record.pendingWrites = [
        ...((record.pendingWrites as unknown[]) ?? []),
        ...((params.writes as unknown[]) ?? []),
      ];
    }
    return { saved: true };
  });
  host.register(SIDECAR_METHODS.graphCheckpointDeleteThread, () => ({
    deleted: 0,
  }));
}

function serializedCheckpointText(frames: unknown[]): string {
  return frames
    .flatMap((frame) => {
      if (!frame || typeof frame !== "object") return [];
      const values = Object.values(frame as Record<string, unknown>);
      const writes = Array.isArray((frame as Record<string, unknown>).writes)
        ? ((frame as Record<string, unknown>).writes as Array<Record<string, unknown>>)
            .map((write) => write.value)
        : [];
      return [...values, ...writes];
    })
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const data = (value as Record<string, unknown>).data;
      if (typeof data !== "string") return [];
      return Buffer.from(data, "base64").toString("utf8");
    })
    .join("\n");
}
