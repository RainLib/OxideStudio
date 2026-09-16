import {
  AGENT_HOST_MAX_FRAME_BYTES,
  AGENT_HOST_PROTOCOL_VERSION,
  HOST_METHODS,
  SIDECAR_METHODS,
  agentEventSchema,
  type AgentEvent,
  type StartTurnParams,
} from "@oxide/agent-contract";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonRpcPeer } from "../../src/rpc.js";
import { AgentRuntime } from "../../src/runtime.js";
import {
  registerGraphCheckpointMock,
  serializedCheckpointText,
} from "./fixtures.js";

describe("AgentRuntime", () => {
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
      if (
        event.type === "turn.status" &&
        event.status === "awaiting_approval"
      ) {
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
