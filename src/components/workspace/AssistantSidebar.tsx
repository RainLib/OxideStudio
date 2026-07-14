import { createAssistantPlannerSelection } from "@/ai/assistant/plannerRegistry";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import {
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools/defaultRegistry";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useAiAuditStore } from "@/store/useAiAuditStore";
import { useTabStore } from "@/store/useTabStore";
import type {
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantToolLoopEvent,
  AssistantToolCallResult,
  AssistantToolResultSummary,
  AssistantTurnInput,
} from "@/ai/assistant/types";
import {
  resolveAssistantMode,
  type AssistantMode,
  type ResolvedAssistantMode,
} from "@/ai/assistant/modes";
import { aiService } from "@/services/tauri/ai.service";
import {
  boundedAssistantText,
  boundedConversationHistory,
  CHAT_CONTEXT_LIMITS,
} from "@/ai/assistant/chatContext";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantHeader } from "./assistant/AssistantHeader";
import { AssistantActivity } from "./assistant/AssistantActivity";
import {
  AssistantConversation,
  type AssistantConversationEntry,
} from "./assistant/AssistantConversation";
import { AssistantPlanView } from "./assistant/AssistantPlanView";
import { AssistantPromptBox } from "./assistant/AssistantPromptBox";
import {
  createAssistantAttachments,
  createWorkspaceUiActionRegistry,
} from "@/ai/ui-actions";
import type {
  AssistantAttachment,
  UiActionRequest,
} from "@/ai/ui-actions/types";

export function AssistantSidebar() {
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);
  const aiModel = useAiSettingsStore((state) => state.model);
  const aiApiKey = useAiSettingsStore((state) => state.apiKey);
  const aiTimeoutMs = useAiSettingsStore((state) => state.timeoutMs);
  const assistantMode = useAiSettingsStore((state) => state.assistantMode);
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const modelConfig = useMemo(() => {
    const baseUrl = aiBaseUrl.trim();
    const model = aiModel.trim();
    if (!aiEnabled || !baseUrl || !model) return null;
    return {
      baseUrl,
      model,
      apiKey: aiApiKey.trim() || undefined,
      timeoutMs: aiTimeoutMs,
    };
  }, [aiApiKey, aiBaseUrl, aiEnabled, aiModel, aiTimeoutMs]);
  const plannerSelection = useMemo(
    () =>
      createAssistantPlannerSelection({
        enabled: aiEnabled,
        plannerKind: modelConfig ? "langgraph" : "local",
        modelConfig,
      }),
    [aiEnabled, modelConfig]
  );
  const runtime = useMemo(
    () =>
      createAssistantRuntime({
        registry: createWorkspaceAiToolRegistry(),
        createContext: createWorkspaceAiToolContext,
        planner: plannerSelection.planner,
        summarizeToolResults: plannerSelection.summarizeToolResults,
      }),
    [plannerSelection]
  );
  const uiActionRegistry = useMemo(
    () => createWorkspaceUiActionRegistry(),
    []
  );
  const { tabs, activeTabId } = useTabStore();
  const auditEntries = useAiAuditStore((state) => state.entries);
  const recordAuditEntry = useAiAuditStore((state) => state.record);
  const clearAuditEntries = useAiAuditStore((state) => state.clear);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const selectedText = activeTab?.editorSelection?.text || null;
  const [message, setMessage] = useState("");
  const [activeTurnInput, setActiveTurnInput] =
    useState<AssistantTurnInput | null>(null);
  const [conversationEntries, setConversationEntries] = useState<
    AssistantConversationEntry[]
  >([]);
  const [preparedTurn, setPreparedTurn] = useState<AssistantPreparedTurn | null>(
    null
  );
  const [preparedMode, setPreparedMode] =
    useState<ResolvedAssistantMode | null>(null);
  const [approvedStepIds, setApprovedStepIds] = useState<Set<string>>(
    () => new Set()
  );
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [toolResults, setToolResults] = useState<
    Record<string, AssistantToolCallResult>
  >({});
  const [toolSummaries, setToolSummaries] = useState<
    Record<string, AssistantToolResultSummary>
  >({});
  const toolResultsRef = useRef<Record<string, AssistantToolCallResult>>({});
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const submissionIdRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [pendingMode, setPendingMode] =
    useState<ResolvedAssistantMode | null>(null);
  const [isRunningSafeSteps, setIsRunningSafeSteps] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingPlanSteps =
    preparedTurn?.suggestedPlan.filter(
      (step) => step.toolName && !toolResults[step.id]
    ) ?? [];
  const safeSteps = pendingPlanSteps.filter((step) => !step.requiresApproval);
  const runnableSteps = pendingPlanSteps;
  const isRunning = activeStepId !== null || isRunningSafeSteps;
  const activeContextLabel = activeTab?.title || "No active editor";
  const providerLabel = modelConfig?.model || "Local tools";
  const pendingLabel =
    pendingMode === "chat"
      ? "Thinking..."
      : pendingMode === "plan"
        ? "Creating a plan..."
        : "Preparing safe tools...";

  useEffect(
    () => () => {
      activeAbortControllerRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [
    auditEntries.length,
    conversationEntries.length,
    isPlanning,
    preparedTurn?.requestId,
    toolResults,
  ]);

  const appendAssistantMessage = (
    content: string,
    requestId?: string,
    status: AssistantConversationEntry["status"] = "normal",
    attachments: AssistantAttachment[] = []
  ) => {
    if (!content.trim()) return;
    setConversationEntries((current) => [
      ...current,
      {
        id: createConversationEntryId(),
        requestId,
        role: "assistant",
        content: content.trim(),
        status,
        attachments,
      },
    ]);
  };

  const handleSubmit = async () => {
    const prompt = message.trim();
    if (
      !prompt ||
      isPlanning ||
      isRunning ||
      (activeAbortControllerRef.current &&
        !activeAbortControllerRef.current.signal.aborted)
    ) {
      return;
    }
    const submissionId = ++submissionIdRef.current;
    const requestController = new AbortController();
    activeAbortControllerRef.current = requestController;
    const resolvedMode = resolveAssistantMode(assistantMode, prompt);
    const turnInput: AssistantTurnInput = {
      message: prompt,
      mode: assistantMode,
      selectedText,
      history: conversationEntries.map(({ role, content }) => ({
        role,
        content,
      })),
    };

    setError(null);
    setPreparedTurn(null);
    setPreparedMode(null);
    setActiveTurnInput(turnInput);
    setConversationEntries((current) => [
      ...current,
      {
        id: createConversationEntryId(),
        role: "user",
        content: prompt,
      },
    ]);
    setMessage("");
    toolResultsRef.current = {};
    setApprovedStepIds(new Set());
    setToolResults({});
    setToolSummaries({});
    setPendingMode(resolvedMode);
    setIsCancelling(false);
    setIsPlanning(true);
    try {
      if (resolvedMode === "chat") {
        if (!modelConfig) {
          appendAssistantMessage(
            "Chat needs an AI provider. Configure one in Settings > AI Assistant, or switch to Plan or Agent to use local database tools."
          );
          return;
        }

        const response = await aiService.chatCompletion({
          requestId: `assistant-chat-${Date.now()}-${submissionId}`,
          config: modelConfig,
          messages: [
            {
              role: "system",
              content: [
                "You are OxideStudio's database assistant in Chat mode.",
                "Answer directly and concisely. Do not claim to run tools or change data.",
                "Use the supplied workspace context when it is relevant.",
                `Workspace context: ${JSON.stringify({
                  activeTab: activeTab
                    ? {
                        title: activeTab.title,
                        type: activeTab.type,
                        connectionId: activeTab.connectionId,
                        schemaName: activeTab.schemaName,
                        sql: boundedAssistantText(activeTab.sql),
                      }
                    : null,
                  selectedText: boundedAssistantText(selectedText),
                })}`,
              ].join("\n"),
            },
            ...boundedConversationHistory(turnInput.history),
            {
              role: "user",
              content:
                boundedAssistantText(
                  prompt,
                  CHAT_CONTEXT_LIMITS.promptCharacters
                ) || "",
            },
          ],
          temperature: 0.2,
          maxTokens: 1_000,
        }, requestController.signal);
        if (requestController.signal.aborted) return;
        appendAssistantMessage(response.content);
        return;
      }

      const turn = await runtime.prepareTurnAsync(turnInput, {
        abortSignal: requestController.signal,
      });
      if (requestController.signal.aborted) return;
      setPreparedTurn(turn);
      setPreparedMode(resolvedMode);
      appendAssistantMessage(
        planResponseMessage(turn, resolvedMode),
        turn.requestId
      );

      if (resolvedMode === "agent") {
        const automaticSteps = turn.suggestedPlan.filter(
          (step) => step.toolName && !step.requiresApproval
        );
        if (automaticSteps.length > 0) {
          await runSafeSteps(
            turn,
            turnInput,
            automaticSteps,
            requestController
          );
        }
      }
    } catch (err: any) {
      if (requestController.signal.aborted) return;
      const nextError = err?.message || String(err);
      setError(nextError);
      appendAssistantMessage(
        `Assistant request failed: ${nextError}`,
        undefined,
        "error"
      );
    } finally {
      if (activeAbortControllerRef.current === requestController) {
        activeAbortControllerRef.current = null;
      }
      if (submissionIdRef.current === submissionId) {
        setIsPlanning(false);
        setPendingMode(null);
        setIsCancelling(false);
      }
    }
  };

  const handleStopRunning = () => {
    const controller = activeAbortControllerRef.current;
    if (!controller || controller.signal.aborted) return;

    controller.abort();
    setIsCancelling(true);
    setIsPlanning(false);
    setPendingMode(null);
    setError("Assistant request cancelled");
  };

  const handleRunStep = async (
    step: AssistantPlanStep,
    approved = false
  ) => {
    if (preparedMode !== "agent" || !preparedTurn || !step.toolName) return;
    if (
      activeAbortControllerRef.current &&
      !activeAbortControllerRef.current.signal.aborted
    ) {
      return;
    }
    if (
      step.requiresApproval &&
      (!approved || !approvedStepIds.has(step.id))
    ) {
      return;
    }

    if (step.requiresApproval) {
      setApprovedStepIds((current) => {
        const next = new Set(current);
        next.delete(step.id);
        return next;
      });
    }

    await runSafeSteps(
      preparedTurn,
      activeTurnInput ?? { message, selectedText, mode: assistantMode },
      [step],
      undefined,
      approved ? new Set([step.id]) : new Set()
    );
  };

  const handleApproveStep = (step: AssistantPlanStep) => {
    if (
      preparedMode !== "agent" ||
      !step.toolName ||
      !step.requiresApproval
    ) {
      return;
    }
    setApprovedStepIds((current) => new Set([...current, step.id]));
  };

  const handleRevokeStepApproval = (step: AssistantPlanStep) => {
    if (preparedMode !== "agent") return;
    setApprovedStepIds((current) => {
      const next = new Set(current);
      next.delete(step.id);
      return next;
    });
  };

  const runSafeSteps = async (
    turn: AssistantPreparedTurn,
    summaryInput: AssistantTurnInput,
    steps: AssistantPlanStep[],
    existingController?: AbortController,
    initialApprovedStepIds: ReadonlySet<string> = new Set()
  ) => {
    if (
      !existingController &&
      activeAbortControllerRef.current &&
      !activeAbortControllerRef.current.signal.aborted
    ) {
      return;
    }
    const controller = existingController ?? new AbortController();
    const executionContext = {
      ...turn.context,
      abortSignal: controller.signal,
      audit: recordAuditEntry,
    };
    activeAbortControllerRef.current = controller;
    setError(null);
    setIsCancelling(false);
    setIsRunningSafeSteps(true);
    const appendPlanUpdates = (
      nextSteps: AssistantPlanStep[],
      warnings: string[]
    ) => {
      if (nextSteps.length === 0 && warnings.length === 0) return;
      setPreparedTurn((current) => {
        if (!current || current.requestId !== turn.requestId) return current;
        const currentIds = new Set(current.suggestedPlan.map((step) => step.id));
        return {
          ...current,
          suggestedPlan: [
            ...current.suggestedPlan,
            ...nextSteps.filter((step) => !currentIds.has(step.id)),
          ],
          warnings: Array.from(new Set([...current.warnings, ...warnings])),
        };
      });
    };

    const handleLoopEvent = (event: AssistantToolLoopEvent) => {
      if (event.type === "stepStarted") {
        setActiveStepId(event.step.id);
        return;
      }
      if (event.type === "stepCompleted") {
        const nextResults = {
          ...toolResultsRef.current,
          [event.step.id]: event.result,
        };
        toolResultsRef.current = nextResults;
        setToolResults(nextResults);
        if (event.result.status !== "success") {
          setError(event.result.error || "Tool execution did not complete");
        }
        return;
      }
      if (event.type === "roundSummarized") {
        const lastResult = event.roundResults[event.roundResults.length - 1];
        if (lastResult) {
          setToolSummaries((state) => ({
            ...state,
            [lastResult.id]: event.summary,
          }));
        }
        appendAssistantMessage(
          event.summary.message,
          turn.requestId,
          "normal",
          createAssistantAttachments(event.roundResults, executionContext)
        );
        return;
      }
      if (event.type === "planExtended") {
        appendPlanUpdates(event.steps, event.warnings);
        return;
      }
      appendPlanUpdates([], [event.warning]);
      appendAssistantMessage(event.warning, turn.requestId);
    };

    try {
      const result = await runtime.runToolLoop({
        turn,
        summaryInput,
        steps,
        context: executionContext,
        existingResults: toolResultsRef.current,
        approvedStepIds: initialApprovedStepIds,
        onEvent: handleLoopEvent,
      });
      if (result.status === "cancelled") {
        setError("Assistant run cancelled");
      } else if (result.status === "failed") {
        setError(result.error || "Tool execution did not complete");
      }
    } catch (err: any) {
      setError(
        controller.signal.aborted
          ? "Assistant run cancelled"
          : err?.message || String(err)
      );
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
      setActiveStepId(null);
      setIsCancelling(false);
      setIsRunningSafeSteps(false);
    }
  };

  const handleRunSafeSteps = async () => {
    if (
      preparedMode !== "agent" ||
      !preparedTurn ||
      safeSteps.length === 0
    ) {
      return;
    }
    await runSafeSteps(
      preparedTurn,
      activeTurnInput ?? { message, selectedText, mode: assistantMode },
      safeSteps
    );
  };

  const handleNewChat = () => {
    if (isRunning || isPlanning) return;
    setMessage("");
    setActiveTurnInput(null);
    setConversationEntries([]);
    setPreparedTurn(null);
    setPreparedMode(null);
    setApprovedStepIds(new Set());
    setActiveStepId(null);
    toolResultsRef.current = {};
    setToolResults({});
    setToolSummaries({});
    setPendingMode(null);
    setIsCancelling(false);
    setError(null);
  };

  const handleModeChange = (mode: AssistantMode) => {
    if (mode === assistantMode || isPlanning || isRunning) return;
    setApprovedStepIds(new Set());
    if (preparedMode === "agent") {
      setPreparedMode(null);
    }
    updateAiSettings({ assistantMode: mode });
  };

  const handleExecuteAttachment = async (request: UiActionRequest) => {
    const result = await uiActionRegistry.execute(request);
    if (result.status !== "success") {
      setError(result.message || result.code);
    } else {
      setError(null);
    }
    return result;
  };

  return (
    <div className="flex h-full flex-col wb-panel">
      <AssistantHeader
        providerLabel={providerLabel}
        isConfigured={Boolean(modelConfig)}
        isRunning={isRunning || isPlanning}
        onNewChat={handleNewChat}
      />

      <div
        ref={scrollContainerRef}
        className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-[hsl(var(--wb-editor))]"
      >
        <AssistantConversation
          entries={conversationEntries}
          isResponding={isPlanning}
          pendingLabel={pendingLabel}
          onUsePrompt={setMessage}
          onExecuteAttachment={handleExecuteAttachment}
        />

        {preparedTurn && (
          <AssistantPlanView
            preparedTurn={preparedTurn}
            executionEnabled={preparedMode === "agent"}
            runnableStepCount={runnableSteps.length}
            safeStepCount={safeSteps.length}
            activeStepId={activeStepId}
            isRunning={isRunning}
            toolResults={toolResults}
            toolSummaries={toolSummaries}
            approvedStepIds={approvedStepIds}
            canRunSafe={
              preparedMode === "agent" &&
              safeSteps.length > 0 &&
              !isPlanning &&
              !isRunning
            }
            onRunSafe={handleRunSafeSteps}
            onApproveStep={handleApproveStep}
            onRevokeStepApproval={handleRevokeStepApproval}
            onRunStep={handleRunStep}
          />
        )}

        <AssistantActivity
          entries={auditEntries}
          onClear={clearAuditEntries}
        />

        {error && (
          <div className="mx-3 mb-3 rounded-[4px] bg-destructive/10 px-2 py-1.5 text-[10px] leading-4 text-destructive">
            {error}
          </div>
        )}
      </div>

      <AssistantPromptBox
        message={message}
        onMessageChange={setMessage}
        onSubmit={handleSubmit}
        onStop={handleStopRunning}
        mode={assistantMode}
        onModeChange={handleModeChange}
        activeContextLabel={activeContextLabel}
        hasSelection={Boolean(selectedText)}
        isSubmitting={isPlanning}
        isToolRunning={isRunning}
        isCancelling={isCancelling}
      />
    </div>
  );
}

function createConversationEntryId() {
  return `assistant-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function planResponseMessage(
  turn: AssistantPreparedTurn,
  mode: ResolvedAssistantMode
) {
  const executableSteps = turn.suggestedPlan.filter((step) => step.toolName);
  const userFacingNotes = turn.notes.filter(
    (note) =>
      !note.startsWith("Planner node completed with ") &&
      !note.startsWith("Planner node fell back to ") &&
      !note.startsWith("Use this planner as the local fallback")
  );
  let statusMessage: string;
  if (executableSteps.length === 0) {
    statusMessage =
      "No executable database action was planned. Add a table, query, or schema target and try again.";
  } else {
    const approvalCount = executableSteps.filter(
      (step) => step.requiresApproval
    ).length;
    const safeCount = executableSteps.length - approvalCount;
    if (mode === "plan") {
      statusMessage = `Plan ready with ${executableSteps.length} step${
        executableSteps.length === 1 ? "" : "s"
      }. Nothing has run.`;
    } else if (safeCount > 0) {
      statusMessage = `Prepared ${executableSteps.length} step${
        executableSteps.length === 1 ? "" : "s"
      }. Running ${safeCount} read-only step${safeCount === 1 ? "" : "s"}.`;
    } else {
      const approvalNote =
        approvalCount > 0
          ? ` ${approvalCount} step${
              approvalCount === 1 ? "" : "s"
            } require explicit approval.`
          : " All planned steps are read-only.";
      statusMessage = `Prepared ${executableSteps.length} database step${
        executableSteps.length === 1 ? "" : "s"
      }.${approvalNote}`;
    }
  }

  return [statusMessage, ...userFacingNotes].join("\n");
}
