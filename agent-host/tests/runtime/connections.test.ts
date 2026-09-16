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
import { AgentProtocolError, JsonRpcPeer } from "../../src/rpc.js";
import { AgentRuntime } from "../../src/runtime.js";
import { citationCandidatesFromObservation } from "../../src/tools.js";
import { registerGraphCheckpointMock } from "./fixtures.js";

describe("AgentRuntime", () => {
  it("asks for an ambiguous connection and retries the read-only tool", async () => {
    const hostToSidecar = new PassThrough();
    const sidecarToHost = new PassThrough();
    const host = new JsonRpcPeer(sidecarToHost, hostToSidecar);
    const sidecar = new JsonRpcPeer(hostToSidecar, sidecarToHost);
    const runtime = new AgentRuntime(sidecar);
    let modelCalls = 0;
    let selectedConnectionId: unknown;
    const expectedCitation = citationCandidatesFromObservation(
      "metadata.listObjects",
      { connectionId: "es-1" },
      {
        summary: "2 indexes",
        data: [
          { name: "events", namespace: "default", kind: "index" },
          { name: "archive", namespace: "default", kind: "index" },
        ],
        rowCount: 2,
        byteCount: 42,
        truncated: true,
        artifactRef: "tool-result-indexes",
      },
      {
        projectId: "project",
        connectionId: null,
        database: null,
        namespace: null,
        activeTabId: null,
      },
    ).find((citation) => citation.kind === "databaseObject");
    if (!expectedCitation) throw new Error("expected test citation");
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
        content: `The Elasticsearch connection includes events. [[cite:${expectedCitation.id}]]`,
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
        data: [
          { name: "events", namespace: "default", kind: "index" },
          { name: "archive", namespace: "default", kind: "index" },
        ],
        rowCount: 2,
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
      content: "The Elasticsearch connection includes events. [1]",
      artifacts: ["tool-result-indexes"],
      citations: [
        expect.objectContaining({
          kind: "databaseObject",
          label: "events",
          connectionId: "es-1",
          schemaName: "default",
          objectName: "events",
        }),
      ],
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
});
