import {
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools/defaultRegistry";
import { AGENT_HOST_ONLY_TOOLS } from "@/ai/tools/agentHostTools";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useShallow } from "zustand/react/shallow";
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
import {
  AssistantProviderControl,
  AssistantProviderWelcome,
} from "./assistant/AssistantProviderControl";
import {
  AssistantProviderSetup,
  type AssistantCliSetupState,
} from "./assistant/AssistantProviderSetup";
import { assistantProviderDefinition } from "@/ai/assistant/providerDefinitions";
import { createWorkspaceUiActionRegistry } from "@/ai/ui-actions";
import type { UiActionRequest } from "@/ai/ui-actions/types";
import { useProjectStore } from "@/store/useProjectStore";
import {
  isManagedConnection,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { cn } from "@/lib/utils";
import { useAssistantAgentSession } from "@/hooks/useAssistantAgentSession";
import {
  useAiCliCatalog,
  useCliEnvironmentRevision,
} from "@/hooks/useAiCliCatalog";
import { assistantConversationHistoryFromTurns } from "@/ai/assistant/turns";
import { APP_EVENT_OPEN_SETTINGS } from "@/lib/actionEvents";
import { createAssistantSqlPatchPreview } from "@/lib/assistantSqlPatch";
import {
  openProjectFileInEditor,
  openProjectFileProposalInEditor,
} from "@/lib/projectFileOpen";
import { useAssistantComposerStore } from "@/store/useAssistantComposerStore";
import { useAssistantChangeStore } from "@/store/useAssistantChangeStore";
import { useAssistantCliSetupStore } from "@/store/useAssistantCliSetupStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { useI18n } from "@/i18n";
import {
  agentHostService,
  type AgentProfile,
  type AgentTextAttachment,
  type AgentToolManifestEntry,
} from "@/services/tauri/agent-host.service";
import {
  aiService,
  type AiCliProviderConfig,
  type AiProviderConfig,
  type AiProviderKind,
} from "@/services/tauri/ai.service";
import { ApiError } from "@/services/tauri/types";
import { ArrowDown, Sparkles, X } from "lucide-react";
import {
  AssistantPendingChangesPanel,
  pendingAssistantFileProposals,
  type PendingAssistantFileProposal,
} from "./assistant/AssistantPendingChangesPanel";
import {
  APP_EVENT_AGENT_FILE_REVIEW,
  type AgentFileReviewDecisionDetail,
} from "@/lib/agentFileReview";

const CLI_PROBE_TTL_MS = 5 * 60 * 1_000;

type PendingTextAttachment = AgentTextAttachment & { id: string };

export function assistantToolManifestForProfile(
  profile: AgentProfile,
  tools: readonly AgentToolManifestEntry[],
) {
  if (profile === "chat") {
    return tools.filter((tool) => tool.name === "workspace.getActiveTab");
  }
  if (profile === "plan") {
    return tools.filter(
      (tool) =>
        tool.name !== "project.writeFile" &&
        tool.permissions.every((permission) => permission === "read"),
    );
  }
  return [...tools];
}

export function AssistantSidebar() {
  return <AgentHostAssistantSidebar />;
}

function AgentHostAssistantSidebar() {
  const { t } = useI18n();
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (state) => state.setToolWindowVisible,
  );
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiProvider = useAiSettingsStore((state) => state.provider);
  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);
  const aiModel = useAiSettingsStore((state) => state.model);
  const aiApiKey = useAiSettingsStore((state) => state.apiKey);
  const codexCliPath = useAiSettingsStore((state) => state.codexCliPath);
  const codexCliModel = useAiSettingsStore((state) => state.codexCliModel);
  const codexCliReasoningEffort = useAiSettingsStore(
    (state) => state.codexCliReasoningEffort,
  );
  const codexCliReasoningEffortByModel = useAiSettingsStore(
    (state) => state.codexCliReasoningEffortByModel,
  );
  const codeBuddyCliPath = useAiSettingsStore(
    (state) => state.codeBuddyCliPath,
  );
  const codeBuddyCliModel = useAiSettingsStore(
    (state) => state.codeBuddyCliModel,
  );
  const codeBuddyCliReasoningEffort = useAiSettingsStore(
    (state) => state.codeBuddyCliReasoningEffort,
  );
  const codeBuddyCliReasoningEffortByModel = useAiSettingsStore(
    (state) => state.codeBuddyCliReasoningEffortByModel,
  );
  const codexCliEnvironmentKeys = useAiSettingsStore(
    (state) => state.codexCliEnvironmentKeys,
  );
  const codeBuddyCliEnvironmentKeys = useAiSettingsStore(
    (state) => state.codeBuddyCliEnvironmentKeys,
  );
  const assistantProviderConfig = useAiSettingsStore(
    (state) => state.assistantProviderConfig,
  );
  const aiStreaming = useAiSettingsStore((state) => state.streaming);
  const aiToolCalling = useAiSettingsStore((state) => state.toolCalling);
  const aiStructuredOutput = useAiSettingsStore(
    (state) => state.structuredOutput,
  );
  const aiMaxInputTokens = useAiSettingsStore((state) => state.maxInputTokens);
  const aiMaxOutputTokens = useAiSettingsStore(
    (state) => state.maxOutputTokens,
  );
  const oxideAssistantMode = useAiSettingsStore((state) => state.assistantMode);
  const codexAssistantMode = useAiSettingsStore(
    (state) => state.codexCliAssistantMode,
  );
  const codeBuddyAssistantMode = useAiSettingsStore(
    (state) => state.codeBuddyCliAssistantMode,
  );
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setProjectTurns = useAssistantChangeStore(
    (state) => state.setProjectTurns,
  );
  const activeProjectRoot = useProjectStore(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.root_path ?? null,
  );
  const activeConnectionId = useConnectionStore((state) => {
    const connection = state.connections.find(
      (candidate) => candidate.id === state.activeConnectionId,
    );
    return connection && !isManagedConnection(connection)
      ? connection.id
      : null;
  });
  const activeDriver = useConnectionStore((state) =>
    (() => {
      const connection = state.connections.find(
        (connection) => connection.id === state.activeConnectionId,
      );
      return connection && !isManagedConnection(connection)
        ? connection.driver
        : null;
    })(),
  );
  const activeConnectionDatabase = useConnectionStore((state) =>
    (() => {
      const connection = state.connections.find(
        (connection) => connection.id === state.activeConnectionId,
      );
      return connection && !isManagedConnection(connection)
        ? (connection.database ?? null)
        : null;
    })(),
  );
  const activeNamespace = useSchemaStore((state) => state.currentSchema);
  const activeTab = useTabStore(
    useShallow((state) => {
      const tab = state.tabs.find(
        (candidate) => candidate.id === state.activeTabId,
      );
      return tab
        ? {
            title: tab.title,
            databaseName: tab.databaseName,
            editorSelection: tab.editorSelection,
          }
        : null;
    }),
  );
  const composeRequest = useAssistantComposerStore((state) => state.request);
  const consumeComposeRequest = useAssistantComposerStore(
    (state) => state.consumeRequest,
  );
  const selectedText = activeTab?.editorSelection?.text || null;
  const modelConfig = assistantProviderConfig();
  const assistantMode =
    aiProvider === "codex-cli"
      ? codexAssistantMode
      : aiProvider === "codebuddy-cli"
        ? codeBuddyAssistantMode
        : oxideAssistantMode;
  const providerConfigured = Boolean(modelConfig);
  const conversationId = assistantConversationId(modelConfig);
  const session = useAssistantAgentSession(
    activeProjectId,
    providerConfigured,
    modelConfig?.kind,
    conversationId,
  );
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingTextAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isAddingAttachment, setIsAddingAttachment] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [contextSettings, setContextSettings] =
    useState<AssistantContextSettings>(DEFAULT_ASSISTANT_CONTEXT_SETTINGS);
  const [dismissedAuthIssueId, setDismissedAuthIssueId] = useState<
    string | null
  >(null);
  const cliSetupByProvider = useAssistantCliSetupStore(
    (state) => state.setupByProvider,
  );
  const cliDetectionRevisionByProvider = useAssistantCliSetupStore(
    (state) => state.detectionRevisionByProvider,
  );
  const cliProbeIdentityByProvider = useAssistantCliSetupStore(
    (state) => state.probeIdentityByProvider,
  );
  const updateCliSetup = useAssistantCliSetupStore(
    (state) => state.updateSetup,
  );
  const requestCliDetection = useAssistantCliSetupStore(
    (state) => state.requestDetection,
  );
  const completeCliProbe = useAssistantCliSetupStore(
    (state) => state.completeProbe,
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const autoFollowConversationRef = useRef(true);
  const providerFingerprintRef = useRef(JSON.stringify(modelConfig));
  const uiActionRegistry = useMemo(() => createWorkspaceUiActionRegistry(), []);
  const workspaceToolManifest = useMemo(
    () => [
      ...createWorkspaceAiToolRegistry()
        .list()
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          permissions: tool.permissions,
          timeoutMs: tool.timeoutMs,
          resultLimit: tool.resultLimit,
        })),
      ...AGENT_HOST_ONLY_TOOLS,
    ],
    [],
  );
  const agentToolManifest = useMemo(() => {
    const installedTools = new Set(session.hostStatus?.installedTools ?? []);
    return workspaceToolManifest.filter((tool) =>
      installedTools.has(tool.name),
    );
  }, [session.hostStatus?.installedTools, workspaceToolManifest]);
  const conversationHistory = useMemo(
    () => assistantConversationHistoryFromTurns(session.turns),
    [session.turns],
  );
  const previousCompaction = useMemo(() => {
    if (session.contextMetrics?.compaction) {
      return session.contextMetrics.compaction;
    }
    return session.turns.reduce<NonNullable<
      (typeof session.turns)[number]["contextCompaction"]
    > | null>((aggregate, turn) => {
      const stats = turn.contextCompaction;
      if (!stats) return aggregate;
      return {
        count: (aggregate?.count ?? 0) + stats.count,
        lastInputTokens: stats.lastInputTokens,
        lastRetainedTokens: stats.lastRetainedTokens,
        offloadedArtifacts:
          (aggregate?.offloadedArtifacts ?? 0) + stats.offloadedArtifacts,
      };
    }, null);
  }, [session.contextMetrics?.compaction, session.turns]);
  const previousModelUsage = useMemo(() => {
    if (session.contextMetrics?.modelUsage) {
      return session.contextMetrics.modelUsage;
    }
    return session.turns.reduce<NonNullable<
      (typeof session.turns)[number]["modelUsage"]
    > | null>((aggregate, turn) => {
      const usage = turn.modelUsage;
      if (!usage) return aggregate;
      return {
        calls: (aggregate?.calls ?? 0) + usage.calls,
        inputTokens: (aggregate?.inputTokens ?? 0) + usage.inputTokens,
        outputTokens: (aggregate?.outputTokens ?? 0) + usage.outputTokens,
        totalTokens: (aggregate?.totalTokens ?? 0) + usage.totalTokens,
      };
    }, null);
  }, [session.contextMetrics?.modelUsage, session.turns]);
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
    ? providerDestinationLabel(modelConfig)
    : null;
  const cliEnvironmentRevision = useCliEnvironmentRevision(
    modelConfig?.kind === "codex-cli" || modelConfig?.kind === "codebuddy-cli"
      ? modelConfig
      : null,
  );
  const cliProviderFingerprint = cliProviderIdentityFingerprint(
    modelConfig,
    cliEnvironmentRevision,
  );
  const cliSetup =
    modelConfig && modelConfig.kind !== "openai-compatible"
      ? (cliSetupByProvider[modelConfig.kind] ?? null)
      : null;
  const cliCatalog = useAiCliCatalog(
    modelConfig?.kind === "codex-cli" || modelConfig?.kind === "codebuddy-cli"
      ? modelConfig
      : null,
    cliSetup?.phase === "ready",
  );
  const cliDetectionRevision =
    modelConfig && modelConfig.kind !== "openai-compatible"
      ? cliDetectionRevisionByProvider[modelConfig.kind]
      : 0;
  const cliProbeIdentity =
    modelConfig && modelConfig.kind !== "openai-compatible"
      ? cliProbeIdentityByProvider[modelConfig.kind]
      : null;
  const modelPrompt = useMemo(
    () => promptWithTextAttachments(message, attachments),
    [attachments, message],
  );
  const contextPreview = useMemo(
    () =>
      createAssistantContextPreview({
        message: modelPrompt,
        mode: assistantMode,
        providerLabel: contextProviderLabel,
        context: previewContext,
        selectedText,
        history: conversationHistory,
        settings: contextSettings,
        maxInputTokens: aiMaxInputTokens,
        toolManifest: agentToolManifest,
        previousCompaction,
        previousModelUsage,
      }),
    [
      agentToolManifest,
      aiMaxInputTokens,
      assistantMode,
      contextProviderLabel,
      contextSettings,
      conversationHistory,
      modelPrompt,
      previousCompaction,
      previousModelUsage,
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
  // Provider health follows the newest turn only. Reusing an older failed turn
  // after a later successful request would incorrectly send a ready CLI back to
  // its authentication screen whenever the Assistant panel remounts.
  const latestTurn = session.turns[session.turns.length - 1];
  const latestTurnWithError = latestTurn?.error?.trim()
    ? latestTurn
    : undefined;
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
  const displayedModel =
    aiProvider === "codex-cli"
      ? codexCliModel
      : aiProvider === "codebuddy-cli"
        ? codeBuddyCliModel
        : aiModel;
  const displayedEndpoint =
    aiProvider === "codex-cli"
      ? codexCliPath || "Auto-detect Codex CLI"
      : aiProvider === "codebuddy-cli"
        ? codeBuddyCliPath || "Auto-detect CodeBuddy CLI"
        : aiBaseUrl;
  const displayedReasoningEffort =
    aiProvider === "codex-cli"
      ? selectedCliReasoningEffort(
          codexCliReasoningEffortByModel,
          displayedModel,
          codexCliReasoningEffort,
        )
      : aiProvider === "codebuddy-cli"
        ? selectedCliReasoningEffort(
            codeBuddyCliReasoningEffortByModel,
            displayedModel,
            codeBuddyCliReasoningEffort,
          )
        : undefined;
  const cliModelOptions = useMemo(() => {
    if (aiProvider !== "codebuddy-cli") return cliCatalog.models;
    const selectedModel = displayedModel.trim() || "default";
    return cliCatalog.models.map((option) =>
      option.id === selectedModel
        ? { ...option, reasoningEfforts: cliCatalog.efforts }
        : option,
    );
  }, [aiProvider, cliCatalog.efforts, cliCatalog.models, displayedModel]);
  const cliCatalogWarning = [cliCatalog.warning, cliCatalog.effortWarning]
    .filter((warning): warning is string => Boolean(warning))
    .join(" ");
  const { modelStatus, submissionBlockReason } = resolveModelUiState({
    enabled: aiEnabled,
    providerKind: aiProvider,
    baseUrl: displayedEndpoint,
    model: displayedModel,
    resolvedMode,
    toolCalling: aiToolCalling,
    availability: session.availability,
    hostCapabilities: session.hostStatus?.capabilities ?? null,
    hostInstalledTools: session.hostStatus?.installedTools ?? null,
    authenticationError: activeAuthIssueId ? providerError : null,
    cliSetup,
    t,
  });
  const showProviderWelcome =
    !session.isHydrating && !aiEnabled && session.turns.length === 0;
  const cliSetupRequired = Boolean(
    modelConfig &&
    modelConfig.kind !== "openai-compatible" &&
    cliSetup &&
    cliSetup.phase !== "ready" &&
    cliSetup.phase !== "checking",
  );

  const openAiSettings = () => {
    window.dispatchEvent(
      new CustomEvent(APP_EVENT_OPEN_SETTINGS, {
        detail: { section: "ai" },
      }),
    );
  };

  const selectAssistantProvider = (provider: AiProviderKind) => {
    if (session.isBusy) return;
    if (
      (aiProvider === "codex-cli" || aiProvider === "codebuddy-cli") &&
      aiProvider !== provider
    ) {
      const activeSetup = cliSetupByProvider[aiProvider];
      if (
        activeSetup?.phase === "authorizing" &&
        activeSetup.authenticationSessionId
      ) {
        void aiService
          .cancelCliAuthentication(activeSetup.authenticationSessionId)
          .catch(() => undefined);
      }
    }
    if (authIssueId) setDismissedAuthIssueId(authIssueId);
    if (provider !== "openai-compatible" && !cliSetupByProvider[provider]) {
      updateCliSetup(provider, {
        phase: "checking",
        message: t("assistant.setup.verifying"),
      });
    }
    updateAiSettings({
      enabled: true,
      provider,
    });
  };

  const retryAssistantProvider = () => {
    if (authIssueId) setDismissedAuthIssueId(authIssueId);
    if (aiProvider === "codex-cli" || aiProvider === "codebuddy-cli") {
      updateCliSetup(aiProvider, (current) =>
        current && current.phase !== "ready" && current.phase !== "checking"
          ? {
              ...current,
              message: t("assistant.setup.verifyingAgain"),
              refreshing: true,
            }
          : {
              phase: "checking",
              message: t("assistant.setup.verifyingAgain"),
            },
      );
      requestCliDetection(aiProvider);
      return;
    }
    void session.refreshStatus();
  };

  const installAssistantProvider = async () => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") return;
    const provider = modelConfig.kind;
    try {
      const installation = await aiService.beginCliInstallation(provider);
      updateCliSetup(provider, {
        phase: "installing",
        message: installation.message,
        installationSessionId: installation.sessionId,
      });
    } catch (error) {
      updateCliSetup(provider, {
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const authenticateAssistantProvider = async (methodId?: string) => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") return;
    const provider = modelConfig.kind;
    try {
      updateCliSetup(provider, (current) => ({
        ...current,
        phase: "authorizing",
        message: t("assistant.setup.startingSignIn"),
        authenticationMethodId: methodId,
      }));
      const result = await aiService.beginCliAuthentication(
        modelConfig,
        methodId,
      );
      updateCliSetup(provider, (current) => ({
        ...current,
        phase: "authorizing",
        message: result.message,
        authenticationSessionId: result.sessionId,
        authenticationMethodId: methodId,
      }));
    } catch (error) {
      updateCliSetup(provider, (current) => ({
        phase: cliSetupPhaseForFailure(error),
        message: error instanceof Error ? error.message : String(error),
        executablePath: current?.executablePath,
        version: current?.version,
        authenticationSessionId: undefined,
        refreshing: false,
      }));
    }
  };

  const cancelAssistantAuthentication = async () => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") return;
    const sessionId = cliSetup?.authenticationSessionId;
    if (!sessionId) {
      updateCliSetup(modelConfig.kind, (current) => ({
        ...current,
        phase: "auth-required",
        message: t("assistant.setup.signInCancelled"),
      }));
      return;
    }
    try {
      const status = await aiService.cancelCliAuthentication(sessionId);
      updateCliSetup(modelConfig.kind, (current) => ({
        ...current,
        phase: "auth-required",
        message: status.message,
        authenticationSessionId: undefined,
      }));
    } catch (error) {
      updateCliSetup(modelConfig.kind, (current) => ({
        ...current,
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  useEffect(() => {
    if (
      cliSetup?.phase !== "installing" ||
      !modelConfig ||
      modelConfig.kind === "openai-compatible"
    ) {
      return;
    }
    const provider = modelConfig.kind;
    const installationSessionId = cliSetup.installationSessionId;
    if (!installationSessionId) {
      updateCliSetup(provider, (current) => ({
        ...current,
        phase: "error",
        message: t("assistant.setup.installInterrupted"),
      }));
      return;
    }
    let disposed = false;
    let timer: number | undefined;
    const poll = () => {
      void aiService
        .getCliInstallationStatus(installationSessionId)
        .then((status) => {
          if (disposed) return;
          if (status.phase === "succeeded" && status.result) {
            const executablePath = status.result.executablePath;
            updateAiSettings(
              provider === "codex-cli"
                ? { codexCliPath: executablePath }
                : { codeBuddyCliPath: executablePath },
            );
            updateCliSetup(provider, (current) => ({
              ...current,
              phase: "checking",
              message: t("assistant.setup.installComplete"),
              executablePath,
              installationSessionId: undefined,
              refreshing: true,
            }));
            requestCliDetection(provider);
            return;
          }
          if (status.phase === "failed") {
            updateCliSetup(provider, (current) => ({
              ...current,
              phase: "error",
              message: status.message,
              installationSessionId: undefined,
              refreshing: false,
            }));
            return;
          }
          updateCliSetup(provider, (current) => ({
            ...current,
            phase: "installing",
            message: status.message,
            installationSessionId,
          }));
          timer = window.setTimeout(poll, 750);
        })
        .catch((error) => {
          if (disposed) return;
          updateCliSetup(provider, (current) => ({
            ...current,
            phase: "error",
            message:
              error instanceof Error
                ? error.message
                : t("assistant.setup.resumeInstallFailed"),
            installationSessionId: undefined,
          }));
        });
    };
    poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    cliProviderFingerprint,
    cliSetup?.installationSessionId,
    cliSetup?.phase,
    requestCliDetection,
    t,
    updateAiSettings,
    updateCliSetup,
  ]);

  useEffect(() => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") {
      return;
    }
    const provider = modelConfig.kind;
    const probeFingerprint =
      cliProviderFingerprint ?? `provider:${modelConfig.kind}`;
    const probeFresh =
      cliProbeIdentity?.verifiedAt !== undefined &&
      Date.now() - cliProbeIdentity.verifiedAt < CLI_PROBE_TTL_MS;
    if (
      cliProbeIdentity?.fingerprint === probeFingerprint &&
      cliProbeIdentity.completedRevision === cliDetectionRevision &&
      probeFresh
    ) {
      return;
    }
    let disposed = false;
    updateCliSetup(provider, (current) =>
      current && current.phase !== "ready" && current.phase !== "checking"
        ? {
            ...current,
            message: t("assistant.setup.verifying"),
            refreshing: true,
          }
        : {
            phase: "checking",
            message: t("assistant.setup.verifying"),
          },
    );
    void aiService
      .detectCliProvider(modelConfig)
      .then(async (result) => {
        if (disposed) return;
        if (!result.available) {
          updateCliSetup(provider, {
            phase: "missing",
            message: result.message,
            executablePath: result.executablePath,
            version: result.version,
          });
          completeCliProbe(
            provider,
            probeFingerprint,
            cliDetectionRevision,
          );
          return;
        }
        updateCliSetup(provider, (current) => ({
          phase: current?.phase === "installing" ? "installing" : "checking",
          message: t("assistant.setup.cliDetected"),
          executablePath: result.executablePath,
          version: result.version,
        }));
        try {
          const tested = await aiService.testProvider(modelConfig);
          if (disposed) return;
          updateCliSetup(provider, {
            phase: "ready",
            message: tested.message,
            executablePath: tested.executablePath || result.executablePath,
            version: tested.version || result.version,
          });
          completeCliProbe(
            provider,
            probeFingerprint,
            cliDetectionRevision,
          );
        } catch (error) {
          if (disposed) return;
          const message =
            error instanceof Error ? error.message : String(error);
          updateCliSetup(provider, {
            phase: isAuthenticationError(error) ? "auth-required" : "error",
            message,
            executablePath: result.executablePath,
            version: result.version,
          });
          completeCliProbe(
            provider,
            probeFingerprint,
            cliDetectionRevision,
          );
        }
      })
      .catch((error) => {
        if (disposed) return;
        updateCliSetup(provider, {
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        completeCliProbe(
          provider,
          probeFingerprint,
          cliDetectionRevision,
        );
      });
    return () => {
      disposed = true;
    };
  }, [
    cliDetectionRevision,
    cliProbeIdentity?.completedRevision,
    cliProbeIdentity?.fingerprint,
    cliProbeIdentity?.verifiedAt,
    cliProviderFingerprint,
    completeCliProbe,
    t,
    updateAiSettings,
    updateCliSetup,
  ]);

  useEffect(() => {
    if (
      cliSetup?.phase !== "auth-required" ||
      cliSetup.authenticationMethods?.length ||
      cliSetup.authMethodsLoading ||
      !modelConfig ||
      modelConfig.kind === "openai-compatible"
    ) {
      return;
    }
    const provider = modelConfig.kind;
    updateCliSetup(provider, (current) => ({
      ...current,
      phase: "auth-required",
      message: current?.message ?? t("assistant.setup.chooseSignIn"),
      authMethodsLoading: true,
    }));
    void aiService
      .listCliAuthenticationMethods(modelConfig)
      .then((methods) => {
        updateCliSetup(provider, (current) => ({
          ...current,
          phase: "auth-required",
          message:
            current?.message ?? t("assistant.setup.chooseSignIn"),
          authenticationMethods: methods,
          authMethodsLoading: false,
        }));
      })
      .catch((error) => {
        updateCliSetup(provider, (current) => ({
          ...current,
          phase: "auth-required",
          message: error instanceof Error ? error.message : String(error),
          authMethodsLoading: false,
        }));
      });
  }, [cliProviderFingerprint, cliSetup?.phase, t, updateCliSetup]);

  useEffect(() => {
    if (
      cliSetup?.phase !== "authorizing" ||
      !modelConfig ||
      modelConfig.kind === "openai-compatible"
    ) {
      return;
    }
    let disposed = false;
    const config: AiCliProviderConfig = modelConfig;
    const provider = config.kind;
    const authenticationSessionId = cliSetup.authenticationSessionId;
    if (!authenticationSessionId) {
      updateCliSetup(provider, (current) => ({
        ...current,
        phase: "auth-required",
        message: t("assistant.setup.signInInterrupted"),
      }));
      return;
    }
    let timer: number | undefined;
    const poll = () => {
      void aiService
        .getCliAuthenticationStatus(authenticationSessionId)
        .then(async (status) => {
          if (disposed) return;
          if (status.phase === "succeeded") {
            let result;
            try {
              result = await aiService.testProvider(config);
            } catch (error) {
              if (disposed) return;
              updateCliSetup(provider, (current) => ({
                ...current,
                phase: cliSetupPhaseForFailure(error),
                message:
                  cliSetupPhaseForFailure(error) === "auth-required"
                    ? t("assistant.setup.signInVerificationFailed")
                    : error instanceof Error
                      ? error.message
                      : String(error),
                authenticationSessionId: undefined,
                refreshing: false,
              }));
              return;
            }
            if (disposed) return;
            updateCliSetup(provider, (current) => ({
              ...current,
              phase: "ready",
              message: result.message,
              executablePath: result.executablePath,
              version: result.version,
              authenticationSessionId: undefined,
              refreshing: false,
            }));
            void session.refreshStatus();
            return;
          }
          if (["failed", "cancelled", "expired"].includes(status.phase)) {
            updateCliSetup(provider, (current) => ({
              ...current,
              phase: "auth-required",
              message: status.message,
              authenticationSessionId: undefined,
              refreshing: false,
            }));
            return;
          }
          updateCliSetup(provider, (current) => ({
            ...current,
            phase: "authorizing",
            message: status.message,
            authenticationSessionId,
            authenticationMethodId: status.methodId,
          }));
          timer = window.setTimeout(poll, 1_000);
        })
        .catch((error) => {
          if (disposed) return;
          const message =
            error instanceof Error ? error.message : String(error);
          updateCliSetup(provider, (current) => ({
            ...current,
            phase: "error",
            message,
          }));
        });
    };
    poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    cliSetup?.authenticationSessionId,
    cliSetup?.phase,
    cliProviderFingerprint,
    session.refreshStatus,
    t,
    updateAiSettings,
    updateCliSetup,
  ]);

  useEffect(() => {
    if (
      !activeAuthIssueId ||
      !providerError ||
      aiProvider === "openai-compatible"
    ) {
      return;
    }
    updateCliSetup(aiProvider, (current) => ({
      phase: "auth-required",
      message: providerError,
      executablePath: current?.executablePath,
      version: current?.version,
    }));
  }, [activeAuthIssueId, aiProvider, providerError, updateCliSetup]);

  useEffect(() => {
    const fingerprint = JSON.stringify(modelConfig);
    if (providerFingerprintRef.current === fingerprint) return;
    providerFingerprintRef.current = fingerprint;
    if (authIssueId) setDismissedAuthIssueId(authIssueId);
  }, [
    aiApiKey,
    aiBaseUrl,
    aiEnabled,
    aiModel,
    aiProvider,
    authIssueId,
    codeBuddyCliModel,
    codeBuddyCliPath,
    codeBuddyCliReasoningEffort,
    codeBuddyCliReasoningEffortByModel,
    codeBuddyCliEnvironmentKeys,
    codexCliModel,
    codexCliPath,
    codexCliReasoningEffort,
    codexCliReasoningEffortByModel,
    codexCliEnvironmentKeys,
    modelConfig,
  ]);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element || !autoFollowConversationRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
      setShowScrollToBottom(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [turnsContentVersion]);

  const handleSubmit = async () => {
    const prompt = message.trim();
    if (!prompt || session.isBusy || submissionBlockReason) return;
    const mode = resolveAssistantMode(assistantMode, prompt);
    const submittedAttachments = attachments;
    const submittedPrompt = promptWithTextAttachments(
      prompt,
      submittedAttachments,
    );
    if (submittedPrompt.length > 200_000) {
      setAttachmentError(
        "Prompt and attachment text must stay under 200,000 characters.",
      );
      return;
    }
    const contextSettingsSnapshot = { ...contextSettings };
    const scopedContext = applyAssistantContextSettings(
      createWorkspaceAiToolContext(),
      contextSettingsSnapshot,
    );
    const turnInput = createAssistantTurnInput(
      submittedPrompt,
      assistantMode,
      selectedText,
      conversationHistory,
      contextSettingsSnapshot,
    );
    const turnId = createAgentTurnId();
    const binding = scopedContext.workspaceContext!;
    setMessage("");
    setAttachments([]);
    setAttachmentError(null);
    autoFollowConversationRef.current = true;
    await session.startTurn({
      requestId: `request:${turnId}`,
      turnId,
      projectId: activeProjectId,
      requestedMode: assistantMode,
      profile: mode,
      messages: boundedConversationHistory(turnInput.history),
      prompt: submittedPrompt,
      displayMessage: prompt,
      inputAttachments: submittedAttachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        byteCount: attachment.byteCount,
      })),
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
          attachments: submittedAttachments.map((attachment) => ({
            fileName: attachment.fileName,
            byteCount: attachment.byteCount,
          })),
        },
      },
      tools: assistantToolManifestForProfile(mode, agentToolManifest),
      contextVersion: binding.fingerprint,
    });
  };

  const handleAddAttachment = async () => {
    if (session.isBusy || attachments.length >= 4 || isAddingAttachment) return;
    setIsAddingAttachment(true);
    setAttachmentError(null);
    try {
      const attachment = await agentHostService.importTextAttachment();
      if (!attachment) return;
      const nextTotal =
        attachments.reduce((total, item) => total + item.byteCount, 0) +
        attachment.byteCount;
      if (nextTotal > 128 * 1024) {
        setAttachmentError("Attachments are limited to 128 KiB per request.");
        return;
      }
      setAttachments((current) => [
        ...current,
        {
          ...attachment,
          id: `attachment:${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
        },
      ]);
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsAddingAttachment(false);
    }
  };

  const handleExecuteAttachment = async (request: UiActionRequest) => {
    return await uiActionRegistry.execute(request);
  };
  const handleUsePrompt = (prompt: string) => {
    setMessage(prompt);
    window.requestAnimationFrame(() => {
      const composer = document.querySelector<HTMLTextAreaElement>(
        '[data-assistant-prompt="true"]',
      );
      composer?.focus();
      composer?.setSelectionRange(prompt.length, prompt.length);
    });
  };
  const handleUseComposeRequest = () => {
    if (!composeRequest) return;
    const targetExists = useTabStore
      .getState()
      .tabs.some((tab) => tab.id === composeRequest.tabId);
    if (targetExists) {
      useTabStore.getState().setActiveTab(composeRequest.tabId);
    }
    handleUsePrompt(composeRequest.prompt);
    consumeComposeRequest(composeRequest.id);
  };
  const handlePreviewSqlPatch = (replacement: string) => {
    const tabState = useTabStore.getState();
    const tab = tabState.tabs.find(
      (candidate) => candidate.id === tabState.activeTabId,
    );
    if (!tab) return;
    const patch = createAssistantSqlPatchPreview(
      tab,
      replacement,
      `assistant-patch:${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
      tab.queryError?.database?.documentExecutionRange,
    );
    if (!patch) {
      setAttachmentError(
        "This SQL block cannot be previewed in the active editor.",
      );
      return;
    }
    setAttachmentError(null);
    tabState.previewEditorPatch(tab.id, patch);
  };

  useEffect(() => {
    if (!composeRequest || session.isBusy || message.trim()) return;
    handleUseComposeRequest();
  }, [composeRequest, message, session.isBusy]);

  const activeContextLabel = activeTab?.title || "No active editor";
  const pendingLabel = session.activeTurn
    ? agentTurnPendingLabel(session.activeTurn.status)
    : "Thinking...";

  const openPendingFileProposal = (item: PendingAssistantFileProposal) => {
    openProjectFileProposalInEditor(
      item.projectId,
      item.turnId,
      item.proposal,
      activeProjectRoot,
    );
  };

  const keepPendingFileChange = (item: PendingAssistantFileProposal) => {
    session.keepFileChange(item.turnId, item.proposal.callId);
  };

  const undoPendingFileChange = (item: PendingAssistantFileProposal) =>
    session.undoFileChange(
      item.turnId,
      item.proposal.callId,
      activeProjectRoot,
    );

  useEffect(() => {
    const listener = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<AgentFileReviewDecisionDetail>;
      const detail = event.detail;
      if (!detail) return;
      const item = pendingAssistantFileProposals(session.turns).find(
        (candidate) =>
          candidate.turnId === detail.turnId &&
          candidate.proposal.callId === detail.callId,
      );
      if (!item) return;
      if (detail.action === "keep-file") {
        keepPendingFileChange(item);
      } else if (detail.action === "undo-file") {
        void undoPendingFileChange(item).catch(() => undefined);
      } else if (detail.action === "keep-hunk" && detail.hunk) {
        session.keepFileChangeHunk(
          item.turnId,
          item.proposal.callId,
          detail.hunk,
        );
      } else if (detail.action === "undo-hunk" && detail.hunk) {
        void session
          .undoFileChangeHunk(
            item.turnId,
            item.proposal.callId,
            detail.hunk,
            activeProjectRoot,
          )
          .catch(() => undefined);
      }
    };
    window.addEventListener(APP_EVENT_AGENT_FILE_REVIEW, listener);
    return () =>
      window.removeEventListener(APP_EVENT_AGENT_FILE_REVIEW, listener);
  }, [activeProjectRoot, session]);

  useEffect(() => {
    setProjectTurns(activeProjectId, session.turns);
  }, [activeProjectId, session.turns, setProjectTurns]);

  useEffect(() => {
    const tabs = useTabStore.getState();
    for (const turn of session.turns) {
      for (const proposal of turn.fileProposals ?? []) {
        tabs.syncAgentFileDiffPreview({
          ...proposal,
          turnId: turn.id,
          projectId: turn.projectId,
          expectedRoot: activeProjectRoot,
        });
      }
    }
  }, [activeProjectRoot, session.turns]);

  return (
    <div className="wb-assistant-shell flex h-full flex-col wb-panel">
      <AssistantHeader
        isRunning={session.isBusy}
        onHide={() => setToolWindowVisible("assistant", false)}
        onNewChat={() => {
          autoFollowConversationRef.current = true;
          setMessage("");
          session.clear();
          setAttachments([]);
          setAttachmentError(null);
        }}
      />

      <AssistantProviderControl
        provider={aiProvider}
        enabled={aiEnabled}
        destination={
          modelConfig?.kind === "openai-compatible"
            ? contextProviderLabel
            : null
        }
        modelStatus={modelStatus}
        cliSetup={cliSetup}
        isBusy={session.isBusy}
        onSelect={selectAssistantProvider}
        onRetry={retryAssistantProvider}
        onOpenSettings={openAiSettings}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[hsl(var(--wb-editor))]">
        <div
          ref={scrollContainerRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            autoFollowConversationRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              72;
            setShowScrollToBottom(!autoFollowConversationRef.current);
          }}
          className={cn(
            "custom-scrollbar h-full overflow-auto",
            session.turns.length >= 4 && "wb-assistant-scroll-with-minimap",
          )}
        >
          {session.isHydrating ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
              aria-live="polite"
              data-assistant-hydrating
            >
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[hsl(var(--wb-border))] border-t-[hsl(var(--wb-accent))]" />
              <div className="text-[10px] font-medium">Restoring Assistant conversation</div>
              <div className="max-w-xs text-[9px] leading-4 wb-muted">
                Reconciling the encrypted snapshot and any unfinished activity before accepting a new request.
              </div>
            </div>
          ) : showProviderWelcome ? (
            <AssistantProviderWelcome
              isBusy={session.isBusy}
              onSelect={selectAssistantProvider}
              onOpenSettings={openAiSettings}
            />
          ) : cliSetupRequired &&
            modelConfig?.kind !== "openai-compatible" &&
            cliSetup ? (
            <AssistantProviderSetup
              provider={
                aiProvider === "codex-cli" ? "codex-cli" : "codebuddy-cli"
              }
              state={cliSetup}
              onInstall={() => void installAssistantProvider()}
              onAuthenticate={(methodId) =>
                void authenticateAssistantProvider(methodId)
              }
              onCancelAuthentication={() =>
                void cancelAssistantAuthentication()
              }
              onRetry={retryAssistantProvider}
              onOpenSettings={openAiSettings}
            />
          ) : (
            <>
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
                starterPrompts={
                  assistantProviderDefinition(aiProvider).starterPrompts
                }
                isResponding={false}
                pendingLabel={pendingLabel}
                onUsePrompt={handleUsePrompt}
                onPreviewSqlPatch={handlePreviewSqlPatch}
                onExecuteAttachment={handleExecuteAttachment}
                onOpenProjectFile={openProjectFileInEditor}
                onOpenProjectFileProposal={(turnId, callId) => {
                  const item = pendingAssistantFileProposals(
                    session.turns,
                  ).find(
                    (candidate) =>
                      candidate.turnId === turnId &&
                      candidate.proposal.callId === callId,
                  );
                  if (item) openPendingFileProposal(item);
                }}
                expectedProjectRoot={activeProjectRoot}
                contextFingerprint={contextFingerprint}
                onDecideApproval={session.decideApproval}
                onResumeTurn={session.resumeTurn}
              />
            </>
          )}
        </div>

        <AssistantConversationMinimap
          turns={session.turns}
          scrollContainerRef={scrollContainerRef}
          contentVersion={turnsContentVersion}
        />
        {showScrollToBottom && (
          <button
            type="button"
            className="absolute bottom-3 right-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text-muted))] shadow-md hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
            onClick={() => {
              const element = scrollContainerRef.current;
              if (!element) return;
              element.scrollTo({
                top: element.scrollHeight,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
              });
              autoFollowConversationRef.current = true;
              setShowScrollToBottom(false);
            }}
            title="Scroll to latest response"
            aria-label="Scroll to latest response"
          >
            <ArrowDown size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      {!showProviderWelcome && !cliSetupRequired && (
        <div className="relative shrink-0">
          <AssistantClarificationDock
            turn={
              session.activeTurn?.status === "awaiting_input"
                ? session.activeTurn
                : null
            }
            contextFingerprint={contextFingerprint}
            onAnswer={session.answerClarification}
          />

          <AssistantPendingChangesPanel
            turns={session.turns}
            onOpen={openPendingFileProposal}
            onKeep={keepPendingFileChange}
            onUndo={undoPendingFileChange}
          />

          {composeRequest && message.trim() && (
            <div
              className="flex items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2.5 py-1.5 text-[10px]"
              data-assistant-compose-suggestion
            >
              <Sparkles
                size={11}
                className="shrink-0 text-[hsl(var(--wb-accent))]"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text-muted))]">
                Query error fix prompt ready
              </span>
              <button
                type="button"
                className="wb-text-button h-6 px-1.5 text-[10px]"
                onClick={handleUseComposeRequest}
              >
                Use prompt
              </button>
              <button
                type="button"
                className="wb-icon-button h-6 w-6"
                onClick={() => consumeComposeRequest(composeRequest.id)}
                title="Dismiss suggested prompt"
                aria-label="Dismiss suggested prompt"
              >
                <X size={10} aria-hidden="true" />
              </button>
            </div>
          )}

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
              if (session.isBusy) return;
              updateAiSettings(
                aiProvider === "codex-cli"
                  ? { codexCliAssistantMode: mode }
                  : aiProvider === "codebuddy-cli"
                    ? { codeBuddyCliAssistantMode: mode }
                    : { assistantMode: mode },
              );
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
            model={displayedModel}
            modelEndpoint={displayedEndpoint}
            modelStatus={modelStatus}
            modelOptions={
              aiProvider === "codex-cli" || aiProvider === "codebuddy-cli"
                ? cliModelOptions
                : undefined
            }
            modelCatalogStatus={
              aiProvider === "codex-cli" || aiProvider === "codebuddy-cli"
                ? cliCatalog.status
                : undefined
            }
            modelCatalogWarning={
              aiProvider === "codex-cli" || aiProvider === "codebuddy-cli"
                ? cliCatalogWarning || undefined
                : undefined
            }
            reasoningEffort={displayedReasoningEffort}
            commandOptions={
              aiProvider === "codex-cli" || aiProvider === "codebuddy-cli"
                ? cliCatalog.commands
                : undefined
            }
            onModelChange={(model) =>
              updateAiSettings(
                aiProvider === "codex-cli"
                  ? { codexCliModel: model }
                  : aiProvider === "codebuddy-cli"
                    ? { codeBuddyCliModel: model }
                    : { model },
              )
            }
            onReasoningEffortChange={(reasoningEffort) =>
              updateAiSettings(
                aiProvider === "codex-cli"
                  ? { codexCliReasoningEffort: reasoningEffort }
                  : aiProvider === "codebuddy-cli"
                    ? { codeBuddyCliReasoningEffort: reasoningEffort }
                    : {},
              )
            }
            onOpenAiSettings={openAiSettings}
            onRetryModel={() => {
              if (authIssueId) setDismissedAuthIssueId(authIssueId);
              const catalogNeedsRefresh =
                (aiProvider === "codex-cli" || aiProvider === "codebuddy-cli") &&
                (cliCatalog.status === "error" ||
                  cliCatalog.warning ||
                  cliCatalog.effortWarning);
              if (catalogNeedsRefresh) {
                cliCatalog.refresh();
                // A catalog retry is not an installation or authentication
                // retry. Re-probing here briefly replaces a usable composer
                // with the setup surface and makes model selection flicker.
                return;
              }
              retryAssistantProvider();
            }}
            submissionBlockReason={submissionBlockReason}
            modeOptions={assistantProviderDefinition(aiProvider).modeOptions}
            attachments={attachments}
            attachmentError={attachmentError}
            isAddingAttachment={isAddingAttachment}
            onAddAttachment={() => void handleAddAttachment()}
            onRemoveAttachment={(attachmentId) =>
              setAttachments((current) =>
                current.filter((attachment) => attachment.id !== attachmentId),
              )
            }
          />
        </div>
      )}
    </div>
  );
}

function promptWithTextAttachments(
  message: string,
  attachments: readonly PendingTextAttachment[],
) {
  if (attachments.length === 0) return message;
  const blocks = attachments.map(
    (attachment) =>
      `\n\n--- Attached file: ${attachment.fileName} (${attachment.byteCount} bytes) ---\n${attachment.content}\n--- End attached file: ${attachment.fileName} ---`,
  );
  return `${message}${blocks.join("")}`;
}

function resolveModelUiState({
  enabled,
  providerKind,
  baseUrl,
  model,
  resolvedMode,
  toolCalling,
  availability,
  hostCapabilities,
  hostInstalledTools,
  authenticationError,
  cliSetup,
  t,
}: {
  enabled: boolean;
  providerKind: AiProviderKind;
  baseUrl: string;
  model: string;
  resolvedMode: "chat" | "plan" | "agent";
  toolCalling: boolean;
  availability: "checking" | "available" | "unavailable";
  hostCapabilities: string[] | null;
  hostInstalledTools: string[] | null;
  authenticationError: string | null;
  cliSetup: AssistantCliSetupState | null;
  t: ReturnType<typeof useI18n>["t"];
}): {
  modelStatus: AssistantModelStatus;
  submissionBlockReason: string | null;
} {
  const endpoint = endpointLabel(baseUrl);
  if (!enabled || !baseUrl.trim() || !model.trim()) {
    const detail = !enabled
      ? t("assistant.status.configureProvider")
      : !baseUrl.trim()
        ? t("assistant.status.configureEndpoint")
        : t("assistant.status.chooseModel");
    return {
      modelStatus: { kind: "missing", label: t("assistant.status.setupRequired"), detail },
      submissionBlockReason: detail,
    };
  }

  if (cliSetup && cliSetup.phase !== "ready") {
    const detail = cliSetup.message;
    return {
      modelStatus: {
        kind:
          cliSetup.phase === "checking" || cliSetup.phase === "installing"
            ? "checking"
            : cliSetup.phase === "auth-required" ||
                cliSetup.phase === "authorizing"
              ? "authentication-error"
              : "unavailable",
        label:
          cliSetup.phase === "installing"
            ? t("assistant.status.installingCli")
            : cliSetup.phase === "auth-required" ||
                cliSetup.phase === "authorizing"
              ? t("assistant.status.authenticationRequired")
              : t("assistant.status.cliSetupRequired"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (authenticationError) {
    const detail =
      providerKind === "openai-compatible"
        ? t("assistant.status.httpAuthenticationDetail")
        : t("assistant.status.cliAuthenticationDetail");
    return {
      modelStatus: {
        kind: "authentication-error",
        label: t("assistant.status.authenticationFailed"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (resolvedMode !== "chat" && !toolCalling) {
    const detail = t("assistant.status.toolCallingRequired", {
      mode: assistantModeLabel(resolvedMode, t),
    });
    return {
      modelStatus: {
        kind: "incompatible",
        label: t("assistant.status.modelCapabilityRequired"),
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
    const detail = t("assistant.status.runtimeDoesNotSupport", {
      mode: assistantModeLabel(resolvedMode, t),
    });
    return {
      modelStatus: {
        kind: "incompatible",
        label: t("assistant.status.modeUnavailable"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (
    availability === "available" &&
    resolvedMode !== "chat" &&
    (!hostInstalledTools || hostInstalledTools.length === 0)
  ) {
    const detail = t("assistant.status.toolsUnavailable");
    return {
      modelStatus: { kind: "checking", label: t("assistant.status.checkingTools"), detail },
      submissionBlockReason: detail,
    };
  }

  if (availability === "checking") {
    const detail = t("assistant.status.runtimeStarting");
    return {
      modelStatus: { kind: "checking", label: t("assistant.status.startingRuntime"), detail },
      submissionBlockReason: detail,
    };
  }

  if (
    availability === "available" &&
    (!hostCapabilities || hostCapabilities.length === 0)
  ) {
    const detail = t("assistant.status.runtimeChecking");
    return {
      modelStatus: { kind: "checking", label: t("assistant.status.checkingRuntime"), detail },
      submissionBlockReason: detail,
    };
  }

  if (availability === "unavailable") {
    const detail = t("assistant.status.runtimeUnavailable");
    return {
      modelStatus: { kind: "unavailable", label: t("assistant.status.unavailable"), detail },
      submissionBlockReason: t("assistant.status.runtimeUnavailableAction", { detail }),
    };
  }

  return {
    modelStatus: {
      kind: "configured",
      label: t("assistant.status.modelConfigured"),
      detail: t("assistant.status.requestDestination", { endpoint }),
    },
    submissionBlockReason: null,
  };
}

function assistantModeLabel(
  mode: "chat" | "plan" | "agent",
  t: ReturnType<typeof useI18n>["t"],
) {
  return t(
    mode === "chat"
      ? "assistant.status.modeChat"
      : mode === "plan"
        ? "assistant.status.modePlan"
        : "assistant.status.modeAgent",
  );
}

function isAuthenticationError(error: unknown) {
  if (error instanceof ApiError) {
    return error.code === "AI_CLI_AUTH_REQUIRED";
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b401\b|unauthori[sz]ed|not\s+authenticated|not\s+logged\s+in|sign\s+in|authentication\s+failed|incorrect\s+(?:api[- ]?)?key|invalid\s+(?:api[- ]?)?key/iu.test(
    message,
  );
}

function cliSetupPhaseForFailure(error: unknown): AssistantCliSetupState["phase"] {
  if (error instanceof ApiError) {
    if (error.code === "AI_CLI_AUTH_REQUIRED") return "auth-required";
    if (error.code === "AI_CLI_NOT_INSTALLED") return "missing";
  }
  return isAuthenticationError(error) ? "auth-required" : "error";
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

function providerDestinationLabel(provider: AiProviderConfig) {
  if (provider.kind === "codex-cli") return `${provider.model} · Codex CLI`;
  if (provider.kind === "codebuddy-cli") {
    return `${provider.model} · CodeBuddy Code CLI`;
  }

  try {
    const hostname = new URL("baseUrl" in provider ? provider.baseUrl : "")
      .hostname;
    return hostname
      ? `${provider.model} · ${hostname}`
      : `${provider.model} · custom endpoint`;
  } catch {
    return `${provider.model} · custom endpoint`;
  }
}

function cliProviderIdentityFingerprint(
  provider: AiProviderConfig | null,
  environmentRevision?: string,
) {
  if (!provider || provider.kind === "openai-compatible") return null;
  return JSON.stringify({
    kind: provider.kind,
    profileId: provider.profileId,
    executablePath: provider.executablePath || "",
    environmentKeys: [...(provider.environmentKeys || [])].sort(),
    environmentRevision:
      environmentRevision ??
      aiService.getCliEnvironmentRevision(provider.kind, provider.profileId),
  });
}

function selectedCliReasoningEffort(
  preferences: Record<string, string>,
  model: string,
  legacyEffort: string,
) {
  const selected = preferences[model.trim() || "default"]?.trim();
  if (selected) return selected;
  return Object.keys(preferences).length === 0 ? legacyEffort : "default";
}

export function assistantConversationId(provider: AiProviderConfig | null) {
  if (!provider) return undefined;
  if (provider.kind !== "openai-compatible") {
    return `provider:${provider.kind}`;
  }
  // Keep HTTP conversation history inside one non-secret destination boundary.
  // The API key is intentionally excluded: rotating a credential for the same
  // endpoint must not leak it into identifiers or discard a valid conversation.
  const identity = JSON.stringify({
    kind: provider.kind,
    baseUrl: canonicalHttpDestination(provider.baseUrl),
  });
  return `provider:http:${nonSecretDestinationDigest(identity)}`;
}

function canonicalHttpDestination(baseUrl: string) {
  const fallback = baseUrl.trim().replace(/\/+$/u, "");
  try {
    const url = new URL(fallback);
    url.username = "";
    url.password = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return fallback;
  }
}

// A synchronous 128-bit avalanche digest keeps conversation ids within the
// Host's 80-character boundary. It is an identity key, not a credential hash;
// the configured API credential is never included in the source value.
function nonSecretDestinationDigest(value: string) {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
}
