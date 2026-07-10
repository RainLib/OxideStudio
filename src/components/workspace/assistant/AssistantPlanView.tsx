import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantToolCallResult,
  AssistantToolResultSummary,
} from "@/ai/assistant/types";
import { Bot, FileSearch, Play, ShieldCheck, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";

interface AssistantPlanViewProps {
  preparedTurn: AssistantPreparedTurn | null;
  runnableStepCount: number;
  activeStepId: string | null;
  isRunning: boolean;
  turnSummary: AssistantToolResultSummary | null;
  toolResults: Record<string, AssistantToolCallResult>;
  toolSummaries: Record<string, AssistantToolResultSummary>;
  onRunStep: (step: AssistantPlanStep, approved?: boolean) => void;
}

export function AssistantPlanView({
  preparedTurn,
  runnableStepCount,
  activeStepId,
  isRunning,
  turnSummary,
  toolResults,
  toolSummaries,
  onRunStep,
}: AssistantPlanViewProps) {
  if (!preparedTurn) {
    return (
      <div className="flex h-full flex-col justify-center px-4 text-[11px] text-[hsl(var(--wb-text-muted))]">
        <div className="mx-auto w-full max-w-[280px] space-y-3">
          <div className="flex items-center gap-2 text-[hsl(var(--wb-text))]">
            <Bot size={15} className="text-[hsl(var(--wb-accent))]" />
            <span className="font-semibold">Plan database work</span>
          </div>
          <div className="space-y-1.5">
            <EmptyHint icon={<FileSearch size={12} />} text="Inspect the active table or selection" />
            <EmptyHint icon={<TerminalSquare size={12} />} text="Explain SQL before running it" />
            <EmptyHint icon={<ShieldCheck size={12} />} text="Prepare mutations behind approval gates" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <AssistantPlanHeader
        preparedTurn={preparedTurn}
        runnableStepCount={runnableStepCount}
      />

      {turnSummary && <AssistantSummary summary={turnSummary} />}

      {preparedTurn.suggestedPlan.map((step) => (
        <AssistantPlanStepCard
          key={step.id}
          step={step}
          result={toolResults[step.id]}
          summary={toolSummaries[step.id]}
          isActive={activeStepId === step.id}
          isRunning={isRunning}
          onRunStep={onRunStep}
        />
      ))}
    </div>
  );
}

function AssistantPlanHeader({
  preparedTurn,
  runnableStepCount,
}: {
  preparedTurn: AssistantPreparedTurn;
  runnableStepCount: number;
}) {
  return (
    <div className="border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
          {preparedTurn.intent}
        </span>
        <span className="text-[10px] text-[hsl(var(--wb-text-muted))]">
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
      {runnableStepCount === 0 && (
        <div className="mt-1 text-[10px] text-[hsl(var(--wb-text-muted))]">
          No executable tool step was planned.
        </div>
      )}
    </div>
  );
}

function AssistantSummary({
  summary,
}: {
  summary: AssistantToolResultSummary;
}) {
  return (
    <div className="border border-[hsl(var(--wb-accent)/0.35)] bg-[hsl(var(--wb-accent)/0.08)] px-2 py-1.5 text-[11px] text-[hsl(var(--wb-text))]">
      {summary.message}
      {summary.warnings?.map((warning) => (
        <div key={warning} className="mt-1 text-[10px] text-amber-500">
          {warning}
        </div>
      ))}
    </div>
  );
}

function AssistantPlanStepCard({
  step,
  result,
  summary,
  isActive,
  isRunning,
  onRunStep,
}: {
  step: AssistantPlanStep;
  result?: AssistantToolCallResult;
  summary?: AssistantToolResultSummary;
  isActive: boolean;
  isRunning: boolean;
  onRunStep: (step: AssistantPlanStep, approved?: boolean) => void;
}) {
  return (
    <div className="border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-[hsl(var(--wb-text))]">
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
              isActive && "animate-pulse"
            )}
            onClick={() => onRunStep(step, step.requiresApproval)}
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
          {summary && <AssistantSummary summary={summary} />}
          <pre className="custom-scrollbar max-h-44 overflow-auto border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function EmptyHint({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 py-1.5">
      <span className="text-[hsl(var(--wb-text-muted))]">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
