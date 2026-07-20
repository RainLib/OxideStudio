import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeRawCommand: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@/services/tauri/client", () => ({
  invokeRawCommand: mocks.invokeRawCommand,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import {
  AGENT_HOST_EVENT_CHANNEL,
  AGENT_HOST_PROTOCOL_VERSION,
  agentHostService,
} from "@/services/tauri/agent-host.service";

describe("Agent Host Tauri service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the versioned agent command surface", async () => {
    mocks.invokeRawCommand
      .mockResolvedValueOnce({
        protocolVersion: 1,
        available: true,
        state: "ready",
        capabilities: ["chat", "plan", "agent"],
        storageMode: "project",
        binaryPath: "/tmp/oxide-agent-host",
        lastError: null,
      })
      .mockResolvedValueOnce({
        accepted: true,
        requestId: "request-1",
        turnId: "turn-1",
        threadId: "thread-1",
      })
      .mockResolvedValue({ accepted: true });

    await agentHostService.getStatus(true);
    await agentHostService.startTurn({
      requestId: "request-1",
      threadId: "thread-1",
      turnId: "turn-1",
      contextVersion: "ctx-1",
      deadline: 10_000,
      projectId: "project-1",
      profile: "agent",
      messages: [{ role: "user", content: "List the important tables" }],
      prompt: "Inspect users",
      provider: {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "secret",
        model: "agent-model",
        timeoutMs: 30_000,
        capabilities: {
          streaming: false,
          toolCalling: true,
          structuredOutput: true,
          maxInputTokens: null,
          maxOutputTokens: null,
        },
      },
      workspace: {
        projectId: "project-1",
        connectionId: null,
        database: null,
        namespace: null,
        activeTabId: null,
        configRevision: null,
        fingerprint: "ctx-1",
        summary: {},
      },
      tools: [
        {
          name: "metadata.listObjects",
          description: "List database objects",
          inputSchema: { type: "object", properties: {} },
          permissions: ["read"],
        },
      ],
    });
    await agentHostService.answerClarification({
      requestId: "request-2",
      threadId: "thread-1",
      turnId: "turn-1",
      contextVersion: "ctx-1",
      deadline: 11_000,
      clarificationId: "clarification-1",
      answers: { schema: "public" },
    });
    await agentHostService.approveAction({
      requestId: "request-3",
      threadId: "thread-1",
      turnId: "turn-1",
      contextVersion: "ctx-1",
      deadline: 12_000,
      approvalId: "approval-1",
      decision: "approve",
    });

    expect(mocks.invokeRawCommand.mock.calls.map(([command]) => command)).toEqual([
      "agent_get_status",
      "agent_start_turn",
      "agent_answer_clarification",
      "agent_approve_action",
    ]);
    expect(mocks.invokeRawCommand.mock.calls[0]?.[1]).toEqual({
      providerConfigured: true,
    });
    const approvalRequest = mocks.invokeRawCommand.mock.calls[3]?.[1]?.request;
    expect(approvalRequest).toEqual(expect.objectContaining({
      approvalId: "approval-1",
      decision: "approve",
    }));
    expect(approvalRequest).not.toHaveProperty("approved");
    expect(approvalRequest).not.toHaveProperty("inputDigest");
    expect(approvalRequest).not.toHaveProperty("lease");
  });

  it("subscribes to validated host events and ignores protocol drift", async () => {
    let callback: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    mocks.listen.mockImplementation(async (_channel, next) => {
      callback = next;
      return unlisten;
    });
    const listener = vi.fn();
    const cleanup = await agentHostService.listen(listener);

    expect(mocks.listen).toHaveBeenCalledWith(
      AGENT_HOST_EVENT_CHANNEL,
      expect.any(Function),
    );
    callback?.({
      payload: {
        threadId: "thread-1",
        turnId: "turn-1",
        sequence: 1,
        occurredAt: 99,
        type: "answer.delta",
        content: "Do",
        reset: false,
      },
    });
    callback?.({
      payload: {
        threadId: "thread-1",
        turnId: "turn-1",
        sequence: 2,
        occurredAt: 100,
        type: "final.answer",
        content: "Done",
        artifacts: [],
        projectMetrics: {
          projectId: "project-1",
          compaction: null,
          modelUsage: {
            calls: 1,
            inputTokens: 20,
            outputTokens: 5,
            totalTokens: 25,
          },
          updatedAt: 100,
        },
      },
    });
    callback?.({
      payload: {
        // Missing occurredAt: an old/enveloped event must not reach callers.
        turnId: "turn-1",
        threadId: "thread-1",
        sequence: 3,
        timestamp: 101,
        type: "turn.status",
        status: "completed",
      },
    });

    expect(listener).toHaveBeenCalledTimes(2);
    cleanup();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("clears encrypted state only for the requested project", async () => {
    mocks.invokeRawCommand
      .mockResolvedValueOnce({
        projectId: "project-1",
        compaction: {
          count: 2,
          lastInputTokens: 2_000,
          lastRetainedTokens: 800,
          offloadedArtifacts: 3,
        },
        modelUsage: null,
        updatedAt: 100,
      })
      .mockResolvedValueOnce({
        projectId: "project-1",
        clearedRecords: 7,
      });

    await expect(
      agentHostService.getContextMetrics("project-1"),
    ).resolves.toEqual(
      expect.objectContaining({
        projectId: "project-1",
        compaction: expect.objectContaining({ count: 2 }),
      }),
    );
    await expect(
      agentHostService.clearProjectState("project-1"),
    ).resolves.toEqual({ projectId: "project-1", clearedRecords: 7 });
    expect(mocks.invokeRawCommand).toHaveBeenNthCalledWith(
      1,
      "agent_get_context_metrics",
      { projectId: "project-1" },
    );
    expect(mocks.invokeRawCommand).toHaveBeenCalledWith(
      "agent_clear_project_state",
      { projectId: "project-1" },
    );
  });

  it("keeps artifact access project-scoped and uses explicit export commands", async () => {
    mocks.invokeRawCommand
      .mockResolvedValueOnce({
        artifactId: "tool-result-1",
        found: true,
        offset: 0,
        nextOffset: 12,
        totalBytes: 12,
        eof: true,
        content: "{\"ok\":true}",
      })
      .mockResolvedValueOnce({
        artifactId: "tool-result-1",
        query: "ok",
        found: true,
        totalBytes: 12,
        matchCount: 1,
        truncated: false,
        matches: [
          { offset: 2, length: 2, snippetOffset: 0, snippet: "{\"ok\":true}" },
        ],
      })
      .mockResolvedValueOnce({
        artifactId: "tool-result-1",
        exported: true,
        filePath: "/tmp/result.json",
        byteCount: 13,
      });

    await agentHostService.readArtifact({
      projectId: "project-1",
      artifactId: "tool-result-1",
      maxBytes: 16_384,
    });
    await agentHostService.searchArtifact({
      projectId: "project-1",
      artifactId: "tool-result-1",
      query: "ok",
    });
    await agentHostService.exportArtifact({
      projectId: "project-1",
      artifactId: "tool-result-1",
      suggestedFileName: "result.json",
    });

    expect(mocks.invokeRawCommand.mock.calls).toEqual([
      [
        "agent_read_artifact",
        {
          request: {
            projectId: "project-1",
            artifactId: "tool-result-1",
            maxBytes: 16_384,
          },
        },
      ],
      [
        "agent_search_artifact",
        {
          request: {
            projectId: "project-1",
            artifactId: "tool-result-1",
            query: "ok",
          },
        },
      ],
      [
        "agent_export_artifact",
        {
          request: {
            projectId: "project-1",
            artifactId: "tool-result-1",
            suggestedFileName: "result.json",
          },
        },
      ],
    ]);
  });
});
