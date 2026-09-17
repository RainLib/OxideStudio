import {
  createAssistantContextPreview,
  DEFAULT_ASSISTANT_CONTEXT_SETTINGS,
  type AssistantContextSettings,
} from "@/ai/assistant/contextPreview";
import {
  appendAssistantDatabaseTableContext,
  type AssistantDatabaseTableMention,
} from "@/ai/assistant/databaseTableContext";
import { resolveAssistantMode } from "@/ai/assistant/modes";
import { assistantConversationHistoryFromTurns } from "@/ai/assistant/turns";
import { AGENT_HOST_ONLY_TOOLS } from "@/ai/tools/agentHostTools";
import {
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools/defaultRegistry";
import { createWorkspaceUiActionRegistry } from "@/ai/ui-actions";
import { useAssistantPanelFileReview } from "@/features/assistant-panel/hooks/useAssistantPanelFileReview";
import { useAssistantProviderLifecycle } from "@/features/assistant-panel/hooks/useAssistantProviderLifecycle";
import { useAssistantSidebarWorkspaceState } from "@/features/assistant-panel/hooks/useAssistantSidebarWorkspaceState";
import {
  assistantConversationBelongsToScope,
  assistantConversationId,
  assistantConversationScopeKey,
  createAssistantConversationId,
} from "@/features/assistant-panel/model/conversationIdentity";
import {
  assistantConversationContentVersion,
  assistantConversationHistoryVersion,
  assistantTurnMetricsVersion,
} from "@/features/assistant-panel/model/conversationVersions";
import { createAssistantComposerActions } from "@/features/assistant-panel/model/createAssistantComposerActions";
import {
  type AssistantConversationSelection,
  type PendingTextAttachment,
} from "@/features/assistant-panel/model/panelTypes";
import {
  cliProviderIdentityFingerprint,
  cliSetupForProviderIdentity,
  selectedCliReasoningEffort,
} from "@/features/assistant-panel/model/providerIdentity";
import {
  isAuthenticationError,
  providerDestinationLabel,
  resolveModelUiState,
} from "@/features/assistant-panel/model/providerPresentation";
import {
  agentTurnPendingLabel,
  promptWithTextAttachments,
} from "@/features/assistant-panel/model/turnComposition";
import {
  persistAssistantConversationSelection,
  resolveStoredAssistantConversationId,
} from "@/features/assistant-panel/runtime/conversationSelection";
import {
  useAiCliCatalog,
  useCliEnvironmentRevision,
} from "@/hooks/useAiCliCatalog";
import { useAssistantAgentSession } from "@/hooks/useAssistantAgentSession";
import { useI18n } from "@/i18n";
import { APP_EVENT_OPEN_SETTINGS } from "@/lib/actionEvents";
import { useEffect, useMemo, useRef, useState } from "react";
import { upsertAssistantConversationHistorySummary } from "@/components/workspace/assistant/AssistantConversationHistory";

export function useAssistantSidebarController() {
  const { t } = useI18n();
  const {
    setToolWindowVisible,
    aiEnabled,
    aiProvider,
    aiBaseUrl,
    aiModel,
    aiApiKey,
    codexCliPath,
    codexCliModel,
    codexCliReasoningEffort,
    codexCliReasoningEffortByModel,
    codexCliServiceTier,
    codexCliAccessMode,
    codeBuddyCliPath,
    codeBuddyCliModel,
    codeBuddyCliReasoningEffort,
    codeBuddyCliReasoningEffortByModel,
    codexCliEnvironmentKeys,
    codeBuddyCliEnvironmentKeys,
    assistantProviderConfig,
    aiStreaming,
    aiToolCalling,
    aiStructuredOutput,
    aiMaxInputTokens,
    aiMaxOutputTokens,
    oxideAssistantMode,
    codexAssistantMode,
    codeBuddyAssistantMode,
    updateAiSettings,
    activeProjectId,
    setProjectTurns,
    activeProjectRoot,
    activeConnectionId,
    activeDriver,
    activeConnectionDatabase,
    activeNamespace,
    assistantSchemaOptions,
    loadSchemas,
    activeTab,
    composeRequest,
    consumeComposeRequest,
    cliSetupByProvider,
    cliDetectionRevisionByProvider,
    cliProbeIdentityByProvider,
    updateCliSetup,
    requestCliDetection,
    completeCliProbe,
  } = useAssistantSidebarWorkspaceState();
  const selectedText = activeTab?.editorSelection?.text || null;
  const modelConfig = assistantProviderConfig();
  const assistantMode =
    aiProvider === "codex-cli"
      ? codexAssistantMode
      : aiProvider === "codebuddy-cli"
        ? codeBuddyAssistantMode
        : oxideAssistantMode;
  const providerConfigured = Boolean(modelConfig);
  const conversationScope = assistantConversationId(modelConfig);
  const conversationScopeKey = assistantConversationScopeKey(
    activeProjectId,
    conversationScope,
  );
  const [conversationSelection, setConversationSelection] =
    useState<AssistantConversationSelection>(() => ({
      scopeKey: conversationScopeKey,
      conversationId: resolveStoredAssistantConversationId(
        activeProjectId,
        conversationScope,
      ),
    }));
  const conversationId = conversationScope
    ? conversationSelection.scopeKey === conversationScopeKey &&
      assistantConversationBelongsToScope(
        conversationSelection.conversationId,
        conversationScope,
      )
      ? conversationSelection.conversationId
      : resolveStoredAssistantConversationId(activeProjectId, conversationScope)
    : undefined;
  const session = useAssistantAgentSession(
    activeProjectId,
    providerConfigured,
    modelConfig?.kind,
    conversationId,
  );
  useEffect(() => {
    if (!conversationScope || !conversationId) return;
    if (
      conversationSelection.scopeKey === conversationScopeKey &&
      conversationSelection.conversationId === conversationId
    ) {
      return;
    }
    setConversationSelection({
      scopeKey: conversationScopeKey,
      conversationId,
    });
  }, [
    conversationId,
    conversationScope,
    conversationScopeKey,
    conversationSelection.conversationId,
    conversationSelection.scopeKey,
  ]);
  const [message, setMessage] = useState("");
  // `null` deliberately means "follow the Workspace default". A concrete
  // value is a composer-only override that is frozen into the submitted turn.
  const [assistantNamespace, setAssistantNamespace] = useState<string | null>(
    null,
  );
  const [attachments, setAttachments] = useState<PendingTextAttachment[]>([]);
  const [databaseMentions, setDatabaseMentions] = useState<
    AssistantDatabaseTableMention[]
  >([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isAddingAttachment, setIsAddingAttachment] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [contextSettings, setContextSettings] =
    useState<AssistantContextSettings>(DEFAULT_ASSISTANT_CONTEXT_SETTINGS);
  const [dismissedAuthIssueId, setDismissedAuthIssueId] = useState<
    string | null
  >(null);

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
  // Streaming answer deltas replace the active turn object on every frame, but
  // drafts are deliberately excluded from model history. Key the expensive
  // history conversion to the fields that can actually become a future prompt
  // instead of every render-time turn array identity.
  const conversationHistoryVersion = assistantConversationHistoryVersion(
    session.turns,
    session.activeTurn,
  );
  const conversationHistory = useMemo(
    () => assistantConversationHistoryFromTurns(session.turns),
    [conversationHistoryVersion],
  );
  const turnMetricsVersion = assistantTurnMetricsVersion(
    session.turns,
    session.activeTurn,
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
  }, [session.contextMetrics?.compaction, turnMetricsVersion]);
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
  }, [session.contextMetrics?.modelUsage, turnMetricsVersion]);
  const previewContext = useMemo(
    () =>
      createWorkspaceAiToolContext("assistant-agent-context-preview", {
        activeNamespace: assistantNamespace,
      }),
    [
      activeConnectionId,
      activeConnectionDatabase,
      activeDriver,
      activeNamespace,
      assistantNamespace,
      activeProjectId,
      activeTab,
    ],
  );
  useEffect(() => {
    // A schema selected for one data source must not leak into another one.
    // Reset to the new workspace default instead of changing Explorer state.
    setAssistantNamespace(null);
  }, [activeConnectionId]);
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
  const cliDetectionRevision =
    modelConfig && modelConfig.kind !== "openai-compatible"
      ? cliDetectionRevisionByProvider[modelConfig.kind]
      : 0;
  const cliProbeIdentity =
    modelConfig && modelConfig.kind !== "openai-compatible"
      ? cliProbeIdentityByProvider[modelConfig.kind]
      : null;
  const cliSetupForCurrentIdentity = cliSetupForProviderIdentity(
    cliSetup,
    cliProviderFingerprint,
    cliProbeIdentity?.fingerprint,
    t("assistant.setup.verifying"),
  );
  const cliCatalog = useAiCliCatalog(
    modelConfig?.kind === "codex-cli" || modelConfig?.kind === "codebuddy-cli"
      ? modelConfig
      : null,
    cliSetupForCurrentIdentity?.phase === "ready",
    cliSetupForCurrentIdentity?.version,
  );
  const modelPrompt = useMemo(
    () =>
      promptWithTextAttachments(
        appendAssistantDatabaseTableContext(message, databaseMentions),
        attachments,
      ),
    [attachments, databaseMentions, message],
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
  const turnsContentVersion = assistantConversationContentVersion(
    session.turns,
    session.activeTurn,
  );
  useEffect(() => {
    if (!conversationScope || !conversationId || session.turns.length === 0) {
      return;
    }
    const firstTurn = session.turns[0];
    const latestTurn = session.turns[session.turns.length - 1];
    if (!firstTurn || !latestTurn) return;
    upsertAssistantConversationHistorySummary(
      activeProjectId,
      conversationScope,
      {
        projectId: activeProjectId,
        conversationId,
        threadId: firstTurn.threadId || latestTurn.threadId || "",
        title: firstTurn.userMessage.replace(/\s+/gu, " ").trim().slice(0, 80),
        turnCount: session.turns.length,
        updatedAt: latestTurn.updatedAt,
      },
    );
  }, [
    activeProjectId,
    conversationId,
    conversationScope,
    session.turns,
    turnsContentVersion,
  ]);
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
  const selectedCliModelUnavailable =
    (aiProvider === "codex-cli" || aiProvider === "codebuddy-cli") &&
    cliCatalog.status !== "loading" &&
    !cliCatalog.stale &&
    displayedModel.trim() !== "" &&
    displayedModel.trim() !== "default" &&
    (cliCatalog.status === "empty" ||
      (cliCatalog.status === "ready" &&
        !cliCatalog.models.some(
          (option) => option.id === displayedModel.trim(),
        )));
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
    cliSetup: cliSetupForCurrentIdentity,
    selectedCliModelUnavailable,
    t,
  });
  const assistantSubmissionBlockReason =
    session.hydrationError || submissionBlockReason;
  const showProviderWelcome =
    !session.isHydrating && !aiEnabled && session.turns.length === 0;
  const cliSetupRequired = Boolean(
    modelConfig &&
      modelConfig.kind !== "openai-compatible" &&
      cliSetupForCurrentIdentity &&
      cliSetupForCurrentIdentity.phase !== "ready" &&
      cliSetupForCurrentIdentity.phase !== "checking",
  );

  const openAiSettings = () => {
    window.dispatchEvent(
      new CustomEvent(APP_EVENT_OPEN_SETTINGS, {
        detail: { section: "ai" },
      }),
    );
  };

  const resetConversationComposer = () => {
    autoFollowConversationRef.current = true;
    setMessage("");
    setAttachments([]);
    setAttachmentError(null);
  };

  const activateConversation = (nextConversationId: string) => {
    if (
      !conversationScope ||
      !assistantConversationBelongsToScope(
        nextConversationId,
        conversationScope,
      )
    ) {
      return;
    }
    persistAssistantConversationSelection(
      activeProjectId,
      conversationScope,
      nextConversationId,
    );
    setConversationSelection({
      scopeKey: conversationScopeKey,
      conversationId: nextConversationId,
    });
    resetConversationComposer();
  };

  const startNewConversation = () => {
    if (session.isBusy) return;
    if (!conversationScope) {
      resetConversationComposer();
      session.clear();
      return;
    }
    activateConversation(createAssistantConversationId(conversationScope));
  };

  const {
    selectAssistantProvider,
    retryAssistantProvider,
    installAssistantProvider,
    authenticateAssistantProvider,
    cancelAssistantAuthentication,
  } = useAssistantProviderLifecycle({
    session,
    aiProvider,
    cliSetupByProvider,
    authIssueId,
    setDismissedAuthIssueId,
    updateCliSetup,
    t,
    updateAiSettings,
    requestCliDetection,
    modelConfig,
    cliSetup,
    cliProviderFingerprint,
    cliProbeIdentity,
    cliDetectionRevision,
    completeCliProbe,
  });

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

  const {
    handleSubmit,
    handleAddAttachment,
    handleExecuteAttachment,
    handleUsePrompt,
    handleUseComposeRequest,
    handlePreviewSqlPatch,
  } = createAssistantComposerActions({
    message,
    session,
    assistantSubmissionBlockReason,
    assistantMode,
    attachments,
    databaseMentions,
    setAttachmentError,
    contextSettings,
    assistantNamespace,
    selectedText,
    conversationHistory,
    setMessage,
    setAttachments,
    setDatabaseMentions,
    autoFollowConversationRef,
    activeProjectId,
    modelConfig,
    aiStreaming,
    aiToolCalling,
    aiStructuredOutput,
    aiMaxInputTokens,
    aiMaxOutputTokens,
    activeConnectionDatabase,
    agentToolManifest,
    isAddingAttachment,
    setIsAddingAttachment,
    uiActionRegistry,
    composeRequest,
    consumeComposeRequest,
  });

  useEffect(() => {
    if (!composeRequest || session.isBusy) return;
    if (composeRequest.source === "query-error" && message.trim()) return;
    handleUseComposeRequest();
  }, [composeRequest, message, session.isBusy]);

  const activeContextLabel = activeTab?.title || "No active editor";
  const pendingLabel = (session.activeTurn
    ? agentTurnPendingLabel(session.activeTurn.status)
    : "Thinking...") as
    | "Waiting for your answer"
    | "Waiting for approval"
    | "Planning..."
    | "Stopping..."
    | "Working..."
    | "Thinking...";

  const {
    openPendingFileProposal,
    keepPendingFileChange,
    undoPendingFileChange,
  } = useAssistantPanelFileReview({
    activeProjectRoot,
    session,
    setProjectTurns,
    activeProjectId,
  });

  return {
    session: session,
    aiProvider: aiProvider,
    aiEnabled: aiEnabled,
    modelConfig: modelConfig,
    contextProviderLabel: contextProviderLabel,
    modelStatus: modelStatus,
    cliSetupForCurrentIdentity: cliSetupForCurrentIdentity,
    selectAssistantProvider: selectAssistantProvider,
    conversationScope: conversationScope,
    conversationId: conversationId,
    activeProjectId: activeProjectId,
    activateConversation: activateConversation,
    setToolWindowVisible: setToolWindowVisible,
    startNewConversation: startNewConversation,
    scrollContainerRef: scrollContainerRef,
    autoFollowConversationRef: autoFollowConversationRef,
    setShowScrollToBottom: setShowScrollToBottom,
    showProviderWelcome: showProviderWelcome,
    openAiSettings: openAiSettings,
    cliSetupRequired: cliSetupRequired,
    installAssistantProvider: installAssistantProvider,
    authenticateAssistantProvider: authenticateAssistantProvider,
    cancelAssistantAuthentication: cancelAssistantAuthentication,
    retryAssistantProvider: retryAssistantProvider,
    pendingLabel: pendingLabel,
    handleUsePrompt: handleUsePrompt,
    handlePreviewSqlPatch: handlePreviewSqlPatch,
    handleExecuteAttachment: handleExecuteAttachment,
    openPendingFileProposal: openPendingFileProposal,
    activeProjectRoot: activeProjectRoot,
    contextFingerprint: contextFingerprint,
    turnsContentVersion: turnsContentVersion,
    showScrollToBottom: showScrollToBottom,
    keepPendingFileChange: keepPendingFileChange,
    undoPendingFileChange: undoPendingFileChange,
    composeRequest: composeRequest,
    message: message,
    handleUseComposeRequest: handleUseComposeRequest,
    consumeComposeRequest: consumeComposeRequest,
    setMessage: setMessage,
    handleSubmit: handleSubmit,
    assistantMode: assistantMode,
    updateAiSettings: updateAiSettings,
    activeContextLabel: activeContextLabel,
    assistantNamespace: assistantNamespace,
    assistantSchemaOptions: assistantSchemaOptions,
    setAssistantNamespace: setAssistantNamespace,
    activeConnectionId: activeConnectionId,
    loadSchemas: loadSchemas,
    contextPreview: contextPreview,
    contextSettings: contextSettings,
    setContextSettings: setContextSettings,
    displayedModel: displayedModel,
    displayedEndpoint: displayedEndpoint,
    cliModelOptions: cliModelOptions,
    cliCatalog: cliCatalog,
    cliCatalogWarning: cliCatalogWarning,
    displayedReasoningEffort: displayedReasoningEffort,
    codexCliServiceTier: codexCliServiceTier,
    codexCliAccessMode: codexCliAccessMode,
    authIssueId: authIssueId,
    setDismissedAuthIssueId: setDismissedAuthIssueId,
    assistantSubmissionBlockReason: assistantSubmissionBlockReason,
    attachments: attachments,
    databaseMentions: databaseMentions,
    attachmentError: attachmentError,
    isAddingAttachment: isAddingAttachment,
    handleAddAttachment: handleAddAttachment,
    setAttachments: setAttachments,
    setDatabaseMentions: setDatabaseMentions,
  };
}
