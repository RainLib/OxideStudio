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
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonRpcPeer } from "../../src/rpc.js";
import { AgentRuntime } from "../../src/runtime.js";
import { registerGraphCheckpointMock } from "./fixtures.js";

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
});
