/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startTurn: vi.fn(),
  resumeTurn: vi.fn(),
  cancelTurn: vi.fn(),
  answerClarification: vi.fn(),
  approveAction: vi.fn(),
  listener: null as ((event: any) => void) | null,
}));

vi.mock("@/services/tauri/agent-host.service", () => ({
  AGENT_HOST_PROTOCOL_VERSION: 1,
  agentHostService: {
    getStatus: mocks.getStatus,
    startTurn: mocks.startTurn,
    resumeTurn: mocks.resumeTurn,
    cancelTurn: mocks.cancelTurn,
    answerClarification: mocks.answerClarification,
    approveAction: mocks.approveAction,
    listen: vi.fn(async (listener) => {
      mocks.listener = listener;
      return () => {
        mocks.listener = null;
      };
    }),
  },
  isAgentHostUnavailableError: (error: unknown) =>
    error instanceof Error && /unavailable|not found/iu.test(error.message),
}));

import { AssistantSidebar } from "@/components/workspace/AssistantSidebar";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialAiSettings = useAiSettingsStore.getState();
const initialConnectionState = useConnectionStore.getState();
const initialProjectState = useProjectStore.getState();
const initialSchemaState = useSchemaStore.getState();
const initialTabState = useTabStore.getState();

describe("AssistantSidebar Agent Host path", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubEnv("VITE_ASSISTANT_LEGACY_RUNTIME", "0");
    vi.clearAllMocks();
    mocks.listener = null;
    mocks.getStatus.mockResolvedValue({
      protocolVersion: 1,
      available: true,
      state: "ready",
      capabilities: ["chat", "plan", "agent"],
      storageMode: "project",
      binaryPath: "/tmp/oxide-agent-host",
      lastError: null,
    });
    mocks.startTurn.mockImplementation(async (request) => ({
      accepted: true,
      requestId: request.requestId,
      turnId: request.turnId,
      threadId: request.threadId,
    }));
    mocks.cancelTurn.mockResolvedValue({ accepted: true });
    mocks.answerClarification.mockResolvedValue({ accepted: true });
    mocks.approveAction.mockResolvedValue({ accepted: true });
    mocks.resumeTurn.mockImplementation(async (request) => ({
      accepted: true,
      requestId: request.requestId,
      turnId: request.turnId,
      threadId: request.threadId,
    }));
    useAiSettingsStore.setState(
      {
        ...initialAiSettings,
        enabled: true,
        assistantMode: "agent",
        baseUrl: "https://llm.example.test/v1",
        model: "agent-model",
        apiKey: "secret",
      },
      true,
    );
    useProjectStore.setState({
      ...initialProjectState,
      activeProjectId: "project-1",
      activeProjectName: "Project 1",
    });
    useConnectionStore.setState({
      ...initialConnectionState,
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/app",
        },
      ],
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
    });
    useSchemaStore.setState({
      ...initialSchemaState,
      currentSchema: "public",
    });
    useTabStore.setState({
      ...initialTabState,
      tabs: [
        {
          id: "query-1",
          title: "Query #1",
          type: "query",
          sql: "SELECT * FROM users",
          connectionId: "postgres-1",
          schemaName: "public",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
      activeTabId: "query-1",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    container.remove();
    useAiSettingsStore.setState(initialAiSettings, true);
    useConnectionStore.setState(initialConnectionState, true);
    useProjectStore.setState(initialProjectState, true);
    useSchemaStore.setState(initialSchemaState, true);
    useTabStore.setState(initialTabState, true);
    vi.unstubAllEnvs();
  });

  it("routes Agent turns through Tauri and sends only user/final history", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(container.textContent).toContain("agent-model");

    await submitPrompt(container, "Inspect the current database", "Run agent");
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
    expect(firstRequest.tools).toEqual(expect.any(Array));

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

    expect(container.textContent).toContain("Read schema metadata");
    expect(container.textContent).toContain("The users table has five columns.");
    expect(
      container.querySelector<HTMLDetailsElement>(
        'details[aria-label="Assistant process"]',
      )?.open,
    ).toBe(false);

    await submitPrompt(container, "Now explain it", "Run agent");
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
    expect(container.querySelectorAll("[data-assistant-turn-id]")).toHaveLength(2);
  });

  it("keeps the workspace available when the Agent Host command is missing", async () => {
    mocks.getStatus.mockRejectedValueOnce(new Error("command not found"));
    mocks.startTurn.mockRejectedValueOnce(new Error("agent host unavailable"));
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("AI agent is unavailable");
    expect(container.querySelector("textarea")).not.toBeNull();
    await submitPrompt(container, "Hello", "Run agent");
    expect(container.textContent).toContain("database workspace remains fully usable");
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("lets the model ask grouped clarification questions before resuming", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Compare the selected databases", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "clarification",
      clarificationId: "clarification-1",
      context: "The comparison scope is ambiguous.",
      questions: [
        {
          id: "left",
          prompt: "Which source should be on the left?",
          options: [
            { id: "primary", label: "Primary" },
            { id: "staging", label: "Staging" },
          ],
          allowFreeText: true,
        },
        {
          id: "right",
          prompt: "Which source should be on the right?",
          options: [
            { id: "staging", label: "Staging" },
            { id: "archive", label: "Archive" },
          ],
          allowFreeText: true,
        },
      ],
    });

    await clickButton(container, "Primary");
    expect(mocks.answerClarification).not.toHaveBeenCalled();
    await clickButton(container, "Archive");
    expect(mocks.answerClarification).toHaveBeenCalledWith(
      expect.objectContaining({
        clarificationId: "clarification-1",
        answers: { left: "primary", right: "archive" },
      }),
    );
  });

  it("does not invoke Agent Host when no AI provider is configured", async () => {
    useAiSettingsStore.setState({ enabled: false });
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await submitPrompt(container, "Hello", "Run agent");
    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Configure an AI provider");
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});

async function submitPrompt(
  container: HTMLElement,
  prompt: string,
  ariaLabel: string,
) {
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(textarea, prompt);
    textarea.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: prompt }),
    );
    await flushAsyncWork();
    container
      .querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`)
      ?.click();
    await flushAsyncWork();
  });
}

async function emit(event: any) {
  await act(async () => {
    mocks.listener?.(event);
    await flushAsyncWork();
  });
}

async function clickButton(container: HTMLElement, label: string) {
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === label)
      ?.click();
    await flushAsyncWork();
  });
}

function baseEvent(threadId: string, turnId: string, sequence: number) {
  return {
    threadId,
    turnId,
    sequence,
    occurredAt: 1_000 + sequence,
  };
}

async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}
