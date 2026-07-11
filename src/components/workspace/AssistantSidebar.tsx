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
  AssistantToolCallResult,
  AssistantToolResultSummary,
  AssistantTurnInput,
} from "@/ai/assistant/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantHeader } from "./assistant/AssistantHeader";
import { AssistantActivity } from "./assistant/AssistantActivity";
import {
  AssistantConversation,
  type AssistantConversationEntry,
} from "./assistant/AssistantConversation";
import { AssistantPlanView } from "./assistant/AssistantPlanView";
import { AssistantPromptBox } from "./assistant/AssistantPromptBox";

export function AssistantSidebar() {
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);
  const aiModel = useAiSettingsStore((state) => state.model);
  const aiApiKey = useAiSettingsStore((state) => state.apiKey);
  const aiTimeoutMs = useAiSettingsStore((state) => state.timeoutMs);
  const aiPlannerKind = useAiSettingsStore((state) => state.plannerKind);
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
        plannerKind: aiPlannerKind,
        modelConfig,
      }),
    [aiEnabled, aiPlannerKind, modelConfig]
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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [turnSummary, setTurnSummary] =
    useState<AssistantToolResultSummary | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isRunningSafeSteps, setIsRunningSafeSteps] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeSteps =
    preparedTurn?.suggestedPlan.filter(
      (step) => step.toolName && !step.requiresApproval
    ) ?? [];
  const runnableSteps =
    preparedTurn?.suggestedPlan.filter((step) => step.toolName) ?? [];
  const isRunning = activeStepId !== null || isRunningSafeSteps;
  const activeContextLabel = activeTab
    ? `${activeTab.title}${selectedText ? " - selection" : ""}`
    : "No active tab";
  const plannerLabel = plannerSelection.label;

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
    status: AssistantConversationEntry["status"] = "normal"
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
      },
    ]);
  };

  const handlePrepare = async () => {
    const prompt = message.trim();
    if (!prompt) return;
    const turnInput: AssistantTurnInput = {
      message: prompt,
      selectedText,
      history: conversationEntries.map(({ role, content }) => ({
        role,
        content,
      })),
    };

    setError(null);
    setPreparedTurn(null);
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
    setTurnSummary(null);
    setIsPlanning(true);
    try {
      const turn = await runtime.prepareTurnAsync(turnInput);
      setPreparedTurn(turn);
      appendAssistantMessage(planResponseMessage(turn), turn.requestId);
    } catch (err: any) {
      const nextError = err?.message || String(err);
      setError(nextError);
      appendAssistantMessage(`Planning failed: ${nextError}`, undefined, "error");
    } finally {
      setIsPlanning(false);
    }
  };

  const executeStep = async (
    turn: AssistantPreparedTurn,
    step: AssistantPlanStep,
    approved = false,
    summarizeStep = true,
    executionContext = turn.context
  ) => {
    if (!step.toolName) return null;

    const [result] = await runtime.executeToolCalls(
      [
        {
          id: step.id,
          toolName: step.toolName,
          input: step.input || {},
          approved,
        },
      ],
      executionContext
    );
    if (!result) return null;

    const nextResults = { ...toolResultsRef.current, [step.id]: result };
    toolResultsRef.current = nextResults;
    setToolResults(nextResults);

    if (summarizeStep && !executionContext.abortSignal?.aborted) {
      const summary = await runtime.summarizeToolResults(
        activeTurnInput ?? { message, selectedText },
        [result],
        executionContext
      );
      setToolSummaries((state) => ({ ...state, [step.id]: summary }));
      setTurnSummary(summary);
      appendAssistantMessage(summary.message, turn.requestId);
    }
    if (result.status !== "success") {
      setError(result.error || "Tool execution did not complete");
    }
    return result;
  };

  const handleStopRunning = () => {
    const controller = activeAbortControllerRef.current;
    if (!controller || controller.signal.aborted) return;

    controller.abort();
    setIsCancelling(true);
    setError("Stopping assistant tool execution...");
  };

  const handleRunStep = async (
    step: AssistantPlanStep,
    approved = false
  ) => {
    if (!preparedTurn || !step.toolName) return;
    if (step.requiresApproval && !approved) return;

    const controller = new AbortController();
    const executionContext = {
      ...preparedTurn.context,
      abortSignal: controller.signal,
      audit: recordAuditEntry,
    };
    activeAbortControllerRef.current = controller;
    setError(null);
    setIsCancelling(false);
    setActiveStepId(step.id);
    try {
      await executeStep(preparedTurn, step, approved, true, executionContext);
      if (controller.signal.aborted) {
        setError("Assistant run cancelled");
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
    }
  };

  const handleApproveStep = (step: AssistantPlanStep) => {
    if (!step.toolName || !step.requiresApproval) return;
    setApprovedStepIds((current) => new Set([...current, step.id]));
  };

  const handleRevokeStepApproval = (step: AssistantPlanStep) => {
    setApprovedStepIds((current) => {
      const next = new Set(current);
      next.delete(step.id);
      return next;
    });
  };

  const handleRunSafeSteps = async () => {
    if (!preparedTurn || safeSteps.length === 0) return;

    const controller = new AbortController();
    const executionContext = {
      ...preparedTurn.context,
      abortSignal: controller.signal,
      audit: recordAuditEntry,
    };
    activeAbortControllerRef.current = controller;
    setError(null);
    setIsCancelling(false);
    setIsRunningSafeSteps(true);
    const completedResults: AssistantToolCallResult[] = [];
    try {
      for (const step of safeSteps) {
        if (controller.signal.aborted) break;
        setActiveStepId(step.id);
        const result = await executeStep(
          preparedTurn,
          step,
          false,
          false,
          executionContext
        );
        if (result) completedResults.push(result);
        if (
          controller.signal.aborted ||
          (result && result.status !== "success")
        ) {
          break;
        }
      }
      if (completedResults.length > 0 && !controller.signal.aborted) {
        const summary = await runtime.summarizeToolResults(
          activeTurnInput ?? { message, selectedText },
          completedResults,
          executionContext
        );
        setTurnSummary(summary);
        appendAssistantMessage(summary.message, preparedTurn.requestId);
      }
      if (controller.signal.aborted) {
        setError("Assistant run cancelled");
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

  const handleNewChat = () => {
    if (isRunning) return;
    setMessage("");
    setActiveTurnInput(null);
    setConversationEntries([]);
    setPreparedTurn(null);
    setApprovedStepIds(new Set());
    setActiveStepId(null);
    toolResultsRef.current = {};
    setToolResults({});
    setToolSummaries({});
    setTurnSummary(null);
    setError(null);
  };

  return (
    <div className="flex h-full flex-col wb-panel">
      <AssistantHeader
        activeContextLabel={activeContextLabel}
        plannerLabel={plannerLabel}
        plannerDetail={plannerSelection.detail}
        isConfigured={plannerSelection.configured}
        isRunning={isRunning}
        onNewChat={handleNewChat}
      />

      <div
        ref={scrollContainerRef}
        className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-[hsl(var(--wb-editor))]"
      >
        <AssistantConversation
          entries={conversationEntries}
          isPlanning={isPlanning}
        />

        {(preparedTurn || conversationEntries.length === 0) && (
          <AssistantPlanView
            preparedTurn={preparedTurn}
            runnableStepCount={runnableSteps.length}
            activeStepId={activeStepId}
            isRunning={isRunning}
            turnSummary={turnSummary}
            toolResults={toolResults}
            toolSummaries={toolSummaries}
            approvedStepIds={approvedStepIds}
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
          <div className="mx-2 mb-2 border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
            {error}
          </div>
        )}
      </div>

      <AssistantPromptBox
        message={message}
        onMessageChange={setMessage}
        onPlan={handlePrepare}
        onRunSafe={handleRunSafeSteps}
        onStop={handleStopRunning}
        activeContextLabel={activeContextLabel}
        plannerLabel={plannerLabel}
        hasSelection={Boolean(selectedText)}
        safeStepCount={safeSteps.length}
        isPlanning={isPlanning}
        isRunning={isRunning}
        isCancelling={isCancelling}
        canRunSafe={
          Boolean(preparedTurn) &&
          safeSteps.length > 0 &&
          !isPlanning &&
          !isRunning
        }
      />
    </div>
  );
}

function createConversationEntryId() {
  return `assistant-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function planResponseMessage(turn: AssistantPreparedTurn) {
  if (turn.notes.length > 0) return turn.notes.join("\n");

  const executableSteps = turn.suggestedPlan.filter((step) => step.toolName);
  if (executableSteps.length === 0) {
    return "No executable database action was planned. Add a table, query, or schema target and try again.";
  }

  const approvalCount = executableSteps.filter(
    (step) => step.requiresApproval
  ).length;
  const approvalNote =
    approvalCount > 0
      ? ` ${approvalCount} step${approvalCount === 1 ? "" : "s"} require explicit approval.`
      : " All planned steps are read-only.";
  return `Prepared ${executableSteps.length} database step${
    executableSteps.length === 1 ? "" : "s"
  }.${approvalNote}`;
}
