import {
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools/defaultRegistry";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { resolveAssistantMode } from "@/ai/assistant/modes";
import { boundedConversationHistory } from "@/ai/assistant/chatContext";
import {
  applyAssistantContextSettings,
  createAssistantContextPreview,
  createAssistantTurnInput,
  DEFAULT_ASSISTANT_CONTEXT_SETTINGS,
  type AssistantContextSettings,
} from "@/ai/assistant/contextPreview";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantHeader } from "./assistant/AssistantHeader";
import { AssistantConversation } from "./assistant/AssistantConversation";
import { AssistantPromptBox } from "./assistant/AssistantPromptBox";
import type { AssistantModelStatus } from "./assistant/AssistantModelControl";
import { AssistantConversationMinimap } from "./assistant/AssistantConversationMinimap";
import { AssistantClarificationDock } from "./assistant/AssistantClarificationDock";
import { createWorkspaceUiActionRegistry } from "@/ai/ui-actions";
import type { UiActionRequest } from "@/ai/ui-actions/types";
import { useProjectStore } from "@/store/useProjectStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { cn } from "@/lib/utils";
import { useAssistantAgentSession } from "@/hooks/useAssistantAgentSession";
import { assistantConversationHistoryFromTurns } from "@/ai/assistant/turns";
import { APP_EVENT_OPEN_SETTINGS } from "@/lib/actionEvents";

export function AssistantSidebar() {
  return <AgentHostAssistantSidebar />;
}

function AgentHostAssistantSidebar() {
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);
  const aiModel = useAiSettingsStore((state) => state.model);
  const aiApiKey = useAiSettingsStore((state) => state.apiKey);
  const aiTimeoutMs = useAiSettingsStore((state) => state.timeoutMs);
  const aiStreaming = useAiSettingsStore((state) => state.streaming);
  const aiToolCalling = useAiSettingsStore((state) => state.toolCalling);
  const aiStructuredOutput = useAiSettingsStore(
    (state) => state.structuredOutput,
  );
  const aiMaxInputTokens = useAiSettingsStore((state) => state.maxInputTokens);
  const aiMaxOutputTokens = useAiSettingsStore(
    (state) => state.maxOutputTokens,
  );
  const assistantMode = useAiSettingsStore((state) => state.assistantMode);
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const activeDriver = useConnectionStore(
    (state) =>
      state.connections.find(
        (connection) => connection.id === state.activeConnectionId,
      )?.driver ?? null,
  );
  const activeConnectionDatabase = useConnectionStore(
    (state) =>
      state.connections.find(
        (connection) => connection.id === state.activeConnectionId,
      )?.database ?? null,
  );
  const activeNamespace = useSchemaStore((state) => state.currentSchema);
  const { tabs, activeTabId } = useTabStore();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const selectedText = activeTab?.editorSelection?.text || null;
  const providerConfigured = Boolean(
    aiEnabled && aiBaseUrl.trim() && aiModel.trim(),
  );
  const session = useAssistantAgentSession(activeProjectId, providerConfigured);
  const [message, setMessage] = useState("");
  const [contextSettings, setContextSettings] =
    useState<AssistantContextSettings>(DEFAULT_ASSISTANT_CONTEXT_SETTINGS);
  const [dismissedAuthIssueId, setDismissedAuthIssueId] = useState<
    string | null
  >(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const autoFollowConversationRef = useRef(true);
  const providerFingerprintRef = useRef(
    `${aiEnabled}:${aiBaseUrl}:${aiModel}:${aiApiKey}`,
  );
  const uiActionRegistry = useMemo(() => createWorkspaceUiActionRegistry(), []);
  const agentToolManifest = useMemo(
    () =>
      createWorkspaceAiToolRegistry()
        .list()
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          permissions: tool.permissions,
          timeoutMs: tool.timeoutMs,
          resultLimit: tool.resultLimit,
        })),
    [],
  );
  const modelConfig = useMemo(() => {
    const baseUrl = aiBaseUrl.trim();
    const model = aiModel.trim();
    if (!aiEnabled || !baseUrl || !model) return null;
    return {
      baseUrl,
      model,
      timeoutMs: aiTimeoutMs,
    };
  }, [aiBaseUrl, aiEnabled, aiModel, aiTimeoutMs]);
  const conversationHistory = useMemo(
    () => assistantConversationHistoryFromTurns(session.turns),
    [session.turns],
  );
  const previewContext = useMemo(
    () => createWorkspaceAiToolContext("assistant-agent-context-preview"),
    [
      activeConnectionId,
      activeConnectionDatabase,
      activeDriver,
      activeNamespace,
      activeProjectId,
      activeTab,
    ],
  );
  const contextProviderLabel = modelConfig
    ? providerDestinationLabel(modelConfig.model, modelConfig.baseUrl)
    : null;
  const contextPreview = useMemo(
    () =>
      createAssistantContextPreview({
        message,
        mode: assistantMode,
        providerLabel: contextProviderLabel,
        context: previewContext,
        selectedText,
        history: conversationHistory,
        settings: contextSettings,
      }),
    [
      assistantMode,
      contextProviderLabel,
      contextSettings,
      conversationHistory,
      message,
      previewContext,
      selectedText,
    ],
  );
  const contextFingerprint = previewContext.workspaceContext?.fingerprint || "";
  const turnsContentVersion = session.turns
    .map(
      (turn) =>
        `${turn.id}:${turn.updatedAt}:${turn.status}:${turn.process.length}:${turn.final?.content.length || 0}`,
    )
    .join("|");
  const latestTurnWithError = [...session.turns]
    .reverse()
    .find((turn) => Boolean(turn.error?.trim()));
  const providerError = latestTurnWithError?.error || session.hostError;
  const providerErrorSignal = [
    latestTurnWithError?.error,
    latestTurnWithError?.errorDetail,
    session.hostError,
  ]
    .filter(Boolean)
    .join(" ");
  const authIssueId =
    providerError && isAuthenticationError(providerErrorSignal)
      ? `${latestTurnWithError?.id || "host"}:${latestTurnWithError?.updatedAt || providerError}`
      : null;
  const activeAuthIssueId =
    authIssueId && authIssueId !== dismissedAuthIssueId ? authIssueId : null;
  const resolvedMode = resolveAssistantMode(assistantMode, message);
  const { modelStatus, submissionBlockReason } = resolveModelUiState({
    enabled: aiEnabled,
    baseUrl: aiBaseUrl,
    model: aiModel,
    resolvedMode,
    toolCalling: aiToolCalling,
    availability: session.availability,
    hostCapabilities: session.hostStatus?.capabilities ?? null,
    authenticationError: activeAuthIssueId ? providerError : null,
  });

  useEffect(() => {
    const fingerprint = `${aiEnabled}:${aiBaseUrl}:${aiModel}:${aiApiKey}`;
    if (providerFingerprintRef.current === fingerprint) return;
    providerFingerprintRef.current = fingerprint;
    if (authIssueId) setDismissedAuthIssueId(authIssueId);
  }, [aiApiKey, aiBaseUrl, aiEnabled, aiModel, authIssueId]);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element || !autoFollowConversationRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [turnsContentVersion]);

  const handleSubmit = async () => {
    const prompt = message.trim();
    if (!prompt || session.isBusy || submissionBlockReason) return;
    const mode = resolveAssistantMode(assistantMode, prompt);
    const contextSettingsSnapshot = { ...contextSettings };
    const scopedContext = applyAssistantContextSettings(
      createWorkspaceAiToolContext(),
      contextSettingsSnapshot,
    );
    const turnInput = createAssistantTurnInput(
      prompt,
      assistantMode,
      selectedText,
      conversationHistory,
      contextSettingsSnapshot,
    );
    const turnId = createAgentTurnId();
    const binding = scopedContext.workspaceContext!;
    setMessage("");
    autoFollowConversationRef.current = true;
    await session.startTurn({
      requestId: `request:${turnId}`,
      turnId,
      projectId: activeProjectId,
      requestedMode: assistantMode,
      profile: mode,
      messages: boundedConversationHistory(turnInput.history),
      prompt,
      provider: modelConfig
        ? {
            ...modelConfig,
            capabilities: {
              streaming: aiStreaming,
              toolCalling: aiToolCalling,
              structuredOutput: aiStructuredOutput,
              maxInputTokens: aiMaxInputTokens,
              maxOutputTokens: aiMaxOutputTokens,
            },
          }
        : null,
      workspace: {
        projectId: activeProjectId,
        connectionId: scopedContext.activeConnectionId ?? null,
        database:
          scopedContext.activeTab?.databaseName ??
          binding.activeDatabaseName ??
          activeConnectionDatabase,
        namespace: scopedContext.activeNamespace ?? null,
        activeTabId: binding.activeTabId,
        configRevision: binding.documentRevision,
        fingerprint: binding.fingerprint,
        summary: {
          driver: scopedContext.activeDriver ?? null,
          activeTab: scopedContext.activeTab ?? null,
          selectedText: turnInput.selectedText ?? null,
          contextPolicy: contextSettingsSnapshot,
        },
      },
      tools: agentToolManifest,
      contextVersion: binding.fingerprint,
    });
  };

  const handleExecuteAttachment = async (request: UiActionRequest) => {
    return await uiActionRegistry.execute(request);
  };
  const activeContextLabel = activeTab?.title || "No active editor";
  const pendingLabel = session.activeTurn
    ? agentTurnPendingLabel(session.activeTurn.status)
    : "Thinking...";

  return (
    <div className="wb-assistant-shell flex h-full flex-col wb-panel">
      <AssistantHeader
        isRunning={session.isBusy}
        onNewChat={() => {
          autoFollowConversationRef.current = true;
          setMessage("");
          session.clear();
        }}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[hsl(var(--wb-editor))]">
        <div
          ref={scrollContainerRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            autoFollowConversationRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              72;
          }}
          className={cn(
            "custom-scrollbar h-full overflow-auto",
            session.turns.length >= 4 && "wb-assistant-scroll-with-minimap",
          )}
        >
          {session.hostError && session.turns.length === 0 && (
            <div className="mx-3 mt-3 border-y border-amber-500/25 bg-amber-500/5 px-2 py-2 text-[10px] leading-4 text-amber-300">
              {session.hostError}
              <button
                type="button"
                className="ml-2 underline underline-offset-2 hover:text-[hsl(var(--wb-text))]"
                onClick={() => void session.refreshStatus()}
              >
                Retry
              </button>
            </div>
          )}

          <AssistantConversation
            turns={session.turns}
            isResponding={false}
            pendingLabel={pendingLabel}
            onUsePrompt={setMessage}
            onExecuteAttachment={handleExecuteAttachment}
            contextFingerprint={contextFingerprint}
            onDecideApproval={session.decideApproval}
            onCancelTurn={session.cancelTurn}
            onResumeTurn={session.resumeTurn}
          />
        </div>

        <AssistantConversationMinimap
          turns={session.turns}
          scrollContainerRef={scrollContainerRef}
          contentVersion={turnsContentVersion}
        />
      </div>

      <AssistantClarificationDock
        turn={
          session.activeTurn?.status === "awaiting_input"
            ? session.activeTurn
            : null
        }
        contextFingerprint={contextFingerprint}
        onAnswer={session.answerClarification}
      />

      <AssistantPromptBox
        message={message}
        onMessageChange={setMessage}
        onSubmit={handleSubmit}
        onStop={() => {
          if (session.activeTurn)
            void session.cancelTurn(session.activeTurn.id);
        }}
        mode={assistantMode}
        onModeChange={(mode) => {
          if (!session.isBusy) updateAiSettings({ assistantMode: mode });
        }}
        activeContextLabel={activeContextLabel}
        contextPreview={contextPreview}
        contextSettings={contextSettings}
        onContextSettingChange={(key, checked) =>
          setContextSettings((current) => ({ ...current, [key]: checked }))
        }
        isSubmitting={session.activeTurn?.status === "planning"}
        isToolRunning={
          session.isBusy && session.activeTurn?.status !== "planning"
        }
        isCancelling={session.activeTurn?.status === "cancelling"}
        model={aiModel}
        modelEndpoint={aiBaseUrl}
        modelStatus={modelStatus}
        onModelChange={(model) => updateAiSettings({ model })}
        onOpenAiSettings={() => {
          window.dispatchEvent(
            new CustomEvent(APP_EVENT_OPEN_SETTINGS, {
              detail: { section: "ai" },
            }),
          );
        }}
        onRetryModel={() => {
          if (authIssueId) setDismissedAuthIssueId(authIssueId);
          void session.refreshStatus();
        }}
        submissionBlockReason={submissionBlockReason}
      />
    </div>
  );
}

function resolveModelUiState({
  enabled,
  baseUrl,
  model,
  resolvedMode,
  toolCalling,
  availability,
  hostCapabilities,
  authenticationError,
}: {
  enabled: boolean;
  baseUrl: string;
  model: string;
  resolvedMode: "chat" | "plan" | "agent";
  toolCalling: boolean;
  availability: "checking" | "available" | "unavailable";
  hostCapabilities: string[] | null;
  authenticationError: string | null;
}): {
  modelStatus: AssistantModelStatus;
  submissionBlockReason: string | null;
} {
  const endpoint = endpointLabel(baseUrl);
  if (!enabled || !baseUrl.trim() || !model.trim()) {
    const detail = !enabled
      ? "Configure an AI provider and enable it before sending a request."
      : !baseUrl.trim()
        ? "Add an OpenAI-compatible endpoint before sending a request."
        : "Choose a model identifier before sending a request.";
    return {
      modelStatus: { kind: "missing", label: "AI setup required", detail },
      submissionBlockReason: detail,
    };
  }

  if (authenticationError) {
    const detail =
      "The provider rejected the credential. Update the API key in AI settings, then retry.";
    return {
      modelStatus: {
        kind: "authentication-error",
        label: "Authentication failed",
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (resolvedMode !== "chat" && !toolCalling) {
    const detail = `${resolvedMode === "plan" ? "Plan" : "Agent"} mode requires a model with tool calling. Switch to Chat or enable tool calling in AI settings.`;
    return {
      modelStatus: {
        kind: "incompatible",
        label: "Model capability required",
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (
    availability === "available" &&
    hostCapabilities &&
    hostCapabilities.length > 0 &&
    !hostCapabilities.includes(resolvedMode)
  ) {
    const detail = `The AI runtime does not support ${resolvedMode === "chat" ? "Chat" : resolvedMode === "plan" ? "Plan" : "Agent"} mode.`;
    return {
      modelStatus: {
        kind: "incompatible",
        label: "Mode unavailable",
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (availability === "checking") {
    const detail = "Starting the AI runtime. You can keep typing while it starts.";
    return {
      modelStatus: { kind: "checking", label: "Starting AI runtime", detail },
      submissionBlockReason: detail,
    };
  }

  if (
    availability === "available" &&
    (!hostCapabilities || hostCapabilities.length === 0)
  ) {
    const detail = "Checking the AI runtime capabilities. You can keep typing.";
    return {
      modelStatus: { kind: "checking", label: "Checking AI runtime", detail },
      submissionBlockReason: detail,
    };
  }

  if (availability === "unavailable") {
    const detail =
      "The AI runtime is unavailable. The database workspace remains usable.";
    return {
      modelStatus: { kind: "unavailable", label: "AI unavailable", detail },
      submissionBlockReason: `${detail} Retry the runtime or open AI settings.`,
    };
  }

  return {
    modelStatus: {
      kind: "configured",
      label: "Model configured",
      detail: `Requests use ${endpoint}. Credentials are verified when a request is sent.`,
    },
    submissionBlockReason: null,
  };
}

function isAuthenticationError(message: string) {
  return /\b401\b|unauthori[sz]ed|authentication\s+failed|incorrect\s+(?:api[- ]?)?key|invalid\s+(?:api[- ]?)?key/iu.test(
    message,
  );
}

function endpointLabel(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname || "the configured endpoint";
  } catch {
    return "the configured endpoint";
  }
}

function createAgentTurnId() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `assistant-turn:${suffix}`;
}

function agentTurnPendingLabel(status: string) {
  if (status === "planning") return "Planning...";
  if (status === "awaiting_input") return "Waiting for your answer";
  if (status === "awaiting_approval") return "Waiting for approval";
  if (status === "cancelling") return "Stopping...";
  return "Working...";
}

function providerDestinationLabel(model: string, baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname ? `${model} · ${hostname}` : `${model} · custom endpoint`;
  } catch {
    return `${model} · custom endpoint`;
  }
}
