/**
 * @vitest-environment happy-dom
 */
import { act as reactAct } from "react";
import { createRoot as reactCreateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getContextMetrics: vi.fn(),
  loadConversationSnapshot: vi.fn(),
  listConversationSnapshots: vi.fn(),
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
    listConversationSnapshots: mocks.listConversationSnapshots,
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
  AssistantSidebar as AssistantSidebarComponent,
  assistantConversationBelongsToScope as assistantConversationBelongsToScopeImplementation,
  assistantConversationScopeKey as assistantConversationScopeKeyImplementation,
  createAssistantConversationId as createAssistantConversationIdImplementation,
  assistantConversationId as assistantConversationIdImplementation,
  assistantConversationContentVersion as assistantConversationContentVersionImplementation,
  assistantConversationHistoryVersion as assistantConversationHistoryVersionImplementation,
  assistantTurnMetricsVersion as assistantTurnMetricsVersionImplementation,
  assistantToolManifestForProfile as assistantToolManifestForProfileImplementation,
  cliSetupForProviderIdentity as cliSetupForProviderIdentityImplementation,
} from "@/components/workspace/AssistantSidebar";
import { resetAiCliCatalogForTests } from "@/hooks/useAiCliCatalog";
import { resetAssistantAgentRuntimeForTests } from "@/hooks/useAssistantAgentSession";
import { resetAssistantConversationHistoryForTests } from "@/components/workspace/assistant/AssistantConversationHistory";
import { useAiSettingsStore as aiSettingsStore } from "@/store/useAiSettingsStore";
import { useConnectionStore as connectionStore } from "@/store/useConnectionStore";
import { useProjectStore as projectStore } from "@/store/useProjectStore";
import { useSchemaStore as schemaStore } from "@/store/useSchemaStore";
import { useTabStore as tabStore } from "@/store/useTabStore";
import { useAssistantComposerStore as assistantComposerStore } from "@/store/useAssistantComposerStore";
import { useAssistantCliSetupStore as assistantCliSetupStore } from "@/store/useAssistantCliSetupStore";
import { ApiError as ApiErrorClass } from "@/services/tauri/types";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialAiSettings = aiSettingsStore.getState();
const initialConnectionState = connectionStore.getState();
const initialProjectState = projectStore.getState();
const initialSchemaState = schemaStore.getState();
const initialTabState = tabStore.getState();

let container: HTMLDivElement;
let root: Root | null = null;

export const fixture = {
  get container() {
    return container;
  },
  get root() {
    return root;
  },
  set root(value: Root | null) {
    root = value;
  },
};

beforeEach(async () => {
  vi.stubEnv("VITE_ASSISTANT_LEGACY_RUNTIME", "0");
  vi.clearAllMocks();
  resetAiCliCatalogForTests();
  resetAssistantConversationHistoryForTests();
  window.localStorage.removeItem("oxide-assistant-active-conversations-v1");
  await resetAssistantAgentRuntimeForTests();
  assistantCliSetupStore.getState().reset();
  mocks.listener = null;
  mocks.loadConversationSnapshot.mockResolvedValue(null);
  mocks.listConversationSnapshots.mockResolvedValue([]);
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
  aiSettingsStore.setState(
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
  projectStore.setState({
    ...initialProjectState,
    activeProjectId: "project-1",
    activeProjectName: "Project 1",
  });
  connectionStore.setState({
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
  schemaStore.setState({
    ...initialSchemaState,
    currentSchema: "public",
  });
  tabStore.setState({
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
  assistantComposerStore.setState({ request: null });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await reactAct(async () => root?.unmount());
  root = null;
  container.remove();
  aiSettingsStore.setState(initialAiSettings, true);
  connectionStore.setState(initialConnectionState, true);
  projectStore.setState(initialProjectState, true);
  schemaStore.setState(initialSchemaState, true);
  tabStore.setState(initialTabState, true);
  assistantComposerStore.setState({ request: null });
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

export async function submitPrompt(
  container: HTMLElement,
  prompt: string,
  ariaLabel: string,
) {
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await reactAct(async () => {
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

export async function emit(event: any) {
  await reactAct(async () => {
    mocks.listener?.(event);
    await flushAsyncWork();
  });
}

export async function clickButton(container: HTMLElement, label: string) {
  await reactAct(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === label)
      ?.click();
    await flushAsyncWork();
  });
}

export async function clickButtonByAria(
  container: HTMLElement,
  labelPrefix: string,
) {
  await reactAct(async () => {
    findButtonByAria(container, labelPrefix).click();
    await flushAsyncWork();
  });
}

export function findButtonByAria(container: HTMLElement, labelPrefix: string) {
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

export async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await reactAct(async () => {
    setter?.call(input, value);
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: value }),
    );
    await flushAsyncWork();
  });
}

export async function setRangeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await reactAct(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flushAsyncWork();
  });
}

export async function setTextareaValue(
  textarea: HTMLTextAreaElement,
  value: string,
  caret = value.length,
) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await reactAct(async () => {
    setter?.call(textarea, value);
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: value }),
    );
    await flushAsyncWork();
  });
}

export function baseEvent(threadId: string, turnId: string, sequence: number) {
  return {
    threadId,
    turnId,
    sequence,
    occurredAt: 1_000 + sequence,
  };
}

export async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

export const mocksForTests = mocks;
export const act = reactAct;
export const createRoot = reactCreateRoot;
export const AssistantSidebar = AssistantSidebarComponent;
export const ApiError = ApiErrorClass;
export const useAiSettingsStore = aiSettingsStore;
export const useConnectionStore = connectionStore;
export const useProjectStore = projectStore;
export const useSchemaStore = schemaStore;
export const useTabStore = tabStore;
export const useAssistantComposerStore = assistantComposerStore;
export const useAssistantCliSetupStore = assistantCliSetupStore;
export const assistantConversationBelongsToScope =
  assistantConversationBelongsToScopeImplementation;
export const assistantConversationScopeKey =
  assistantConversationScopeKeyImplementation;
export const createAssistantConversationId =
  createAssistantConversationIdImplementation;
export const assistantConversationId = assistantConversationIdImplementation;
export const assistantConversationContentVersion =
  assistantConversationContentVersionImplementation;
export const assistantConversationHistoryVersion =
  assistantConversationHistoryVersionImplementation;
export const assistantTurnMetricsVersion =
  assistantTurnMetricsVersionImplementation;
export const assistantToolManifestForProfile =
  assistantToolManifestForProfileImplementation;
export const cliSetupForProviderIdentity =
  cliSetupForProviderIdentityImplementation;
