import {
  AGENT_HOST_MAX_FRAME_BYTES,
  AGENT_HOST_PROTOCOL_VERSION,
  HOST_METHODS,
  SIDECAR_METHODS,
  agentEventSchema,
  type ModelRequest,
  type StartTurnParams,
} from "@oxide/agent-contract";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonRpcPeer } from "../../src/rpc.js";
import { AgentRuntime } from "../../src/runtime.js";
import { registerGraphCheckpointMock } from "./fixtures.js";

describe("AgentRuntime", () => {
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
      return new Promise<void>((resolve) =>
        completionWaiters.set(turnId, resolve),
      );
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
});
