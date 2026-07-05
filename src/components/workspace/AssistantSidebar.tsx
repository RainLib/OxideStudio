import { Button } from "@/components/ui/button";
import { createAssistantRuntime } from "@/ai";
import { useTabStore } from "@/store/useTabStore";
import type {
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantToolCallResult,
  AssistantToolResultSummary,
} from "@/ai";
import { cn } from "@/lib/utils";
import { ListChecks, Play, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

export function AssistantSidebar() {
  const runtime = useMemo(() => createAssistantRuntime(), []);
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
  const [isPlanning, setIsPlanning] = useState(false);
  const [isRunningSafeSteps, setIsRunningSafeSteps] = useState(false);
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

  const handlePrepare = async () => {
    setError(null);
    setToolResults({});
    setToolSummaries({});
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
    approved = false
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
      turn.context
    );
    if (!result) return null;

    setToolResults((state) => ({ ...state, [step.id]: result }));
    const summary = await runtime.summarizeToolResults(
      { message, selectedText },
      [result],
      turn.context
    );
    setToolSummaries((state) => ({ ...state, [step.id]: summary }));
    if (result.status !== "success") {
      setError(result.error || "Tool execution did not complete");
    }
    return result;
  };

  const handleRunStep = async (
    step: AssistantPlanStep,
    approved = false
  ) => {
    if (!preparedTurn || !step.toolName) return;
    if (step.requiresApproval && !approved) return;

    setError(null);
    setActiveStepId(step.id);
    try {
      await executeStep(preparedTurn, step, approved);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setActiveStepId(null);
    }
  };

  const handleRunSafeSteps = async () => {
    if (!preparedTurn || safeSteps.length === 0) return;

    setError(null);
    setIsRunningSafeSteps(true);
    try {
      for (const step of safeSteps) {
        setActiveStepId(step.id);
        const result = await executeStep(preparedTurn, step, false);
        if (result && result.status !== "success") break;
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setActiveStepId(null);
      setIsRunningSafeSteps(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background-tertiary">
      <div className="border-b border-border bg-background-secondary/50 px-3 py-2">
        <div className="flex items-start gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Assistant
            </div>
            <div className="truncate text-[10px] text-muted-foreground/70">
              {activeContextLabel}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-border bg-background-secondary/30 p-2">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask about this workspace"
          className="min-h-24 w-full resize-none rounded-sm border border-border bg-background-tertiary px-2 py-2 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary"
        />
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            className="h-7 flex-1 rounded-sm text-[11px]"
            onClick={handlePrepare}
            disabled={!message.trim() || isPlanning || isRunning}
          >
            {isPlanning ? "Planning" : "Plan"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-sm px-2 text-[11px]"
            onClick={handleRunSafeSteps}
            disabled={
              !preparedTurn || safeSteps.length === 0 || isPlanning || isRunning
            }
            title="Run read-only steps"
          >
            <ListChecks size={12} className="mr-1" />
            {isRunningSafeSteps ? "Running" : "Run Safe"}
          </Button>
        </div>
      </div>

      <div className="custom-scrollbar flex-1 overflow-auto p-2">
        {preparedTurn && (
          <div className="space-y-2">
            <div className="rounded-sm border border-border bg-background-secondary/40 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {preparedTurn.intent}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {preparedTurn.availableTools.length} tools / {preparedTurn.planner.mode}
                </span>
              </div>
              {preparedTurn.warnings.length > 0 && (
                <div className="mt-1 space-y-1">
                  {preparedTurn.warnings.map((warning) => (
                    <div key={warning} className="text-[10px] text-amber-500">
                      {warning}
                    </div>
                  ))}
                </div>
              )}
              {runnableSteps.length === 0 && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  No executable tool step was planned.
                </div>
              )}
            </div>

            {preparedTurn.suggestedPlan.map((step) => {
              const result = toolResults[step.id];
              const summary = toolSummaries[step.id];
              return (
                <div
                  key={step.id}
                  className="rounded-sm border border-border bg-background-secondary/30 p-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-foreground">
                        {step.title}
                      </div>
                      {step.toolName && (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {step.toolName}
                        </div>
                      )}
                    </div>
                    {step.toolName && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-6 w-6 rounded-sm text-muted-foreground hover:text-primary",
                          step.requiresApproval && "text-amber-500 hover:text-amber-400",
                          activeStepId === step.id && "animate-pulse"
                        )}
                        onClick={() => handleRunStep(step, step.requiresApproval)}
                        disabled={isRunning}
                        title={step.requiresApproval ? "Approve and run" : "Run"}
                      >
                        {step.requiresApproval ? (
                          <ShieldCheck size={12} />
                        ) : (
                          <Play size={12} />
                        )}
                      </Button>
                    )}
                  </div>

                  {step.requiresApproval && (
                    <div className="mt-1 text-[10px] text-amber-500">
                      Approval required
                    </div>
                  )}

                  {result !== undefined && (
                    <div className="mt-2 space-y-1.5">
                      {summary && (
                        <div className="rounded-sm border border-border/60 bg-background-tertiary px-2 py-1.5 text-[10px] text-muted-foreground">
                          {summary.message}
                          {summary.warnings?.map((warning) => (
                            <div key={warning} className="mt-1 text-amber-500">
                              {warning}
                            </div>
                          ))}
                        </div>
                      )}
                      <pre className="max-h-44 overflow-auto rounded-sm bg-background-tertiary p-2 text-[10px] text-muted-foreground">
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!preparedTurn && (
          <div className="p-4 text-center text-xs italic text-gray-500">
            No plan
          </div>
        )}

        {error && (
          <div className="mt-2 rounded-sm border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
