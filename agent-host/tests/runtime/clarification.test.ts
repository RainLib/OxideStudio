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

    host.register(SIDECAR_METHODS.modelComplete, (raw) => {
      const request = raw as ModelRequest;
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
    const resume = await host.call<{ resumed: boolean }>(
      HOST_METHODS.resumeTurn,
      {
        ...turn,
        requestId: "request-hitl-resume",
        deadline: Date.now() + 15_000,
        resume: {
          kind: "clarification",
          clarificationId: clarificationEvent.clarificationId,
          answers: { scope: "Current database" },
        },
        transientApprovalLease: null,
      },
    );
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
});
