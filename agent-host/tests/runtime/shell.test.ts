import {
  HOST_METHODS,
  SIDECAR_METHODS,
  agentEventSchema,
  type AgentEvent,
} from "@oxide/agent-contract";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonRpcPeer } from "../../src/rpc.js";
import { AgentRuntime } from "../../src/runtime.js";
import {
  initializeRuntimeHost,
  registerGraphCheckpointMock,
  shellTurn,
} from "./fixtures.js";

describe("AgentRuntime", () => {
  it("propagates trusted shell preflight findings and policy digest through approval", async () => {
    const hostToSidecar = new PassThrough();
    const sidecarToHost = new PassThrough();
    const host = new JsonRpcPeer(sidecarToHost, hostToSidecar);
    const sidecar = new JsonRpcPeer(hostToSidecar, sidecarToHost);
    const runtime = new AgentRuntime(sidecar);
    const lease = "one-shot-shell-lease";
    let modelCalls = 0;
    let invokeRequest: Record<string, unknown> | null = null;
    let resolveApproval!: (event: AgentEvent) => void;
    let resolveAwaiting!: () => void;
    let resolveFinal!: (event: AgentEvent) => void;
    const approval = new Promise<AgentEvent>(
      (resolve) => (resolveApproval = resolve),
    );
    const awaiting = new Promise<void>(
      (resolve) => (resolveAwaiting = resolve),
    );
    const final = new Promise<AgentEvent>(
      (resolve) => (resolveFinal = resolve),
    );

    host.register(SIDECAR_METHODS.modelComplete, () => {
      modelCalls += 1;
      return modelCalls === 1
        ? {
            content: "",
            model: "test-model",
            finishReason: "tool_calls",
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
            toolCalls: [
              {
                id: "shell-call",
                name: "shell.execute",
                args: {
                  command: "git reset --hard",
                  sandboxMode: "workspace-write",
                },
              },
            ],
          }
        : {
            content: "Shell command completed.",
            model: "test-model",
            finishReason: "stop",
            usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
            toolCalls: [],
          };
    });
    host.register(SIDECAR_METHODS.toolPreflight, () => ({
      decision: "confirm",
      policyDigest: "a".repeat(64),
      summary: "Run once in workspace-write mode from .: git reset --hard",
      findings: [
        {
          ruleId: "builtin.git.destructive-worktree",
          decision: "confirm",
          title: "Destructive Git operation",
          detail: "This can discard project changes.",
        },
      ],
      executables: ["git"],
      confirmation: {
        kind: "phrase",
        phrase: "RUN AAAAAA",
        prompt: "Type the phrase exactly.",
      },
    }));
    host.register(SIDECAR_METHODS.toolInvoke, (raw) => {
      invokeRequest = raw as Record<string, unknown>;
      return {
        summary: "command completed",
        byteCount: 17,
        truncated: false,
        artifactRef: null,
      };
    });
    registerGraphCheckpointMock(host);
    host.register(SIDECAR_METHODS.checkpointSave, () => ({ saved: true }));
    host.registerNotification(SIDECAR_METHODS.event, (params) => {
      const event = agentEventSchema.parse(params);
      if (event.type === "approval") resolveApproval(event);
      if (event.type === "turn.status" && event.status === "awaiting_approval")
        resolveAwaiting();
      if (event.type === "final.answer") resolveFinal(event);
    });

    const hostRun = host.run();
    const sidecarRun = sidecar.run();
    await initializeRuntimeHost(host);
    const turn = shellTurn("confirm");
    await host.call(HOST_METHODS.startTurn, turn);
    const approvalEvent = await approval;
    await awaiting;
    expect(approvalEvent).toMatchObject({
      type: "approval",
      policyDigest: "a".repeat(64),
      confirmation: { phrase: "RUN AAAAAA" },
      findings: [{ ruleId: "builtin.git.destructive-worktree" }],
    });
    if (approvalEvent.type !== "approval")
      throw new Error("expected approval event");
    await host.call(HOST_METHODS.resumeTurn, {
      ...turn,
      requestId: "request-shell-confirm-resume",
      deadline: Date.now() + 15_000,
      resume: {
        kind: "approval",
        approvalId: approvalEvent.approvalId,
        decision: "approve",
      },
      transientApprovalLease: { approvalId: approvalEvent.approvalId, lease },
    });
    await expect(final).resolves.toMatchObject({
      content: "Shell command completed.",
    });
    expect(invokeRequest).toMatchObject({
      approvalLease: lease,
      policyDigest: "a".repeat(64),
    });

    runtime.cancelAll();
    host.close();
    sidecar.close();
    hostToSidecar.end();
    sidecarToHost.end();
    await Promise.allSettled([hostRun, sidecarRun]);
  }, 20_000);

  it("finishes a blocked shell step without emitting approval or invoking the command", async () => {
    const hostToSidecar = new PassThrough();
    const sidecarToHost = new PassThrough();
    const host = new JsonRpcPeer(sidecarToHost, hostToSidecar);
    const sidecar = new JsonRpcPeer(hostToSidecar, sidecarToHost);
    const runtime = new AgentRuntime(sidecar);
    let modelCalls = 0;
    let approvals = 0;
    let invokes = 0;
    let blockedFinished = false;
    let resolveTerminal!: (event: AgentEvent) => void;
    const terminal = new Promise<AgentEvent>(
      (resolve) => (resolveTerminal = resolve),
    );

    host.register(SIDECAR_METHODS.modelComplete, () => {
      modelCalls += 1;
      return modelCalls === 1
        ? {
            content: "",
            model: "test-model",
            finishReason: "tool_calls",
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
            toolCalls: [
              {
                id: "blocked-shell",
                name: "shell.execute",
                args: { command: "rm -rf /", sandboxMode: "workspace-write" },
              },
            ],
          }
        : {
            content: "The command was blocked safely.",
            model: "test-model",
            finishReason: "stop",
            usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
            toolCalls: [],
          };
    });
    host.register(SIDECAR_METHODS.toolPreflight, () => ({
      decision: "block",
      policyDigest: "b".repeat(64),
      summary: "Run once in workspace-write mode from .: rm -rf /",
      findings: [
        {
          ruleId: "builtin.fs.system-recursive-delete",
          decision: "block",
          title: "System-wide recursive deletion blocked",
          detail: "The target is the filesystem root.",
        },
      ],
      executables: ["rm"],
    }));
    host.register(SIDECAR_METHODS.toolInvoke, () => {
      invokes += 1;
      return {
        summary: "must not run",
        byteCount: 0,
        truncated: false,
        artifactRef: null,
      };
    });
    registerGraphCheckpointMock(host);
    host.register(SIDECAR_METHODS.checkpointSave, () => ({ saved: true }));
    host.registerNotification(SIDECAR_METHODS.event, (params) => {
      const event = agentEventSchema.parse(params);
      if (event.type === "approval") approvals += 1;
      if (event.type === "tool.finished" && event.success === false) {
        blockedFinished = true;
      }
      if (
        event.type === "turn.status" &&
        ["completed", "failed", "cancelled"].includes(event.status)
      ) {
        resolveTerminal(event);
      }
    });

    const hostRun = host.run();
    const sidecarRun = sidecar.run();
    await initializeRuntimeHost(host);
    await host.call(HOST_METHODS.startTurn, shellTurn("block"));
    await expect(terminal).resolves.toMatchObject({ status: "failed" });
    expect(approvals).toBe(0);
    expect(invokes).toBe(0);
    expect(blockedFinished).toBe(true);

    runtime.cancelAll();
    host.close();
    sidecar.close();
    hostToSidecar.end();
    sidecarToHost.end();
    await Promise.allSettled([hostRun, sidecarRun]);
  }, 20_000);
});
