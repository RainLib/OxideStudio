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
  getTurnRuntimeStatus: vi.fn(),
  loadTurnJournal: vi.fn(),
  answerClarification: vi.fn(),
  approveAction: vi.fn(),
  detectCliProvider: vi.fn(),
  testAiProvider: vi.fn(),
  beginCliInstallation: vi.fn(),
  getCliInstallationStatus: vi.fn(),
  beginCliAuthentication: vi.fn(),
  listCliAuthenticationMethods: vi.fn(),
  getCliAuthenticationStatus: vi.fn(),
  cancelCliAuthentication: vi.fn(),
  listCliModels: vi.fn(),
  listCliEfforts: vi.fn(),
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
    getTurnRuntimeStatus: mocks.getTurnRuntimeStatus,
    loadTurnJournal: mocks.loadTurnJournal,
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
  const original =
    await importOriginal<typeof import("@/services/tauri/ai.service")>();
  return {
    ...original,
    aiService: {
      ...original.aiService,
      detectCliProvider: mocks.detectCliProvider,
      testProvider: mocks.testAiProvider,
      beginCliInstallation: mocks.beginCliInstallation,
      getCliInstallationStatus: mocks.getCliInstallationStatus,
      beginCliAuthentication: mocks.beginCliAuthentication,
      listCliAuthenticationMethods: mocks.listCliAuthenticationMethods,
      getCliAuthenticationStatus: mocks.getCliAuthenticationStatus,
      cancelCliAuthentication: mocks.cancelCliAuthentication,
      listCliModels: mocks.listCliModels,
      listCliEfforts: mocks.listCliEfforts,
      listCliCommands: mocks.listCliCommands,
    },
  };
});

import {
  AssistantSidebar,
  assistantConversationId,
  assistantConversationContentVersion,
  assistantToolManifestForProfile,
  cliSetupForProviderIdentity,
} from "@/components/workspace/AssistantSidebar";
import { resetAiCliCatalogForTests } from "@/hooks/useAiCliCatalog";
import { resetAssistantAgentRuntimeForTests } from "@/hooks/useAssistantAgentSession";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useAssistantComposerStore } from "@/store/useAssistantComposerStore";
import { useAssistantCliSetupStore } from "@/store/useAssistantCliSetupStore";
import { ApiError } from "@/services/tauri/types";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialAiSettings = useAiSettingsStore.getState();
const initialConnectionState = useConnectionStore.getState();
const initialProjectState = useProjectStore.getState();
const initialSchemaState = useSchemaStore.getState();
const initialTabState = useTabStore.getState();

describe("AssistantSidebar Agent Host path", () => {
  it("isolates HTTP conversation history by non-secret destination", () => {
    const first = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://one.example.com/v1/",
      apiKey: "secret-one",
      model: "model-a",
    });
    const rotatedCredential = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://one.example.com/v1",
      apiKey: "secret-two",
      model: "model-b",
    });
    const otherDestination = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://two.example.com/v1",
      apiKey: "secret-one",
      model: "model-a",
    });
    const caseSensitivePath = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://one.example.com/V1",
      apiKey: "secret-one",
      model: "model-a",
    });
    const embeddedCredential = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://user:password@one.example.com/v1",
      apiKey: "secret-one",
      model: "model-a",
    });

    expect(first).toBe(rotatedCredential);
    expect(otherDestination).not.toBe(first);
    expect(caseSensitivePath).not.toBe(first);
    expect(embeddedCredential).toBe(first);
    expect(first).not.toContain("secret");
    expect(first).toMatch(/^provider:http:[0-9a-f]{32}$/u);
  });

  it("isolates CLI conversation history by non-secret provider profile", () => {
    const primary = assistantConversationId({
      kind: "codex-cli",
      profileId: "codex-cli:primary",
      executablePath: "C:/tools/codex.cmd",
      model: "gpt-5.6-sol",
    });
    const sameProfileDifferentModel = assistantConversationId({
      kind: "codex-cli",
      profileId: "codex-cli:primary",
      executablePath: "C:/tools/codex.cmd",
      model: "gpt-5.6-terra",
    });
    const anotherProfile = assistantConversationId({
      kind: "codex-cli",
      profileId: "codex-cli:work",
      executablePath: "C:/tools/codex.cmd",
      model: "gpt-5.6-sol",
    });
    const anotherExecutable = assistantConversationId({
      kind: "codex-cli",
      profileId: "codex-cli:primary",
      executablePath: "D:/portable/codex.cmd",
      model: "gpt-5.6-sol",
    });
    const anotherProvider = assistantConversationId({
      kind: "codebuddy-cli",
      profileId: "codex-cli:primary",
      executablePath: "C:/tools/codex.cmd",
      model: "default",
    });

    expect(sameProfileDifferentModel).toBe(primary);
    expect(anotherProfile).not.toBe(primary);
    expect(anotherExecutable).not.toBe(primary);
    expect(anotherProvider).not.toBe(primary);
    expect(primary).toMatch(/^provider:cli:[0-9a-f]{32}$/u);
    expect(primary).not.toContain("primary");
    expect(primary).not.toContain("C:/tools");
  });

  it("does not reuse a ready CLI setup after its identity changes", () => {
    const ready = {
      phase: "ready" as const,
      message: "CLI is installed and authenticated",
      executablePath: "C:/tools/codex.cmd",
    };

    expect(
      cliSetupForProviderIdentity(ready, "identity:old", "identity:old", "Checking"),
    ).toBe(ready);
    expect(
      cliSetupForProviderIdentity(ready, "identity:new", "identity:old", "Checking"),
    ).toEqual({
      ...ready,
      phase: "checking",
      message: "Checking",
      refreshing: true,
    });
  });

  it("keeps streaming content versions constant-time around the hot turn", () => {
    const turns = Array.from({ length: 80 }, (_, index) => ({
      id: `turn-${index}`,
      updatedAt: index,
      status: "completed" as const,
      process: [],
      draft: "",
      final: { content: `answer ${index}`, attachments: [], createdAt: index },
    })) as any[];
    const active = {
      ...turns[12],
      status: "running" as const,
      draft: "streaming",
      updatedAt: 100,
      final: null,
    };
    const before = assistantConversationContentVersion(turns, active);
    const after = assistantConversationContentVersion(
      turns,
      { ...active, draft: "streaming more", updatedAt: 101 },
    );

    expect(before).not.toBe(after);
    expect(after).toContain("turn-12:101:running:0:14:0");
    expect(after).toContain("turn-79:79:completed:0:0:9");
  });

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

  beforeEach(async () => {
    vi.stubEnv("VITE_ASSISTANT_LEGACY_RUNTIME", "0");
    vi.clearAllMocks();
    resetAiCliCatalogForTests();
    await resetAssistantAgentRuntimeForTests();
    useAssistantCliSetupStore.getState().reset();
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
    mocks.getTurnRuntimeStatus.mockResolvedValue({ active: false });
    mocks.loadTurnJournal.mockResolvedValue(null);
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
    mocks.beginCliInstallation.mockResolvedValue({
      provider: "codex-cli",
      sessionId: "install-session-1",
      message: "Preparing Codex CLI installation",
    });
    mocks.getCliInstallationStatus.mockResolvedValue({
      provider: "codex-cli",
      sessionId: "install-session-1",
      phase: "succeeded",
      message: "Codex CLI installed",
      result: {
        provider: "codex-cli",
        executablePath: "C:/managed/codex.cmd",
        message: "Codex CLI installed",
      },
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
    mocks.listCliEfforts.mockResolvedValue(["low", "medium", "high"]);
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
    expect(container.textContent).toContain(
      "The users table has five columns.",
    );
    expect(
      container.querySelector<HTMLElement>('[aria-label="Assistant process"]'),
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
      activityDisclosure
        ?.querySelector("button")
        ?.getAttribute("aria-expanded"),
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
    expect(container.querySelectorAll("[data-assistant-turn-id]")).toHaveLength(
      2,
    );
  });

  it("replays buffered activity after the Assistant panel is hidden and reopened without starting another turn", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Inspect users", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await act(async () => {
      root?.unmount();
      root = null;
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
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain(
      "Buffered while the shared panel was closed.",
    );
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Resume",
      ),
    ).toBeUndefined();
  });

  it("persists a restart checkpoint before handing a turn to Agent Host", async () => {
    const order: string[] = [];
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
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

    await submitPrompt(container, "Persist this before starting", "Run agent");

    expect(order).toEqual(["snapshot", "start"]);
  });

  it("does not start an uncheckpointed turn when encrypted persistence fails", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    vi.clearAllMocks();
    mocks.saveConversationSnapshot.mockRejectedValue(
      new Error("encrypted snapshot unavailable"),
    );

    await submitPrompt(container, "Do not launch without recovery", "Run agent");

    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(container.textContent).toContain("encrypted snapshot unavailable");
  });

  it("persists an empty checkpoint when starting a new chat", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Finish this first", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];
    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "turn.status",
      status: "completed",
    });
    vi.clearAllMocks();

    await clickButtonByAria(container, "Start a new assistant chat");

    expect(mocks.saveConversationSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        turns: [],
        resumeRequests: [],
      }),
    );
    expect(container.querySelectorAll("[data-assistant-turn-id]")).toHaveLength(
      0,
    );
  });

  it("replays background turn events after the shared Assistant panel remounts", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Inspect while hidden", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await act(async () => root?.unmount());
    root = null;
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
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Recovered background answer");
    const process = container.querySelector<HTMLElement>(
      `[data-assistant-process-disclosure="${request.turnId}"]`,
    );
    expect(process?.dataset.processRunning).toBe("false");
    await act(async () => process?.querySelector("button")?.click());
    expect(process?.textContent).toContain("Read hidden schema metadata");
    expect(container.textContent).not.toContain("Resume");
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);
  });

  it("cancels an active turn and isolates late events when the provider destination changes", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Inspect the original endpoint", "Run agent");
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
    expect(container.textContent).not.toContain("Inspect the original endpoint");

    await emit({
      ...baseEvent(originalRequest.threadId, originalRequest.turnId, 1),
      type: "final.answer",
      content: "This late response must not cross the endpoint boundary",
      artifacts: [],
    });

    expect(container.textContent).not.toContain(
      "This late response must not cross the endpoint boundary",
    );
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("cancels an active turn and isolates late events when the project changes", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(container, "Inspect the original project", "Run agent");
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
    expect(container.textContent).not.toContain("Inspect the original project");

    await emit({
      ...baseEvent(originalRequest.threadId, originalRequest.turnId, 1),
      type: "final.answer",
      content: "This late response must not cross the project boundary",
      artifacts: [],
    });

    expect(container.textContent).not.toContain(
      "This late response must not cross the project boundary",
    );
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
      textarea.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
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
    expect(mocks.startTurn.mock.calls[0]?.[0].prompt).toBe(
      "查询userProfile数据",
    );
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

  it("shows a stable restoring surface instead of the empty Assistant state while a snapshot is pending", async () => {
    let resolveSnapshot: ((value: null) => void) | undefined;
    mocks.loadConversationSnapshot.mockImplementationOnce(
      () => new Promise<null>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
    });

    expect(container.querySelector("[data-assistant-hydrating]")?.textContent)
      .toContain("Restoring Assistant conversation");
    expect(container.textContent).not.toContain("Choose how Assistant runs");

    await act(async () => {
      resolveSnapshot?.(null);
      await flushAsyncWork();
    });

    expect(container.querySelector("[data-assistant-hydrating]")).toBeNull();
  });

  it("applies a persisted Host journal after an interrupted snapshot", async () => {
    mocks.loadConversationSnapshot.mockResolvedValueOnce({
      projectId: "project-1",
      threadId: "thread:journal",
      turns: [
        {
          id: "turn:journal",
          requestId: "request:journal",
          threadId: "thread:journal",
          projectId: "project-1",
          requestedMode: "agent",
          mode: "agent",
          userMessage: "Was the task completed?",
          status: "running",
          process: [],
          clarifications: [],
          approvals: [],
          draft: "",
          final: null,
          error: null,
          errorDetail: null,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      resumeRequests: [
        {
          requestId: "request:journal",
          turnId: "turn:journal",
          threadId: "thread:journal",
          projectId: "project-1",
          profile: "agent",
          prompt: "Was the task completed?",
          provider: { kind: "openai-compatible", model: "agent-model" },
          workspace: { projectId: "project-1" },
          contextVersion: "ctx-journal",
        },
      ],
      updatedAt: 2,
    });
    mocks.loadTurnJournal.mockResolvedValueOnce({
      projectId: "project-1",
      threadId: "thread:journal",
      turnId: "turn:journal",
      events: [
        {
          type: "final.answer",
          threadId: "thread:journal",
          turnId: "turn:journal",
          sequence: 8,
          occurredAt: 8,
          content: "The persisted journal confirms completion.",
          artifacts: [],
          citations: [],
        },
      ],
      truncated: false,
      updatedAt: 8,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.loadTurnJournal).toHaveBeenCalledWith(
      "project-1",
      "thread:journal",
      "turn:journal",
    );
    expect(container.textContent).toContain(
      "The persisted journal confirms completion.",
    );
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Resume",
      ),
    ).toBeUndefined();
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

  it("does not advertise Resume for an interrupted CLI turn", async () => {
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.loadConversationSnapshot.mockResolvedValueOnce({
      projectId: "project-1",
      conversationId: "provider:codex-cli",
      threadId: "thread:cli-interrupted",
      turns: [
        {
          id: "turn:cli-interrupted",
          requestId: "request:cli-interrupted",
          threadId: "thread:cli-interrupted",
          projectId: "project-1",
          requestedMode: "agent",
          mode: "agent",
          userMessage: "Inspect the schema",
          status: "running",
          process: [],
          clarifications: [],
          approvals: [],
          draft: "",
          error: null,
          errorDetail: null,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      resumeRequests: [
        {
          requestId: "request:cli-interrupted",
          turnId: "turn:cli-interrupted",
          threadId: "thread:cli-interrupted",
          projectId: "project-1",
          profile: "agent",
          prompt: "Inspect the schema",
          provider: {
            kind: "codex-cli",
            profileId: "codex-cli:default",
            model: "default",
          },
          workspace: { projectId: "project-1" },
          contextVersion: "ctx-1",
        },
      ],
      updatedAt: 2,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("fresh CLI turn");
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Resume",
      ),
    ).toBeUndefined();
    expect(mocks.startTurn).not.toHaveBeenCalled();
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
            content:
              "Use the corrected statement:\n```sql\nSELECT id FROM users;\n```",
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
    expect(container.textContent).toContain(
      "database workspace remains fully usable",
    );
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("lets the model ask grouped clarification questions before resuming", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(
      container,
      "Compare the selected databases",
      "Run agent",
    );
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
    expect(dock?.textContent).not.toContain(
      "Which source should be on the left?",
    );
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
      expect.stringMatching(/^provider:cli:[0-9a-f]{32}$/u),
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

  it("opens slash commands above the composer and keeps keyboard focus in the prompt", async () => {
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

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await setTextareaValue(textarea, "/");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(textarea.getAttribute("aria-controls")).toBe(
      "assistant-provider-commands",
    );
    expect(
      container
        .querySelector('[data-assistant-composer="true"]')
        ?.querySelector('[role="listbox"]'),
    ).toBeNull();
    expect(
      document.body.querySelector(
        '#assistant-provider-commands[role="listbox"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await flushAsyncWork();
    });
    expect(textarea.getAttribute("aria-activedescendant")).toBe(
      "assistant-provider-command-1",
    );

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flushAsyncWork();
    });
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.body.querySelector("#assistant-provider-commands"),
    ).toBeNull();

    await setTextareaValue(textarea, "/r");
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await flushAsyncWork();
    });
    expect(textarea.value).toBe("/review ");
    expect(
      document.body.querySelector("#assistant-provider-commands"),
    ).toBeNull();

    await setTextareaValue(textarea, "");
    await setTextareaValue(textarea, "/");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.body.querySelector(
        '#assistant-provider-commands[role="listbox"]',
      ),
    ).not.toBeNull();
  });

  it("filters and replaces only the slash token immediately before the caret", async () => {
    mocks.listCliCommands.mockResolvedValue([
      {
        name: "review",
        description: "Start the provider review workflow",
        argumentHint: "optional review focus",
      },
      { name: "status", description: "Show the active provider status" },
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

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const original = "Compare /rev with the existing /status output";
    const caret = original.indexOf("/rev") + "/rev".length;
    await setTextareaValue(textarea, original, caret);

    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    const options = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '#assistant-provider-commands [role="option"]',
      ),
    );
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("/review");

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await flushAsyncWork();
    });

    expect(textarea.value).toBe(
      "Compare /review  with the existing /status output",
    );
    expect(textarea.selectionStart).toBe("Compare /review ".length);
    expect(textarea.selectionEnd).toBe("Compare /review ".length);
    expect(
      document.body.querySelector("#assistant-provider-commands"),
    ).toBeNull();

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await act(async () => {
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
      await flushAsyncWork();
    });
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps slash suggestions closed throughout IME composition and opens after commit", async () => {
    mocks.listCliCommands.mockResolvedValue([
      { name: "review", description: "Start review" },
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

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      textarea.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      setter?.call(textarea, "/rev");
      textarea.setSelectionRange(4, 4);
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "/rev",
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
      await flushAsyncWork();
    });

    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.body.querySelector("#assistant-provider-commands"),
    ).toBeNull();

    await act(async () => {
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "/rev",
        }),
      );
      await flushAsyncWork();
    });

    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("/review");
  });

  it("opens one Codex-style model popover with quick reasoning and an advanced model view", async () => {
    mocks.listCliModels.mockResolvedValue([
      {
        id: "default",
        label: "Default",
        isDefault: true,
        reasoningEfforts: ["low", "medium", "high", "xhigh"],
      },
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        isDefault: false,
        isProviderDefault: true,
        reasoningEfforts: ["low", "medium", "high", "xhigh"],
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        isDefault: false,
        reasoningEfforts: ["low", "medium", "high"],
      },
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `codex-specialized-${index}`,
        label: `Codex Specialized ${index}`,
        isDefault: false,
        reasoningEfforts: ["low", "medium", "high"],
      })),
    ]);
    mocks.testAiProvider.mockResolvedValue({
      message: "CLI is installed and authenticated",
      model: "gpt-5.6-sol",
      executablePath: "C:/tools/codex.cmd",
      version: "codex 1.0.0",
    });

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

    expect(useAiSettingsStore.getState().codexCliModel).toBe("default");
    const providerTrigger = container.querySelector<HTMLButtonElement>(
      "button[data-assistant-provider]",
    );
    expect(providerTrigger?.textContent).toContain("Codex CLI · Ready");
    expect(providerTrigger?.textContent).not.toContain("Codex CLI · Codex CLI");

    const detectionCalls = mocks.detectCliProvider.mock.calls.length;
    const modelTrigger = findButtonByAria(
      container,
      "Assistant model: Default",
    );
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      modelTrigger.click();
      await flushAsyncWork();
    });

    expect(modelTrigger.getAttribute("aria-expanded")).toBe("true");
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    );
    expect(modelPopover).not.toBeNull();
    expect(
      document.body.querySelectorAll("[data-assistant-model-popover]"),
    ).toHaveLength(1);
    expect(modelTrigger.querySelector(".lucide-zap")).toBeNull();

    const quickView = modelPopover!.querySelector<HTMLElement>(
      '[data-assistant-model-view="quick"]',
    );
    expect(quickView).not.toBeNull();
    expect(quickView?.className).toMatch(/transition|animate/);
    expect(
      quickView?.querySelector("[data-assistant-current-model]")?.textContent,
    ).toContain("GPT-5.6 Sol");
    const reasoningTrack = quickView?.querySelector<HTMLInputElement>(
      'input[type="range"][data-assistant-reasoning-track]',
    );
    expect(reasoningTrack).not.toBeNull();
    expect(reasoningTrack?.min).toBe("0");
    expect(reasoningTrack?.max).toBe("4");
    expect(reasoningTrack?.getAttribute("aria-label")).toBe("Reasoning effort");
    expect(reasoningTrack?.getAttribute("aria-valuetext")).toBe("Default");
    expect(quickView?.textContent).not.toContain("GPT-5.6 Terra");
    expect(quickView?.querySelector(".lucide-zap")).toBeNull();

    await setRangeValue(reasoningTrack!, "3");
    expect(useAiSettingsStore.getState().codexCliReasoningEffort).toBe("high");
    expect(reasoningTrack?.getAttribute("aria-valuetext")).toBe("High");
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.querySelector("[data-assistant-model-popover]")).toBe(
      modelPopover,
    );
    expect(modelPopover!.querySelector(".lucide-zap")).toBeNull();
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(detectionCalls);

    await clickButton(modelPopover!, "Advanced");

    const advancedView = modelPopover!.querySelector<HTMLElement>(
      '[data-assistant-model-view="advanced"]',
    );
    expect(advancedView).not.toBeNull();
    expect(advancedView?.className).toMatch(/transition|animate/);
    expect(
      document.body.querySelectorAll("[data-assistant-model-popover]"),
    ).toHaveLength(1);
    expect(document.body.querySelector("[data-assistant-model-popover]")).toBe(
      modelPopover,
    );
    expect(advancedView?.textContent).not.toContain("GPT-5.6 Terra");

    const modelListToggle = advancedView!.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle model list"]',
    );
    expect(modelListToggle).not.toBeNull();
    expect(modelListToggle?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      modelListToggle!.click();
      await flushAsyncWork();
    });
    expect(modelListToggle?.getAttribute("aria-expanded")).toBe("true");

    const modelSearch = advancedView!.querySelector<HTMLInputElement>(
      'input[placeholder="Search models"]',
    );
    expect(modelSearch).not.toBeNull();
    expect(
      advancedView!.querySelectorAll(
        '[role="radiogroup"][aria-label="Assistant model"] input[type="radio"]',
      ),
    ).toHaveLength(100);
    expect(advancedView!.textContent).toContain("Showing 100 of 123");
    await setInputValue(modelSearch!, "terra");
    expect(
      advancedView!.querySelectorAll(
        '[role="radiogroup"][aria-label="Assistant model"] input[type="radio"]',
      ),
    ).toHaveLength(1);

    const terraModel = advancedView!.querySelector<HTMLInputElement>(
      'input[type="radio"][aria-label="GPT-5.6 Terra"]',
    );
    expect(terraModel).not.toBeNull();
    await act(async () => {
      terraModel!.click();
      await flushAsyncWork();
    });
    expect(useAiSettingsStore.getState().codexCliModel).toBe("gpt-5.6-terra");
    const terraReasoning = advancedView!.querySelector<HTMLInputElement>(
      'input[type="range"][data-assistant-reasoning-track]',
    );
    expect(terraReasoning).not.toBeNull();
    expect(terraReasoning?.max).toBe("3");
    expect(terraReasoning?.getAttribute("aria-valuetext")).toBe("Default");
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(modelPopover!.querySelector(".lucide-zap")).toBeNull();
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(detectionCalls);

    await act(async () => {
      modelPopover!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flushAsyncWork();
    });
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.body.querySelector("[data-assistant-model-popover]"),
    ).toBeNull();
    expect(document.activeElement).toBe(modelTrigger);

    await act(async () => {
      modelTrigger.click();
      await flushAsyncWork();
    });
    const reopenedPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    );
    expect(reopenedPopover).not.toBeNull();
    expect(
      reopenedPopover
        ?.querySelector('[data-assistant-model-view="quick"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("false");
    expect(
      reopenedPopover
        ?.querySelector('[data-assistant-model-view="advanced"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("deduplicates same-identity CLI catalog loads and does not reload them for model or effort changes", async () => {
    const models = deferred<
      Array<{
        id: string;
        label: string;
        isDefault: boolean;
        reasoningEfforts: string[];
      }>
    >();
    const commands = deferred<Array<{ name: string; description: string }>>();
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.listCliModels.mockReturnValue(models.promise);
    mocks.listCliCommands.mockReturnValue(commands.promise);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <>
          <AssistantSidebar />
          <AssistantSidebar />
        </>,
      );
      await flushAsyncWork();
    });

    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(1);

    await act(async () => {
      models.resolve([
        {
          id: "codex-sol",
          label: "Codex Sol",
          isDefault: false,
          isProviderDefault: true,
          reasoningEfforts: ["low", "high"],
        },
      ]);
      commands.resolve([{ name: "status", description: "Show status" }]);
      await flushAsyncWork();
    });

    const detectionCalls = mocks.detectCliProvider.mock.calls.length;
    await act(async () => {
      root!.render(
        <>
          <AssistantSidebar />
          <AssistantSidebar />
        </>,
      );
      useAiSettingsStore.setState({
        codexCliModel: "codex-sol",
        codexCliReasoningEffort: "high",
      });
      await flushAsyncWork();
    });

    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(1);
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(detectionCalls);
  });

  it("keeps CLI models non-editable while the catalog loads and exposes an actionable error", async () => {
    const models =
      deferred<Array<{ id: string; label: string; isDefault: boolean }>>();
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.listCliModels.mockReturnValue(models.promise);

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(container, "Assistant model: Default");
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    );
    expect(modelPopover).not.toBeNull();
    await clickButton(modelPopover!, "Advanced");

    expect(
      modelPopover!.querySelector(
        '[data-assistant-model-catalog-status="loading"]',
      ),
    ).not.toBeNull();
    expect(
      modelPopover!.querySelector('input[placeholder="Model identifier"]'),
    ).toBeNull();

    await act(async () => {
      models.reject(new Error("catalog offline"));
      await flushAsyncWork();
    });

    const catalogError = modelPopover!.querySelector<HTMLElement>(
      '[data-assistant-model-catalog-status="error"]',
    );
    expect(catalogError).not.toBeNull();
    expect(catalogError?.getAttribute("role")).toBe("alert");
    expect(catalogError?.textContent).toContain(
      "Provider capabilities are unavailable.",
    );
    expect(catalogError?.querySelector("summary")?.textContent).toContain(
      "Technical details",
    );
    expect(catalogError?.querySelector("details")?.open).toBe(false);
    expect(catalogError?.textContent).toContain("Retry");
    expect(
      modelPopover!.querySelector('input[placeholder="Model identifier"]'),
    ).toBeNull();
  });

  it("retains a usable partial catalog with a warning and clears stale models after a failed refresh", async () => {
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.listCliModels
      .mockResolvedValueOnce([
        {
          id: "codex-sol",
          label: "Codex Sol",
          isDefault: false,
          isProviderDefault: true,
          reasoningEfforts: ["low", "high"],
        },
      ])
      .mockRejectedValueOnce(new Error("model refresh failed"));
    mocks.listCliCommands
      .mockRejectedValueOnce(new Error("command catalog failed"))
      .mockResolvedValueOnce([]);

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(container, "Assistant model: Default");
    const detectionCalls = mocks.detectCliProvider.mock.calls.length;
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    )!;
    expect(
      modelPopover.querySelector(
        '[data-assistant-model-catalog-status="ready"]',
      )?.textContent,
    ).toContain("Some provider capabilities could not refresh");
    await clickButton(modelPopover, "Advanced");
    await clickButtonByAria(modelPopover, "Toggle model list");
    expect(
      modelPopover.querySelector('input[aria-label="Codex Sol"]'),
    ).not.toBeNull();

    await clickButton(
      modelPopover.querySelector<HTMLElement>(
        '[data-assistant-model-catalog-status="ready"]',
      )!,
      "Retry",
    );
    await act(async () => {
      await flushAsyncWork();
    });

    expect(mocks.listCliModels).toHaveBeenCalledTimes(2);
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(detectionCalls);
    const refreshError = modelPopover.querySelector<HTMLElement>(
      '[data-assistant-model-catalog-status="error"]',
    );
    expect(refreshError?.textContent).toContain("model refresh failed");
    expect(refreshError?.textContent).toContain("Retry");
    expect(
      modelPopover.querySelector('input[aria-label="Codex Sol"]'),
    ).toBeNull();
    expect(
      modelPopover.querySelector('input[placeholder="Model identifier"]'),
    ).toBeNull();
  });

  it("ignores a late catalog result after the CLI provider identity changes", async () => {
    const lateCodexModels =
      deferred<Array<{ id: string; label: string; isDefault: boolean }>>();
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.detectCliProvider.mockImplementation(async (config) => ({
      provider: config.kind,
      available: true,
      executablePath:
        config.kind === "codex-cli"
          ? "C:/tools/codex.cmd"
          : "C:/tools/codebuddy.cmd",
      version: "1.0.0",
      message: "CLI is available",
    }));
    mocks.testAiProvider.mockImplementation(async (config) => ({
      message: "CLI is installed and authenticated",
      model: "default",
      executablePath: config.executablePath,
      version: "1.0.0",
    }));
    mocks.listCliModels.mockImplementation((config) =>
      config.kind === "codex-cli"
        ? lateCodexModels.promise
        : Promise.resolve([
            {
              id: "buddy-model",
              label: "Buddy Model",
              isDefault: false,
              isProviderDefault: true,
            },
          ]),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);

    await clickButtonByAria(container, "Assistant provider: Codex CLI");
    await clickButtonByAria(document.body, "Use CodeBuddy CLI");
    await act(async () => {
      await flushAsyncWork();
    });
    expect(mocks.listCliModels).toHaveBeenCalledTimes(2);

    await clickButtonByAria(container, "Assistant model: Default");
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    )!;
    await clickButton(modelPopover, "Advanced");
    await clickButtonByAria(modelPopover, "Toggle model list");
    expect(
      modelPopover.querySelector('input[aria-label="Buddy Model"]'),
    ).not.toBeNull();

    await act(async () => {
      lateCodexModels.resolve([
        { id: "late-codex", label: "Late Codex", isDefault: true },
      ]);
      await flushAsyncWork();
    });

    expect(
      modelPopover.querySelector('input[aria-label="Buddy Model"]'),
    ).not.toBeNull();
    expect(modelPopover.textContent).not.toContain("Late Codex");
  });

  it("loads CodeBuddy reasoning capability for the selected model without reloading its model catalog", async () => {
    useAiSettingsStore.setState({ provider: "codebuddy-cli", enabled: true });
    mocks.detectCliProvider.mockImplementation(async (config) => ({
      provider: config.kind,
      available: true,
      executablePath: "C:/tools/codebuddy.cmd",
      version: "1.0.0",
      message: "CodeBuddy CLI is available",
    }));
    mocks.testAiProvider.mockImplementation(async (config) => ({
      message: "CLI is installed and authenticated",
      model: config.model,
      executablePath: config.executablePath,
      version: "1.0.0",
    }));
    mocks.listCliModels.mockResolvedValue([
      { id: "default", label: "Default", isDefault: true },
      { id: "buddy-sol", label: "Buddy Sol", isDefault: false },
      { id: "buddy-terra", label: "Buddy Terra", isDefault: false },
    ]);
    mocks.listCliEfforts.mockImplementation(async (config) =>
      config.model === "buddy-terra" ? ["minimal", "high"] : ["low", "medium"],
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliEfforts).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "codebuddy-cli", model: "default" }),
    );

    await clickButtonByAria(container, "Assistant model: Default");
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    )!;
    await clickButton(modelPopover, "Advanced");
    await clickButtonByAria(modelPopover, "Toggle model list");
    const terra = modelPopover.querySelector<HTMLInputElement>(
      'input[aria-label="Buddy Terra"]',
    );
    expect(terra).not.toBeNull();
    await act(async () => {
      terra!.click();
      await flushAsyncWork();
    });

    expect(useAiSettingsStore.getState().codeBuddyCliModel).toBe("buddy-terra");
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliEfforts).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "codebuddy-cli", model: "buddy-terra" }),
    );
    const reasoningTrack = modelPopover.querySelector<HTMLInputElement>(
      'input[data-assistant-reasoning-track]',
    );
    expect(reasoningTrack?.max).toBe("2");
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

  it("keeps a verified CLI ready when the Assistant panel remounts", async () => {
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(1);
    expect(container.querySelector("textarea")).not.toBeNull();

    await act(async () => root?.unmount());
    root = null;
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(1);
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.textContent).not.toContain("Set up Codex CLI");
  });

  it("revalidates a CLI provider after its probe TTL expires", async () => {
    vi.useFakeTimers();
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(1);

    await act(async () => root?.unmount());
    root = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000 + 1);
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(2);
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
      new ApiError(
        "Provider-specific diagnostic that does not need an English auth regex",
        "AI_CLI_AUTH_REQUIRED",
      ),
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

    expect(mocks.beginCliInstallation).toHaveBeenCalledWith("codex-cli");
    expect(mocks.getCliInstallationStatus).toHaveBeenCalledWith(
      "install-session-1",
    );
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

  it("keeps provider diagnostics behind the localized setup status", async () => {
    mocks.detectCliProvider.mockResolvedValue({
      provider: "codex-cli",
      available: false,
      message: "npm failed to start at C:/Users/example/AppData/Local/nvm/npm",
    });

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

    const status = container.querySelector("[data-assistant-cli-setup='missing'] [role='status']");
    expect(status?.querySelector("p")?.textContent).toBe(
      "CLI installation is required.",
    );
    expect(status?.querySelector("summary")?.textContent).toBe(
      "Technical details",
    );
    expect(status?.querySelector("details")?.open).toBe(false);
  });

  it("returns to account authorization when a completed browser flow still fails the CLI probe", async () => {
    mocks.getCliAuthenticationStatus.mockResolvedValue({
      sessionId: "auth-session-1",
      provider: "codex-cli",
      phase: "succeeded",
      message: "Browser sign-in completed",
      methodId: "browser",
    });
    mocks.testAiProvider
      .mockRejectedValueOnce(
        new ApiError(
          "The provider needs a browser sign-in",
          "AI_CLI_AUTH_REQUIRED",
        ),
      )
      .mockRejectedValueOnce(
        new ApiError(
          "The provider did not grant CLI access yet",
          "AI_CLI_AUTH_REQUIRED",
        ),
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

    await clickButton(container, "ChatGPT / Codex account");
    await act(async () => {
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Set up Codex CLI");
    expect(container.textContent).toContain(
      "Sign-in completed, but the CLI still needs account access",
    );
    expect(container.textContent).toContain("ChatGPT / Codex account");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("reattaches an active managed CLI installation after the Assistant panel remounts", async () => {
    mocks.detectCliProvider.mockResolvedValue({
      provider: "codex-cli",
      available: false,
      message: "Codex CLI is not installed",
    });
    mocks.beginCliInstallation.mockResolvedValue({
      provider: "codex-cli",
      sessionId: "install-session-remount",
      message: "Downloading Codex CLI",
    });
    mocks.getCliInstallationStatus.mockResolvedValue({
      provider: "codex-cli",
      sessionId: "install-session-remount",
      phase: "downloading",
      message: "Downloading Codex CLI",
    });

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

    await clickButton(container, "Install for OxideStudio");
    await act(async () => {
      await flushAsyncWork();
    });
    expect(mocks.beginCliInstallation).toHaveBeenCalledTimes(1);
    expect(mocks.getCliInstallationStatus).toHaveBeenCalledWith(
      "install-session-remount",
    );

    await act(async () => root?.unmount());
    root = null;
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.beginCliInstallation).toHaveBeenCalledTimes(1);
    expect(mocks.getCliInstallationStatus).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Downloading Codex CLI");
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
      const modelPanel = document.body.querySelector<HTMLElement>(
        "[data-assistant-model-popover]",
      );
      expect(modelPanel).not.toBeNull();
      await clickButton(modelPanel!, "Advanced");
      const modelInput = modelPanel!.querySelector<HTMLInputElement>(
        'input[placeholder="Model identifier"]',
      );
      expect(modelInput).not.toBeNull();
      await setInputValue(modelInput!, "agent-model-v2");
      await clickButton(document.body, "Apply");
      expect(useAiSettingsStore.getState().model).toBe("agent-model-v2");
      expect(container.querySelector("header")?.textContent).not.toContain(
        "agent-model-v2",
      );

      expect(
        findButtonByAria(
          container,
          "Assistant model: agent-model-v2",
        ).getAttribute("aria-expanded"),
      ).toBe("true");
      await clickButton(modelPanel!, "Settings");
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
      container.querySelector('button[aria-label*="Starting AI runtime"]'),
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
      container.querySelector('button[aria-label*="Authentication failed"]'),
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
    findButtonByAria(container, labelPrefix).click();
    await flushAsyncWork();
  });
}

function findButtonByAria(container: HTMLElement, labelPrefix: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label^="${labelPrefix}"]`,
  );
  if (!button) {
    throw new Error(
      `Button with aria-label starting with "${labelPrefix}" not found`,
    );
  }
  return button;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: value }),
    );
    await flushAsyncWork();
  });
}

async function setRangeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flushAsyncWork();
  });
}

async function setTextareaValue(
  textarea: HTMLTextAreaElement,
  value: string,
  caret = value.length,
) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(textarea, value);
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: value }),
    );
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
