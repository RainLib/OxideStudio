/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getContextMetrics: vi.fn(),
  loadConversationSnapshot: vi.fn(),
  saveConversationSnapshot: vi.fn(),
  importTextAttachment: vi.fn(),
  startTurn: vi.fn(),
  resumeTurn: vi.fn(),
  cancelTurn: vi.fn(),
  answerClarification: vi.fn(),
  approveAction: vi.fn(),
  detectCliProvider: vi.fn(),
  testAiProvider: vi.fn(),
  installCliProvider: vi.fn(),
  beginCliAuthentication: vi.fn(),
  listCliAuthenticationMethods: vi.fn(),
  getCliAuthenticationStatus: vi.fn(),
  cancelCliAuthentication: vi.fn(),
  listCliModels: vi.fn(),
  listCliCommands: vi.fn(),
  listener: null as ((event: any) => void) | null,
}));

vi.mock("@/services/tauri/agent-host.service", () => ({
  AGENT_HOST_PROTOCOL_VERSION: 1,
  agentHostService: {
    getStatus: mocks.getStatus,
    getContextMetrics: mocks.getContextMetrics,
    loadConversationSnapshot: mocks.loadConversationSnapshot,
    saveConversationSnapshot: mocks.saveConversationSnapshot,
    importTextAttachment: mocks.importTextAttachment,
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

vi.mock("@/services/tauri/ai.service", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/services/tauri/ai.service")
  >();
  return {
    ...original,
    aiService: {
      ...original.aiService,
      detectCliProvider: mocks.detectCliProvider,
      testProvider: mocks.testAiProvider,
      installCliProvider: mocks.installCliProvider,
      beginCliAuthentication: mocks.beginCliAuthentication,
      listCliAuthenticationMethods: mocks.listCliAuthenticationMethods,
      getCliAuthenticationStatus: mocks.getCliAuthenticationStatus,
      cancelCliAuthentication: mocks.cancelCliAuthentication,
      listCliModels: mocks.listCliModels,
      listCliCommands: mocks.listCliCommands,
    },
  };
});

import {
  AssistantSidebar,
  assistantToolManifestForProfile,
} from "@/components/workspace/AssistantSidebar";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useAssistantComposerStore } from "@/store/useAssistantComposerStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialAiSettings = useAiSettingsStore.getState();
const initialConnectionState = useConnectionStore.getState();
const initialProjectState = useProjectStore.getState();
const initialSchemaState = useSchemaStore.getState();
const initialTabState = useTabStore.getState();

describe("AssistantSidebar Agent Host path", () => {
  it("filters tools by Chat, Plan, and Agent authority", () => {
    const tools = [
      {
        name: "workspace.getActiveTab",
        description: "Read active tab",
        inputSchema: { type: "object" },
        permissions: ["read" as const],
      },
      {
        name: "query.runReadOnly",
        description: "Run read-only query",
        inputSchema: { type: "object" },
        permissions: ["read" as const],
      },
      {
        name: "project.writeFile",
        description: "Write file",
        inputSchema: { type: "object" },
        permissions: ["write" as const],
      },
    ];

    expect(
      assistantToolManifestForProfile("chat", tools).map((tool) => tool.name),
    ).toEqual(["workspace.getActiveTab"]);
    expect(
      assistantToolManifestForProfile("plan", tools).map((tool) => tool.name),
    ).toEqual(["workspace.getActiveTab", "query.runReadOnly"]);
    expect(
      assistantToolManifestForProfile("agent", tools).map((tool) => tool.name),
    ).toEqual([
      "workspace.getActiveTab",
      "query.runReadOnly",
      "project.writeFile",
    ]);
  });

  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubEnv("VITE_ASSISTANT_LEGACY_RUNTIME", "0");
    vi.clearAllMocks();
    mocks.listener = null;
    mocks.loadConversationSnapshot.mockResolvedValue(null);
    mocks.saveConversationSnapshot.mockResolvedValue({
      projectId: "default",
      threadId: "thread",
      turns: [],
      resumeRequests: [],
      updatedAt: 1,
    });
    mocks.importTextAttachment.mockResolvedValue(null);
    mocks.getStatus.mockResolvedValue({
      protocolVersion: 1,
      available: true,
      state: "ready",
      capabilities: ["chat", "plan", "agent"],
      installedTools: [
        "project.listFiles",
        "project.readFile",
        "project.writeFile",
        "connection.list",
        "connection.capabilities",
        "provider.list",
        "workspace.getActiveTab",
        "metadata.listCollections",
        "metadata.listObjects",
        "metadata.describeObject",
        "query.runReadOnly",
        "query.explain",
        "shell.execute",
      ],
      storageMode: "project",
      binaryPath: "/tmp/oxide-agent-host",
      lastError: null,
    });
    mocks.getContextMetrics.mockResolvedValue({
      projectId: "project-1",
      compaction: null,
      modelUsage: null,
      updatedAt: 0,
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
    mocks.detectCliProvider.mockResolvedValue({
      provider: "codex-cli",
      available: true,
      executablePath: "C:/tools/codex.cmd",
      version: "codex 1.0.0",
      message: "Codex CLI is available",
    });
    mocks.testAiProvider.mockResolvedValue({
      message: "CLI is installed and authenticated",
      model: "default",
      executablePath: "C:/tools/codex.cmd",
      version: "codex 1.0.0",
    });
    mocks.installCliProvider.mockResolvedValue({
      provider: "codex-cli",
      executablePath: "C:/managed/codex.cmd",
      message: "Codex CLI installed",
    });
    mocks.beginCliAuthentication.mockResolvedValue({
      provider: "codex-cli",
      sessionId: "auth-session-1",
      message: "Secure browser sign-in opened",
    });
    mocks.listCliAuthenticationMethods.mockResolvedValue([
      {
        id: "browser",
        name: "ChatGPT / Codex account",
        description: "Secure browser sign-in",
      },
    ]);
    mocks.getCliAuthenticationStatus.mockResolvedValue({
      sessionId: "auth-session-1",
      provider: "codex-cli",
      phase: "waiting-for-callback",
      message: "Complete sign-in in your browser",
      methodId: "browser",
    });
    mocks.cancelCliAuthentication.mockResolvedValue({
      sessionId: "auth-session-1",
      provider: "codex-cli",
      phase: "cancelled",
      message: "Sign-in was cancelled",
      methodId: "browser",
    });
    mocks.listCliModels.mockResolvedValue([
      { id: "default", label: "Default", isDefault: true },
    ]);
    mocks.listCliCommands.mockResolvedValue([]);
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
    useAssistantComposerStore.setState({ request: null });
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
    useAssistantComposerStore.setState({ request: null });
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("routes Agent turns through Tauri and sends only user/final history", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(container.textContent).toContain("agent-model");
    expect(container.querySelector("header")?.textContent).not.toContain(
      "agent-model",
    );
    expect(
      container.querySelector(
        'button[aria-label^="Assistant model: agent-model"]',
      ),
    ).not.toBeNull();

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
    expect(firstRequest.tools.map((tool: { name: string }) => tool.name)).toEqual([
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
    const runningActivity = container.querySelector<HTMLElement>(
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

    expect(container.textContent).toContain("Worked for");
    expect(container.textContent).not.toContain("Read schema metadata");
    expect(container.textContent).toContain("The users table has five columns.");
    expect(
      container.querySelector<HTMLElement>(
        '[aria-label="Assistant process"]',
      ),
    ).not.toBeNull();
    const activityDisclosure = container.querySelector<HTMLElement>(
      `[data-assistant-process-disclosure="${firstRequest.turnId}"]`,
    );
    expect(activityDisclosure?.dataset.processRunning).toBe("false");
    expect(
      activityDisclosure?.querySelector("[data-assistant-process-headline]")
        ?.className,
    ).not.toContain("text-[hsl(var(--wb-accent))]");
    expect(
      activityDisclosure?.querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("false");
    await act(async () => {
      activityDisclosure?.querySelector("button")?.click();
    });
    expect(container.textContent).toContain("Read schema metadata");
    expect(
      activityDisclosure?.querySelector(
        '[data-assistant-process-item="plan:step-1"]',
      ),
    ).not.toBeNull();

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

  it("does not overwrite an existing draft when a query-error fix prompt arrives", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(textarea, "Keep my draft");
      textarea.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: "Keep my draft" }),
      );
      useAssistantComposerStore.getState().queueQueryErrorFix("query-1", {
        code: "QUERY_EXECUTION_FAILED",
        message: "syntax error",
        retryable: false,
        database: {
          driver: "postgres",
          sqlState: "42601",
          documentLine: 1,
          documentColumn: 8,
        },
      });
      await flushAsyncWork();
    });

    expect(textarea.value).toBe("Keep my draft");
    expect(
      container.querySelector("[data-assistant-compose-suggestion]"),
    ).not.toBeNull();

    await clickButton(container, "Use prompt");
    expect(textarea.value).toContain("SQLSTATE 42601");
    expect(textarea.value).toContain("Do not run the SQL");
    expect(useAssistantComposerStore.getState().request).toBeNull();
  });

  it("keeps mixed Chinese and English IME composition intact and does not submit its Enter", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;

    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      setter?.call(textarea, "查询userProfile数据");
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "查询userProfile数据",
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          keyCode: 229,
          bubbles: true,
        }),
      );
    });

    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(textarea.value).toBe("查询userProfile数据");

    await act(async () => {
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "查询userProfile数据",
        }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await flushAsyncWork();
    });

    expect(mocks.startTurn).toHaveBeenCalledOnce();
    expect(mocks.startTurn.mock.calls[0]?.[0].prompt).toBe("查询userProfile数据");
  });

  it("restores completed project conversations from the encrypted host snapshot", async () => {
    mocks.loadConversationSnapshot.mockResolvedValueOnce({
      projectId: "project-1",
      threadId: "thread:restored",
      turns: [
        {
          id: "turn:restored",
          requestId: "request:restored",
          threadId: "thread:restored",
          projectId: "project-1",
          requestedMode: "agent",
          mode: "agent",
          userMessage: "What changed in the project?",
          status: "completed",
          process: [],
          clarifications: [],
          approvals: [],
          draft: "",
          final: {
            content: "Two SQL files changed.",
            attachments: [],
            artifactRefs: [],
            createdAt: 2,
          },
          error: null,
          errorDetail: null,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      resumeRequests: [],
      updatedAt: 2,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("What changed in the project?");
    expect(container.textContent).toContain("Two SQL files changed.");
  });

  it("recovers a legacy snapshot whose final content field is missing", async () => {
    mocks.loadConversationSnapshot.mockResolvedValueOnce({
      projectId: "project-1",
      threadId: "thread:legacy",
      turns: [
        {
          id: "turn:legacy",
          requestId: "request:legacy",
          threadId: "thread:legacy",
          projectId: "project-1",
          requestedMode: "agent",
          mode: "agent",
          userMessage: "Restore the previous response",
          status: "completed",
          process: [],
          clarifications: [],
          approvals: [],
          draft: "Recovered streamed response.",
          final: {
            attachments: [],
            artifactRefs: [],
            createdAt: 2,
          },
          error: null,
          errorDetail: null,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      resumeRequests: [],
      updatedAt: 2,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Recovered streamed response.");
    expect(container.textContent).not.toContain("ErrorBoundary");
  });

  it("turns an Assistant SQL code block into a review-only editor patch", async () => {
    mocks.loadConversationSnapshot.mockResolvedValueOnce({
      projectId: "project-1",
      threadId: "thread:sql-fix",
      turns: [
        {
          id: "turn:sql-fix",
          requestId: "request:sql-fix",
          threadId: "thread:sql-fix",
          projectId: "project-1",
          requestedMode: "agent",
          mode: "agent",
          userMessage: "Fix the current query error",
          status: "completed",
          process: [],
          clarifications: [],
          approvals: [],
          draft: "",
          final: {
            content: "Use the corrected statement:\n```sql\nSELECT id FROM users;\n```",
            attachments: [],
            artifactRefs: [],
            createdAt: 2,
          },
          error: null,
          errorDetail: null,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      resumeRequests: [],
      updatedAt: 2,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await clickButtonByAria(container, "Preview SQL in editor");

    expect(useTabStore.getState().tabs[0]).toMatchObject({
      sql: "SELECT * FROM users",
      editorPatchPreview: {
        title: "Review AI SQL correction",
        originalText: "SELECT * FROM users",
        replacement: "SELECT id FROM users;",
      },
    });
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
      context: "Your answer will resume this same turn.",
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

    const dock = document.body.querySelector<HTMLElement>(
      "[data-assistant-clarification-dock]",
    );
    const conversation = container.querySelector<HTMLElement>(
      '[aria-label="Assistant conversation"]',
    );
    expect(dock?.textContent).toContain("Which source should be on the left?");
    expect(dock?.textContent).not.toContain(
      "Which source should be on the right?",
    );
    expect(conversation?.textContent).not.toContain(
      "Which source should be on the left?",
    );
    expect(dock?.textContent).not.toContain(
      "Your answer will resume this same turn.",
    );
    expect(container.querySelector("textarea")).not.toBeNull();

    await clickButton(document.body, "Primary");
    expect(dock?.textContent).not.toContain("Which source should be on the left?");
    expect(dock?.textContent).toContain("Which source should be on the right?");
    expect(mocks.answerClarification).not.toHaveBeenCalled();

    await clickButtonByAria(document.body, "Previous clarification question");
    expect(dock?.textContent).toContain("Which source should be on the left?");
    await clickButton(document.body, "Staging");
    expect(dock?.textContent).toContain("Which source should be on the right?");
    expect(document.body.textContent).not.toContain("Confirm answers");
    await clickButton(document.body, "Archive");

    expect(mocks.answerClarification).toHaveBeenCalledWith(
      expect.objectContaining({
        clarificationId: "clarification-1",
        answers: { left: "staging", right: "archive" },
        contextVersion: request.contextVersion,
      }),
    );
    expect(container.textContent).toContain("Confirmed 2 answers");
    const confirmationActivity = container.querySelector<HTMLElement>(
      `[data-assistant-live-process="${request.turnId}"]`,
    );
    expect(
      container.querySelector(
        `[data-assistant-process-disclosure="${request.turnId}"]`,
      ),
    ).toBeNull();
    const confirmation = confirmationActivity?.querySelector<HTMLElement>(
      '[data-assistant-process-item="clarification:clarification-1"]',
    );
    await act(async () => {
      confirmation
        ?.querySelector<HTMLButtonElement>(
          '[data-assistant-process-item-toggle="clarification:clarification-1"]',
        )
        ?.click();
    });
    expect(confirmation?.textContent).toContain(
      "Which source should be on the left?",
    );
    expect(confirmation?.textContent).toContain("Staging");
  });

  it("approves against the turn's pinned workspace after the live schema changes", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Create a project SQL file", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "approval",
      approvalId: "approval-write-1",
      callId: "call-write-1",
      inputDigest: "sha256:write-1",
      toolName: "project.writeFile",
      title: "Approve project.writeFile",
      risk: "write",
      summary: "Create sql/report.sql with 120 characters.",
    });

    await act(async () => {
      useSchemaStore.setState({ currentSchema: "another_schema" });
      await flushAsyncWork();
    });
    await clickButton(container, "Approve once");

    expect(mocks.approveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: "approval-write-1",
        decision: "approve",
        contextVersion: request.contextVersion,
      }),
    );
    expect(container.textContent).not.toContain(
      "The workspace changed while this request was running",
    );
  });

  it("resumes a paused turn with its pinned workspace context", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Inspect the selected database", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "failure",
      code: "provider_temporarily_unavailable",
      message: "Temporary provider failure",
      retryable: true,
    });

    await act(async () => {
      useSchemaStore.setState({ currentSchema: "another_schema" });
      await flushAsyncWork();
    });
    await clickButton(container, "Resume");

    expect(mocks.resumeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        contextVersion: request.contextVersion,
        workspace: expect.objectContaining({
          fingerprint: request.workspace.fingerprint,
        }),
      }),
    );

    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "answer.delta",
      content: "Resumed from checkpoint",
      reset: true,
    });
    expect(container.textContent).not.toContain("Resumed from checkpoint");
    await emit({
      ...baseEvent(request.threadId, request.turnId, 2),
      type: "final.answer",
      content: "Resumed from checkpoint",
      artifacts: [],
    });
    await emit({
      ...baseEvent(request.threadId, request.turnId, 3),
      type: "turn.status",
      status: "completed",
    });
    expect(container.textContent).toContain("Resumed from checkpoint");
  });

  it("onboards the first Assistant provider before showing the composer", async () => {
    useAiSettingsStore.setState({ enabled: false });
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Choose how Assistant runs");
    expect(container.textContent).toContain("Codex CLI");
    expect(container.textContent).toContain("CodeBuddy CLI");
    expect(container.querySelector("textarea")).toBeNull();

    await clickButtonByAria(container, "Use Oxide Assistant");
    expect(useAiSettingsStore.getState()).toEqual(
      expect.objectContaining({
        enabled: true,
        provider: "openai-compatible",
      }),
    );
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("switches Assistant providers from the persistent runtime control", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(container, "Assistant provider: Oxide Assistant");
    expect(document.body.textContent).toContain("Run Assistant with");
    expect(document.body.textContent).toContain(
      "SQL inline completion keeps its separate HTTP provider",
    );

    await clickButtonByAria(document.body, "Use Codex CLI");
    expect(useAiSettingsStore.getState()).toEqual(
      expect.objectContaining({
        enabled: true,
        provider: "codex-cli",
      }),
    );
    expect(
      container.querySelector(
        'button[aria-label^="Assistant provider: Codex CLI"]',
      ),
    ).not.toBeNull();
    expect(mocks.loadConversationSnapshot).toHaveBeenCalledWith(
      "project-1",
      "provider:codex-cli",
    );
  });

  it("surfaces provider-native CLI commands beside the composer", async () => {
    mocks.listCliCommands.mockResolvedValue([
      {
        name: "review",
        description: "Start the provider review workflow",
        argumentHint: "optional review focus",
      },
      {
        name: "status",
        description: "Show the active provider status",
      },
    ]);

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(container, "Assistant provider: Oxide Assistant");
    await clickButtonByAria(document.body, "Use Codex CLI");
    await act(async () => {
      await flushAsyncWork();
    });

    const commandTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Provider commands (2)"]',
    );
    expect(commandTrigger).not.toBeNull();
    await act(async () => {
      commandTrigger!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      await flushAsyncWork();
    });
    expect(document.body.textContent).toContain("/review");
    expect(document.body.textContent).toContain(
      "Start the provider review workflow",
    );
    expect(document.body.textContent).toContain("optional review focus");
    expect(document.body.textContent).toContain("/status");
  });

  it("keeps the conversation surface mounted while a ready CLI is revalidated", async () => {
    const detection = deferred<{
      provider: "codex-cli";
      available: boolean;
      executablePath: string;
      version: string;
      message: string;
    }>();
    mocks.detectCliProvider.mockReturnValueOnce(detection.promise);

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(container, "Assistant provider: Oxide Assistant");
    await clickButtonByAria(document.body, "Use Codex CLI");

    expect(container.textContent).not.toContain("Set up Codex CLI");
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(
      container
        .querySelector("button[data-assistant-provider]")
        ?.getAttribute("title"),
    ).toContain("Verifying CLI");

    await act(async () => {
      detection.resolve({
        provider: "codex-cli",
        available: true,
        executablePath: "C:/tools/codex.cmd",
        version: "codex 1.0.0",
        message: "Codex CLI is available",
      });
      await flushAsyncWork();
    });

    expect(container.textContent).not.toContain("Set up Codex CLI");
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("guides a missing CLI through managed install and provider authentication", async () => {
    mocks.detectCliProvider
      .mockResolvedValueOnce({
        provider: "codex-cli",
        available: false,
        message: "Codex CLI is not installed",
      })
      .mockResolvedValueOnce({
        provider: "codex-cli",
        available: true,
        executablePath: "C:/managed/codex.cmd",
        version: "codex 1.0.0",
        message: "Codex CLI is available",
      });
    mocks.testAiProvider.mockRejectedValueOnce(
      new Error("Codex CLI is not authenticated. Sign in and try again."),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await clickButtonByAria(container, "Assistant provider: Oxide Assistant");
    await clickButtonByAria(document.body, "Use Codex CLI");
    await act(async () => {
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Set up Codex CLI");
    expect(container.textContent).toContain("Install for OxideStudio");

    await clickButton(container, "Install for OxideStudio");
    await act(async () => {
      await flushAsyncWork();
    });

    expect(mocks.installCliProvider).toHaveBeenCalledWith("codex-cli");
    expect(useAiSettingsStore.getState().codexCliPath).toBe(
      "C:/managed/codex.cmd",
    );
    await act(async () => {
      await flushAsyncWork();
    });
    expect(container.textContent).toContain("ChatGPT / Codex account");

    await clickButton(container, "ChatGPT / Codex account");
    expect(mocks.beginCliAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "codex-cli",
        executablePath: "C:/managed/codex.cmd",
      }),
      "browser",
    );
    expect(container.textContent).toContain("Complete sign-in in your browser");
  });

  it("manages the model from the composer and opens the AI settings section", async () => {
    const settingsEvents: unknown[] = [];
    const handleSettings = (event: Event) => {
      settingsEvents.push((event as CustomEvent).detail);
    };
    window.addEventListener("oxide:open-settings", handleSettings);
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(<AssistantSidebar />);
        await flushAsyncWork();
      });

      await clickButtonByAria(container, "Assistant model: agent-model");
      const modelInput = document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Model identifier"]',
      );
      expect(modelInput).not.toBeNull();
      await setInputValue(modelInput!, "agent-model-v2");
      await clickButton(document.body, "Apply");
      expect(useAiSettingsStore.getState().model).toBe("agent-model-v2");
      expect(container.querySelector("header")?.textContent).not.toContain(
        "agent-model-v2",
      );

      await clickButtonByAria(container, "Assistant model: agent-model-v2");
      await clickButton(document.body, "AI settings");
      expect(settingsEvents).toEqual([{ section: "ai" }]);
    } finally {
      window.removeEventListener("oxide:open-settings", handleSettings);
    }
  });

  it("blocks tool modes when the model cannot call tools but keeps Chat usable", async () => {
    useAiSettingsStore.setState({ toolCalling: false, assistantMode: "agent" });
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await submitPrompt(container, "Inspect the database", "Run agent");
    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Agent mode requires a model with tool calling",
    );

    await act(async () => {
      useAiSettingsStore.getState().updateSettings({ assistantMode: "chat" });
      await flushAsyncWork();
    });
    await submitPrompt(container, "Explain normalization", "Send");
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    expect(mocks.startTurn.mock.calls[0]?.[0].profile).toBe("chat");
  });

  it("treats an empty capability list as a starting runtime instead of rejecting Plan", async () => {
    useAiSettingsStore.setState({ assistantMode: "plan", toolCalling: true });
    mocks.getStatus.mockResolvedValue({
      protocolVersion: 1,
      available: false,
      state: "starting",
      capabilities: [],
      storageMode: "project",
      binaryPath: "/tmp/oxide-agent-host",
      lastError: null,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(
      container.querySelector(
        'button[aria-label*="Starting AI runtime"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain(
      "The AI runtime does not support Plan mode",
    );
  });

  it("keeps polling a starting runtime until the sidecar becomes ready", async () => {
    vi.useFakeTimers();
    mocks.getStatus
      .mockResolvedValueOnce({
        protocolVersion: 1,
        available: false,
        state: "starting",
        capabilities: [],
        storageMode: "project",
        binaryPath: "/tmp/oxide-agent-host",
        lastError: null,
      })
      .mockResolvedValue({
        protocolVersion: 1,
        available: true,
        state: "ready",
        capabilities: ["chat", "plan", "agent"],
        storageMode: "project",
        binaryPath: "/tmp/oxide-agent-host",
        lastError: null,
      });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await flushAsyncWork();
    });

    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('button[aria-label*="Starting AI runtime"]'),
    ).toBeNull();
  });

  it("does not reject Plan when a transitional host has not published capabilities", async () => {
    useAiSettingsStore.setState({ assistantMode: "plan", toolCalling: true });
    mocks.getStatus.mockResolvedValue({
      protocolVersion: 1,
      available: true,
      state: "starting",
      capabilities: [],
      storageMode: "project",
      binaryPath: "/tmp/oxide-agent-host",
      lastError: null,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Explain the active SQL", "Create plan");

    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "has not published its installed tool catalog",
    );
    expect(container.textContent).not.toContain(
      "The AI runtime does not support Plan mode",
    );
  });

  it("surfaces a 401 at the model control and allows an explicit retry", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Inspect the database", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "failure",
      code: "provider_authentication_failed",
      message: "401 Unauthorized: invalid API key",
      retryable: false,
    });

    expect(
      container.querySelector(
        'button[aria-label*="Authentication failed"]',
      ),
    ).not.toBeNull();
    await submitPrompt(container, "Try again", "Run agent");
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);

    await clickButtonByAria(container, "Assistant model: agent-model");
    await clickButton(document.body, "Retry");
    await submitPrompt(container, "Try again", "Run agent");
    expect(mocks.startTurn).toHaveBeenCalledTimes(2);
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

async function clickButtonByAria(container: HTMLElement, labelPrefix: string) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(`button[aria-label^="${labelPrefix}"]`)
      ?.click();
    await flushAsyncWork();
  });
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
