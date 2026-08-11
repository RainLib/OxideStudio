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
import { assistantConversationHistoryFromTurns } from "@/ai/assistant/turns";
import { APP_EVENT_OPEN_SETTINGS } from "@/lib/actionEvents";
import { createAssistantSqlPatchPreview } from "@/lib/assistantSqlPatch";
import {
  openProjectFileInEditor,
  openProjectFileProposalInEditor,
} from "@/lib/projectFileOpen";
import { useAssistantComposerStore } from "@/store/useAssistantComposerStore";
import { useAssistantChangeStore } from "@/store/useAssistantChangeStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  agentHostService,
  type AgentProfile,
  type AgentTextAttachment,
  type AgentToolManifestEntry,
} from "@/services/tauri/agent-host.service";
import {
  aiService,
  type AiCliDetectionResult,
  type AiProviderConfig,
} from "@/services/tauri/ai.service";
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

type PendingTextAttachment = AgentTextAttachment & { id: string };

export function assistantToolManifestForProfile(
  profile: AgentProfile,
  tools: readonly AgentToolManifestEntry[],
) {
  if (profile === "chat") {
    return tools.filter((tool) => tool.name === "workspace.getActiveTab");
  }
  if (profile === "plan") {
    return tools.filter((tool) =>
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
  const codeBuddyCliPath = useAiSettingsStore(
    (state) => state.codeBuddyCliPath,
  );
  const codeBuddyCliModel = useAiSettingsStore(
    (state) => state.codeBuddyCliModel,
  );
  const codeBuddyCliReasoningEffort = useAiSettingsStore(
    (state) => state.codeBuddyCliReasoningEffort,
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
  const assistantMode = useAiSettingsStore((state) => state.assistantMode);
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setProjectTurns = useAssistantChangeStore((state) => state.setProjectTurns);
  const activeProjectRoot = useProjectStore(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.root_path ?? null,
  );
  const activeConnectionId = useConnectionStore(
    (state) => {
      const connection = state.connections.find(
        (candidate) => candidate.id === state.activeConnectionId,
      );
      return connection && !isManagedConnection(connection)
        ? connection.id
        : null;
    },
  );
  const activeDriver = useConnectionStore(
    (state) =>
      (() => {
        const connection = state.connections.find(
        (connection) => connection.id === state.activeConnectionId,
        );
        return connection && !isManagedConnection(connection)
          ? connection.driver
          : null;
      })(),
  );
  const activeConnectionDatabase = useConnectionStore(
    (state) =>
      (() => {
        const connection = state.connections.find(
        (connection) => connection.id === state.activeConnectionId,
        );
        return connection && !isManagedConnection(connection)
          ? connection.database ?? null
          : null;
      })(),
  );
  const activeNamespace = useSchemaStore((state) => state.currentSchema);
  const activeTab = useTabStore(
    useShallow((state) => {
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
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
  const providerConfigured = Boolean(modelConfig);
  const session = useAssistantAgentSession(
    activeProjectId,
    providerConfigured,
    modelConfig?.kind,
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
  const [cliDetection, setCliDetection] = useState<
    AiCliDetectionResult | "checking" | null
  >(null);
  const [cliDetectionRevision, setCliDetectionRevision] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const autoFollowConversationRef = useRef(true);
  const providerFingerprintRef = useRef(
    JSON.stringify(modelConfig),
  );
  const uiActionRegistry = useMemo(() => createWorkspaceUiActionRegistry(), []);
  const workspaceToolManifest = useMemo(
    () =>
      [
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
    return workspaceToolManifest.filter((tool) => installedTools.has(tool.name));
  }, [session.hostStatus?.installedTools, workspaceToolManifest]);
  const conversationHistory = useMemo(
    () => assistantConversationHistoryFromTurns(session.turns),
    [session.turns],
  );
  const previousCompaction = useMemo(
    () => {
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
    },
    [session.contextMetrics?.compaction, session.turns],
  );
  const previousModelUsage = useMemo(
    () => {
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
          inputTokens:
            (aggregate?.inputTokens ?? 0) + usage.inputTokens,
          outputTokens:
            (aggregate?.outputTokens ?? 0) + usage.outputTokens,
          totalTokens:
            (aggregate?.totalTokens ?? 0) + usage.totalTokens,
        };
      }, null);
    },
    [session.contextMetrics?.modelUsage, session.turns],
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
    ? providerDestinationLabel(modelConfig)
    : null;
  const cliProviderFingerprint =
    modelConfig && modelConfig.kind !== "openai-compatible"
      ? JSON.stringify(modelConfig)
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
  const { modelStatus, submissionBlockReason } = resolveModelUiState({
    enabled: aiEnabled,
    baseUrl: displayedEndpoint,
    model: displayedModel,
    resolvedMode,
    toolCalling: aiToolCalling,
    availability: session.availability,
    hostCapabilities: session.hostStatus?.capabilities ?? null,
    hostInstalledTools: session.hostStatus?.installedTools ?? null,
    authenticationError: activeAuthIssueId ? providerError : null,
    cliDetection,
  });

  useEffect(() => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") {
      setCliDetection(null);
      return;
    }
    let disposed = false;
    setCliDetection("checking");
    void aiService
      .detectCliProvider(modelConfig)
      .then((result) => {
        if (!disposed) setCliDetection(result);
      })
      .catch((error) => {
        if (disposed) return;
        setCliDetection({
          provider: modelConfig.kind,
          available: false,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      disposed = true;
    };
  }, [cliDetectionRevision, cliProviderFingerprint]);

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
    codexCliModel,
    codexCliPath,
    codexCliReasoningEffort,
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

      {contextProviderLabel && (
        <div
          className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 text-[10px] text-[hsl(var(--wb-text-muted))]"
          data-assistant-provider
          title={contextProviderLabel}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              cliDetection !== "checking" &&
                (!cliDetection || cliDetection.available) &&
                session.availability === "available"
                ? "bg-emerald-400"
                : cliDetection === "checking" ||
                    session.availability === "checking"
                  ? "bg-amber-400"
                  : "bg-red-400",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">
            {cliDetection && cliDetection !== "checking"
              ? `${contextProviderLabel} · ${cliDetection.message}`
              : contextProviderLabel}
          </span>
          {cliDetection &&
            cliDetection !== "checking" &&
            !cliDetection.available && (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-[hsl(var(--wb-text))]"
                onClick={() => setCliDetectionRevision((value) => value + 1)}
              >
                Retry
              </button>
            )}
          {session.isBusy && <span>Active</span>}
        </div>
      )}

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
            onUsePrompt={handleUsePrompt}
            onPreviewSqlPatch={handlePreviewSqlPatch}
            onExecuteAttachment={handleExecuteAttachment}
            onOpenProjectFile={openProjectFileInEditor}
            onOpenProjectFileProposal={(turnId, callId) => {
              const item = pendingAssistantFileProposals(session.turns).find(
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
          model={displayedModel}
          modelEndpoint={displayedEndpoint}
          modelStatus={modelStatus}
          onModelChange={(model) =>
            updateAiSettings(
              aiProvider === "codex-cli"
                ? { codexCliModel: model }
                : aiProvider === "codebuddy-cli"
                  ? { codeBuddyCliModel: model }
                  : { model },
            )
          }
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
  baseUrl,
  model,
  resolvedMode,
  toolCalling,
  availability,
  hostCapabilities,
  hostInstalledTools,
  authenticationError,
  cliDetection,
}: {
  enabled: boolean;
  baseUrl: string;
  model: string;
  resolvedMode: "chat" | "plan" | "agent";
  toolCalling: boolean;
  availability: "checking" | "available" | "unavailable";
  hostCapabilities: string[] | null;
  hostInstalledTools: string[] | null;
  authenticationError: string | null;
  cliDetection: AiCliDetectionResult | "checking" | null;
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

  if (cliDetection === "checking") {
    const detail = "Detecting the configured CLI executable.";
    return {
      modelStatus: { kind: "checking", label: "Detecting CLI", detail },
      submissionBlockReason: detail,
    };
  }

  if (cliDetection && !cliDetection.available) {
    const detail = cliDetection.message;
    return {
      modelStatus: { kind: "unavailable", label: "CLI unavailable", detail },
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

  if (
    availability === "available" &&
    resolvedMode !== "chat" &&
    (!hostInstalledTools || hostInstalledTools.length === 0)
  ) {
    const detail =
      "The AI runtime has not published its installed tool catalog. Tool modes stay paused to avoid advertising actions that cannot run.";
    return {
      modelStatus: { kind: "checking", label: "Checking AI tools", detail },
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
  return /\b401\b|unauthori[sz]ed|not\s+authenticated|not\s+logged\s+in|sign\s+in|authentication\s+failed|incorrect\s+(?:api[- ]?)?key|invalid\s+(?:api[- ]?)?key/iu.test(
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

function providerDestinationLabel(
  provider: AiProviderConfig,
) {
  if (provider.kind === "codex-cli") return `${provider.model} · Codex CLI`;
  if (provider.kind === "codebuddy-cli") {
    return `${provider.model} · CodeBuddy Code CLI`;
  }

  try {
    const hostname = new URL(
      "baseUrl" in provider ? provider.baseUrl : "",
    ).hostname;
    return hostname
      ? `${provider.model} · ${hostname}`
      : `${provider.model} · custom endpoint`;
  } catch {
    return `${provider.model} · custom endpoint`;
  }
}
