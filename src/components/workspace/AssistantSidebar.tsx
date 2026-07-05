import { Button } from "@/components/ui/button";
import { createAssistantRuntime } from "@/ai";
import type {
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantToolCallResult,
} from "@/ai";
import { cn } from "@/lib/utils";
import { Play, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

export function AssistantSidebar() {
  const runtime = useMemo(() => createAssistantRuntime(), []);
  const [message, setMessage] = useState("");
  const [preparedTurn, setPreparedTurn] = useState<AssistantPreparedTurn | null>(
    null
  );
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [toolResults, setToolResults] = useState<
    Record<string, AssistantToolCallResult>
  >({});
  const [error, setError] = useState<string | null>(null);

  const handlePrepare = () => {
    setError(null);
    setToolResults({});
    setPreparedTurn(runtime.prepareTurn({ message }));
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
      const [result] = await runtime.executeToolCalls(
        [
          {
            id: step.id,
            toolName: step.toolName,
            input: step.input || {},
            approved,
          },
        ],
        preparedTurn.context
      );
      if (!result) return;
      setToolResults((state) => ({ ...state, [step.id]: result }));
      if (result.status === "error") {
        setError(result.error || "Tool execution failed");
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setActiveStepId(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background-tertiary">
      <div className="border-b border-border bg-background-secondary/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Assistant
          </span>
        </div>
      </div>

      <div className="shrink-0 border-b border-border bg-background-secondary/30 p-2">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask about this workspace"
          className="min-h-24 w-full resize-none rounded-sm border border-border bg-background-tertiary px-2 py-2 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary"
        />
        <Button
          size="sm"
          className="mt-2 h-7 w-full rounded-sm text-[11px]"
          onClick={handlePrepare}
          disabled={!message.trim()}
        >
          Plan
        </Button>
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
                  {preparedTurn.availableTools.length} tools
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
            </div>

            {preparedTurn.suggestedPlan.map((step) => {
              const result = toolResults[step.id];
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
                        disabled={activeStepId !== null}
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
                    <pre className="mt-2 max-h-44 overflow-auto rounded-sm bg-background-tertiary p-2 text-[10px] text-muted-foreground">
                      {JSON.stringify(result, null, 2)}
                    </pre>
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
