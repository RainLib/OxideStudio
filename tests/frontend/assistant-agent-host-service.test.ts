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
    mocks.invokeRawCommand.mockResolvedValue({
      projectId: "project-1",
      clearedRecords: 7,
    });

    await expect(
      agentHostService.clearProjectState("project-1"),
    ).resolves.toEqual({ projectId: "project-1", clearedRecords: 7 });
    expect(mocks.invokeRawCommand).toHaveBeenCalledWith(
      "agent_clear_project_state",
      { projectId: "project-1" },
    );
  });
});
