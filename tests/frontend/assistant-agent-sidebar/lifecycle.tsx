import { describe, expect, it, vi } from "vitest";
import {
  act,
  AssistantSidebar,
  baseEvent,
  createRoot,
  deferred,
  emit,
  fixture,
  flushAsyncWork,
  clickButton,
  clickButtonByAria,
  findButtonByAria,
  mocksForTests as mocks,
  setInputValue,
  setRangeValue,
  setTextareaValue,
  submitPrompt,
  useAiSettingsStore,
  useAssistantCliSetupStore,
  useAssistantComposerStore,
  useConnectionStore,
  useProjectStore,
  useSchemaStore,
  useTabStore,
  ApiError,
} from "./harness";

describe("AssistantSidebar Agent Host path: lifecycle", () => {
  it("routes Agent turns through Tauri and sends only user/final history", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(fixture.container.textContent).toContain("agent-model");
    expect(
      fixture.container.querySelector("header")?.textContent,
    ).not.toContain("agent-model");
    expect(
      fixture.container.querySelector(
        'button[aria-label^="Assistant model: agent-model"]',
      ),
    ).not.toBeNull();

    await submitPrompt(
      fixture.container,
      "Inspect the current database",
      "Run agent",
    );
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    const firstRequest = mocks.startTurn.mock.calls[0]?.[0];
    expect(firstRequest).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        profile: "agent",
        prompt: "Inspect the current database",
        contextVersion: expect.any(String),
        deadline: expect.any(Number),
      }),
    );
    expect(firstRequest.threadId).toEqual(expect.any(String));
    expect(firstRequest.messages).toEqual([]);
    expect(firstRequest.provider).toEqual(
      expect.objectContaining({
        baseUrl: "https://llm.example.test/v1",
        model: "agent-model",
      }),
    );
    expect(firstRequest.workspace).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        connectionId: "postgres-1",
        namespace: "public",
      }),
    );
    expect(
      firstRequest.tools.map((tool: { name: string }) => tool.name),
    ).toEqual([
      "connection.list",
      "connection.capabilities",
      "metadata.listCollections",
      "metadata.describeObject",
      "metadata.listObjects",
      "project.listFiles",
      "project.readFile",
      "project.writeFile",
      "provider.list",
      "query.explain",
      "query.runReadOnly",
      "workspace.getActiveTab",
      "shell.execute",
    ]);
    expect(
      firstRequest.tools.some(
        (tool: { name: string }) => tool.name === "editor.proposePatch",
      ),
    ).toBe(false);

    await emit({
      ...baseEvent(firstRequest.threadId, firstRequest.turnId, 1),
      type: "plan.changed",
      items: [
        {
          id: "step-1",
          title: "Read schema metadata",
          status: "running",
        },
      ],
    });
    const runningActivity = fixture.container.querySelector<HTMLElement>(
      `[data-assistant-live-process="${firstRequest.turnId}"]`,
    );
    expect(runningActivity?.textContent).toContain("Read schema metadata");
    expect(runningActivity?.dataset.processRunning).toBe("true");
    expect(
      runningActivity
        ?.querySelector('[data-assistant-process-item="plan:step-1"]')
        ?.querySelector("[data-assistant-process-item-title]")?.className,
    ).toContain("text-[hsl(var(--wb-accent))]");
    expect(runningActivity?.textContent).not.toContain("Working for");
    await emit({
      ...baseEvent(firstRequest.threadId, firstRequest.turnId, 2),
      type: "final.answer",
      content: "The users table has five columns.",
      artifacts: [],
    });
    await emit({
      ...baseEvent(firstRequest.threadId, firstRequest.turnId, 3),
      type: "turn.status",
      status: "completed",
    });

    expect(fixture.container.textContent).toContain("Worked for");
    expect(fixture.container.textContent).not.toContain("Read schema metadata");
    expect(fixture.container.textContent).toContain(
      "The users table has five columns.",
    );
    expect(
      fixture.container.querySelector<HTMLElement>(
        '[aria-label="Assistant process"]',
      ),
    ).not.toBeNull();
    const activityDisclosure = fixture.container.querySelector<HTMLElement>(
      `[data-assistant-process-disclosure="${firstRequest.turnId}"]`,
    );
    expect(activityDisclosure?.dataset.processRunning).toBe("false");
    expect(
      activityDisclosure?.querySelector("[data-assistant-process-headline]")
        ?.className,
    ).not.toContain("text-[hsl(var(--wb-accent))]");
    expect(
      activityDisclosure
        ?.querySelector("button")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    await act(async () => {
      activityDisclosure?.querySelector("button")?.click();
    });
    expect(fixture.container.textContent).toContain("Read schema metadata");
    expect(
      activityDisclosure?.querySelector(
        '[data-assistant-process-item="plan:step-1"]',
      ),
    ).not.toBeNull();

    await submitPrompt(fixture.container, "Now explain it", "Run agent");
    const secondRequest = mocks.startTurn.mock.calls[1]?.[0];
    expect(secondRequest.messages).toEqual([
      { role: "user", content: "Inspect the current database" },
      {
        role: "assistant",
        content: "The users table has five columns.",
      },
    ]);
    expect(JSON.stringify(secondRequest.messages)).not.toContain(
      "Read schema metadata",
    );
    expect(
      fixture.container.querySelectorAll("[data-assistant-turn-id]"),
    ).toHaveLength(2);
  });

  it("replays buffered activity after the Assistant panel is hidden and reopened without starting another turn", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(fixture.container, "Inspect users", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await act(async () => {
      fixture.root?.unmount();
      fixture.root = null;
      await flushAsyncWork();
    });
    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "final.answer",
      content: "Buffered while the shared panel was closed.",
      artifacts: [],
      citations: [],
    });

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(fixture.container.textContent).toContain(
      "Buffered while the shared panel was closed.",
    );
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    expect(
      Array.from(fixture.container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Resume",
      ),
    ).toBeUndefined();
  });

  it("persists a restart checkpoint before handing a turn to Agent Host", async () => {
    const order: string[] = [];
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    vi.clearAllMocks();
    mocks.saveConversationSnapshot.mockImplementation(async (snapshot) => {
      order.push("snapshot");
      expect(snapshot.turns.at(-1)).toEqual(
        expect.objectContaining({
          userMessage: "Persist this before starting",
          status: "planning",
        }),
      );
      expect(snapshot.resumeRequests).toHaveLength(1);
      return snapshot;
    });
    mocks.startTurn.mockImplementation(async (request) => {
      order.push("start");
      return {
        accepted: true,
        requestId: request.requestId,
        threadId: request.threadId,
        turnId: request.turnId,
      };
    });

    await submitPrompt(
      fixture.container,
      "Persist this before starting",
      "Run agent",
    );

    expect(order).toEqual(["snapshot", "start"]);
  });

  it("does not start an uncheckpointed turn when encrypted persistence fails", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    vi.clearAllMocks();
    mocks.saveConversationSnapshot.mockRejectedValue(
      new Error("encrypted snapshot unavailable"),
    );

    await submitPrompt(
      fixture.container,
      "Do not launch without recovery",
      "Run agent",
    );

    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(fixture.container.textContent).toContain(
      "encrypted snapshot unavailable",
    );
  });

  it("preserves the previous snapshot when starting a new chat", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(fixture.container, "Finish this first", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];
    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "turn.status",
      status: "completed",
    });
    vi.clearAllMocks();

    await clickButtonByAria(fixture.container, "Start a new assistant chat");

    expect(mocks.saveConversationSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        turns: [expect.objectContaining({ userMessage: "Finish this first" })],
        resumeRequests: [],
      }),
    );
    const nextConversationId =
      mocks.loadConversationSnapshot.mock.calls.at(-1)?.[1];
    expect(nextConversationId).toMatch(/:chat:[a-z0-9]+-[a-z0-9_-]{8}$/u);
    const persistedSelection = window.localStorage.getItem(
      "oxide-assistant-active-conversations-v1",
    );
    expect(persistedSelection).toContain(nextConversationId);
    expect(persistedSelection).not.toContain("Finish this first");
    expect(persistedSelection).not.toContain("secret");
    expect(persistedSelection).not.toContain("llm.example.test");
    expect(
      fixture.container.querySelectorAll("[data-assistant-turn-id]"),
    ).toHaveLength(0);
  });

  it("replays background turn events after the shared Assistant panel remounts", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(fixture.container, "Inspect while hidden", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await act(async () => fixture.root?.unmount());
    fixture.root = null;
    expect(mocks.listener).not.toBeNull();

    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "tool.started",
      callId: "hidden-schema-call",
      toolName: "metadata.describeObject",
      label: "Read hidden schema metadata",
    });
    await emit({
      ...baseEvent(request.threadId, request.turnId, 2),
      type: "tool.finished",
      callId: "hidden-schema-call",
      toolName: "metadata.describeObject",
      label: "Read hidden schema metadata",
      success: true,
    });
    await emit({
      ...baseEvent(request.threadId, request.turnId, 3),
      type: "answer.delta",
      content: "Recovered background answer",
      reset: true,
    });
    await emit({
      ...baseEvent(request.threadId, request.turnId, 4),
      type: "final.answer",
      content: "Recovered background answer",
      artifacts: [],
    });
    await emit({
      ...baseEvent(request.threadId, request.turnId, 5),
      type: "turn.status",
      status: "completed",
    });

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(fixture.container.textContent).toContain(
      "Recovered background answer",
    );
    const process = fixture.container.querySelector<HTMLElement>(
      `[data-assistant-process-disclosure="${request.turnId}"]`,
    );
    expect(process?.dataset.processRunning).toBe("false");
    await act(async () => process?.querySelector("button")?.click());
    expect(process?.textContent).toContain("Read hidden schema metadata");
    expect(fixture.container.textContent).not.toContain("Resume");
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);
  });

  it("cancels an active turn and isolates late events when the provider destination changes", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(
      fixture.container,
      "Inspect the original endpoint",
      "Run agent",
    );
    const originalRequest = mocks.startTurn.mock.calls[0]?.[0];

    await act(async () => {
      useAiSettingsStore.getState().updateSettings({
        baseUrl: "https://replacement.example.test/v1",
      });
      await flushAsyncWork();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await flushAsyncWork();
    });

    expect(mocks.cancelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: originalRequest.threadId,
        turnId: originalRequest.turnId,
      }),
    );
    expect(fixture.container.textContent).not.toContain(
      "Inspect the original endpoint",
    );

    await emit({
      ...baseEvent(originalRequest.threadId, originalRequest.turnId, 1),
      type: "final.answer",
      content: "This late response must not cross the endpoint boundary",
      artifacts: [],
    });

    expect(fixture.container.textContent).not.toContain(
      "This late response must not cross the endpoint boundary",
    );
    expect(fixture.container.querySelector("textarea")).not.toBeNull();
  });

  it("cancels an active turn and isolates late events when the project changes", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(
      fixture.container,
      "Inspect the original project",
      "Run agent",
    );
    const originalRequest = mocks.startTurn.mock.calls[0]?.[0];

    await act(async () => {
      useProjectStore.setState({
        ...useProjectStore.getState(),
        activeProjectId: "project-2",
        activeProjectName: "Project 2",
      });
      await flushAsyncWork();
    });

    expect(mocks.cancelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: originalRequest.threadId,
        turnId: originalRequest.turnId,
      }),
    );
    expect(fixture.container.textContent).not.toContain(
      "Inspect the original project",
    );

    await emit({
      ...baseEvent(originalRequest.threadId, originalRequest.turnId, 1),
      type: "final.answer",
      content: "This late response must not cross the project boundary",
      artifacts: [],
    });

    expect(fixture.container.textContent).not.toContain(
      "This late response must not cross the project boundary",
    );
  });
});
