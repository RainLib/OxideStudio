import { createAssistantPlannerSelection } from "@/ai/assistant/plannerRegistry";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import {
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools/defaultRegistry";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import type {
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantToolCallResult,
  AssistantToolResultSummary,
} from "@/ai/assistant/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantHeader } from "./assistant/AssistantHeader";
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
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const selectedText = activeTab?.editorSelection?.text || null;
  const [message, setMessage] = useState("");
  const [preparedTurn, setPreparedTurn] = useState<AssistantPreparedTurn | null>(
    null
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

  const handlePrepare = async () => {
    setError(null);
    toolResultsRef.current = {};
    setToolResults({});
    setToolSummaries({});
    setTurnSummary(null);
    setIsPlanning(true);
    try {
      setPreparedTurn(await runtime.prepareTurnAsync({ message, selectedText }));
    } catch (err: any) {
      setError(err?.message || String(err));
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
        { message, selectedText },
        [result],
        executionContext
      );
      setToolSummaries((state) => ({ ...state, [step.id]: summary }));
      setTurnSummary(summary);
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

  const handleRunSafeSteps = async () => {
    if (!preparedTurn || safeSteps.length === 0) return;

    const controller = new AbortController();
    const executionContext = {
      ...preparedTurn.context,
      abortSignal: controller.signal,
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
        setTurnSummary(
          await runtime.summarizeToolResults(
            { message, selectedText },
            completedResults,
            executionContext
          )
        );
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

  return (
    <div className="flex h-full flex-col wb-panel">
      <AssistantHeader
        activeContextLabel={activeContextLabel}
        plannerLabel={plannerLabel}
        plannerDetail={plannerSelection.detail}
        isConfigured={plannerSelection.configured}
        isRunning={isRunning}
      />

      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-[hsl(var(--wb-editor))]">
        <AssistantPlanView
          preparedTurn={preparedTurn}
          runnableStepCount={runnableSteps.length}
          activeStepId={activeStepId}
          isRunning={isRunning}
          turnSummary={turnSummary}
          toolResults={toolResults}
          toolSummaries={toolSummaries}
          onRunStep={handleRunStep}
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
