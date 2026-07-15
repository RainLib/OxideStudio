import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantToolCallResult,
  AssistantToolResultSummary,
} from "@/ai/assistant/types";
import type { AiToolPermission, AiToolSummary } from "@/ai/tools/types";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

interface AssistantPlanViewProps {
  preparedTurn: AssistantPreparedTurn | null;
  contextStaleMessage: string | null;
  executionEnabled: boolean;
  safeStepCount: number;
  activeStepId: string | null;
  isRunning: boolean;
  toolResults: Record<string, AssistantToolCallResult>;
  toolSummaries: Record<string, AssistantToolResultSummary>;
  approvedStepIds: Set<string>;
  canRunSafe: boolean;
  onRunSafe: () => void;
  onApproveStep: (step: AssistantPlanStep) => void;
  onRevokeStepApproval: (step: AssistantPlanStep) => void;
  onRunStep: (step: AssistantPlanStep, approved?: boolean) => void;
}

export function AssistantPlanView({
  preparedTurn,
  contextStaleMessage,
  executionEnabled,
  safeStepCount,
  activeStepId,
  isRunning,
  toolResults,
  toolSummaries,
  approvedStepIds,
  canRunSafe,
  onRunSafe,
  onApproveStep,
  onRevokeStepApproval,
  onRunStep,
}: AssistantPlanViewProps) {
  if (!preparedTurn) return null;
  const executableSteps = preparedTurn.suggestedPlan.filter(
    (step) => step.toolName,
  );
  const completedSteps = executableSteps.filter(
    (step) => toolResults[step.id]?.status === "success",
  ).length;
  const failedSteps = executableSteps.filter(
    (step) =>
      toolResults[step.id] && toolResults[step.id]?.status !== "success",
  ).length;
  const approvalSteps = executableSteps.filter(
    (step) => step.requiresApproval && !toolResults[step.id],
  ).length;
  const stageLabel = processStageLabel({
    contextStale: Boolean(contextStaleMessage),
    executionEnabled,
    isRunning,
    totalSteps: executableSteps.length,
    completedSteps,
    failedSteps,
    approvalSteps,
  });

  return (
    <details
      className="group mx-3 mb-2 border-y border-[hsl(var(--wb-border-subtle))]"
      aria-label="Assistant plan"
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-1.5 py-1 text-[10px] text-[hsl(var(--wb-text-muted))] marker:content-none hover:text-[hsl(var(--wb-text))] [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={11}
          className="shrink-0 transition-transform duration-150 group-open:rotate-90"
        />
        <ProcessStatusIcon
          isRunning={isRunning}
          failedSteps={failedSteps}
          completed={
            executableSteps.length > 0 &&
            completedSteps === executableSteps.length
          }
        />
        <span className="min-w-0 flex-1 truncate">{stageLabel}</span>
        {preparedTurn.warnings.length > 0 && (
          <span className="shrink-0 rounded-[3px] bg-amber-500/10 px-1 text-[9px] text-amber-400">
            {preparedTurn.warnings.length} warning
          </span>
        )}
      </summary>

      <div className="border-t border-[hsl(var(--wb-border-subtle))]">
        <div className="flex min-h-7 items-center gap-2 px-2 py-1">
          <span className="text-[9px] font-medium uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
            {preparedTurn.intent}
          </span>
          <span className="min-w-0 flex-1 truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
            {executableSteps.length} planned · {completedSteps} completed
          </span>
          {!executionEnabled && (
            <span className="text-[9px] text-[hsl(var(--wb-text-muted))]">
              Review only
            </span>
          )}
          {canRunSafe && (
            <button
              type="button"
              className="wb-text-button h-6 px-1.5 text-[10px]"
              onClick={onRunSafe}
              title="Run all read-only steps"
            >
              <Play size={10} />
              Run read-only{safeStepCount > 1 ? ` (${safeStepCount})` : ""}
            </button>
          )}
        </div>

        {contextStaleMessage && (
          <div className="border-t border-[hsl(var(--wb-border-subtle))] bg-amber-500/8 px-2 py-1.5 text-[10px] leading-4 text-amber-400">
            {contextStaleMessage}
          </div>
        )}

        {preparedTurn.warnings.length > 0 && (
          <div className="border-t border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-[10px] leading-4 text-amber-500">
            {preparedTurn.warnings.join(" ")}
          </div>
        )}

        <ol className="border-t border-[hsl(var(--wb-border-subtle))]">
          {preparedTurn.suggestedPlan.map((step, index) => (
            <AssistantPlanStepRow
              key={step.id}
              index={index}
              step={step}
              result={toolResults[step.id]}
              summary={toolSummaries[step.id]}
              tool={preparedTurn.availableTools.find(
                (candidate) => candidate.name === step.toolName,
              )}
              isApproved={approvedStepIds.has(step.id)}
              isActive={activeStepId === step.id}
              isRunning={isRunning}
              executionEnabled={executionEnabled}
              contextStale={Boolean(contextStaleMessage)}
              onApproveStep={onApproveStep}
              onRevokeStepApproval={onRevokeStepApproval}
              onRunStep={onRunStep}
            />
          ))}
        </ol>
      </div>
    </details>
  );
}

function ProcessStatusIcon({
  isRunning,
  failedSteps,
  completed,
}: {
  isRunning: boolean;
  failedSteps: number;
  completed: boolean;
}) {
  if (isRunning) {
    return (
      <Loader2
        size={11}
        className="shrink-0 animate-spin text-[hsl(var(--wb-accent))]"
      />
    );
  }
  if (failedSteps > 0) {
    return <CircleAlert size={11} className="shrink-0 text-amber-400" />;
  }
  if (completed) {
    return <CheckCircle2 size={11} className="shrink-0 text-emerald-500" />;
  }
  return <ShieldCheck size={11} className="shrink-0 wb-muted" />;
}

function processStageLabel({
  contextStale,
  executionEnabled,
  isRunning,
  totalSteps,
  completedSteps,
  failedSteps,
  approvalSteps,
}: {
  contextStale: boolean;
  executionEnabled: boolean;
  isRunning: boolean;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  approvalSteps: number;
}) {
  if (contextStale) return "Context changed · refresh required";
  if (!executionEnabled) {
    return `Plan ready · ${totalSteps} ${totalSteps === 1 ? "step" : "steps"}`;
  }
  if (isRunning) {
    return `Running tools · ${completedSteps} of ${totalSteps} completed`;
  }
  if (failedSteps > 0) {
    return `${failedSteps} ${failedSteps === 1 ? "step needs" : "steps need"} attention`;
  }
  if (approvalSteps > 0) {
    return `${approvalSteps} ${approvalSteps === 1 ? "step needs" : "steps need"} approval`;
  }
  if (totalSteps > 0 && completedSteps === totalSteps) {
    return `Ran ${totalSteps} ${totalSteps === 1 ? "tool step" : "tool steps"}`;
  }
  return totalSteps > 0
    ? `Prepared ${totalSteps} ${totalSteps === 1 ? "tool step" : "tool steps"}`
    : "No executable tool step";
}

function AssistantPlanStepRow({
  index,
  step,
  result,
  summary,
  tool,
  isApproved,
  isActive,
  isRunning,
  executionEnabled,
  contextStale,
  onApproveStep,
  onRevokeStepApproval,
  onRunStep,
}: {
  index: number;
  step: AssistantPlanStep;
  result?: AssistantToolCallResult;
  summary?: AssistantToolResultSummary;
  tool?: AiToolSummary;
  isApproved: boolean;
  isActive: boolean;
  isRunning: boolean;
  executionEnabled: boolean;
  contextStale: boolean;
  onApproveStep: (step: AssistantPlanStep) => void;
  onRevokeStepApproval: (step: AssistantPlanStep) => void;
  onRunStep: (step: AssistantPlanStep, approved?: boolean) => void;
}) {
  const canRun = Boolean(step.toolName) && (!step.requiresApproval || isApproved);

  return (
    <li className="border-b border-[hsl(var(--wb-border-subtle))] px-1.5 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <StepStatus index={index} isActive={isActive} result={result} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-4 text-[hsl(var(--wb-text))]">
            {step.title}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {step.toolName && (
              <span className="truncate font-mono text-[9px] text-[hsl(var(--wb-text-muted))]">
                {step.toolName}
              </span>
            )}
            {tool?.permissions.map((permission) => (
              <PermissionLabel key={permission} permission={permission} />
            ))}
          </div>
        </div>

        {executionEnabled && step.toolName && !step.requiresApproval && !result && (
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={() => onRunStep(step, false)}
            disabled={isRunning || contextStale}
            title="Run step"
            aria-label={`Run ${step.title}`}
          >
            <Play size={11} />
          </button>
        )}
      </div>

      {step.input && Object.keys(step.input).length > 0 && (
        <details className="mt-1.5 ml-6 text-[9px] text-[hsl(var(--wb-text-muted))]">
          <summary className="cursor-pointer select-none hover:text-[hsl(var(--wb-text))]">
            Review planned input
          </summary>
          <pre className="custom-scrollbar mt-1 max-h-40 overflow-auto bg-[hsl(var(--wb-panel))] p-2 leading-4 text-[hsl(var(--wb-text))]">
            {JSON.stringify(step.input, null, 2)}
          </pre>
        </details>
      )}

      {executionEnabled && step.requiresApproval && (
        <div className="mt-2 ml-6 flex items-start gap-2 bg-amber-500/8 px-2 py-1.5">
          <ShieldAlert size={12} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
              This action can change data or affect an external system and needs explicit approval.
            </div>
            <div className="mt-1.5 flex flex-wrap justify-end gap-1">
              {isApproved ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 rounded-[4px] px-2 text-[10px]"
                    disabled={isRunning || contextStale}
                    onClick={() => onRevokeStepApproval(step)}
                  >
                    <RotateCcw size={10} className="mr-1" />
                    Revoke
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 rounded-[4px] px-2 text-[10px]"
                    disabled={isRunning || contextStale || !canRun}
                    onClick={() => onRunStep(step, true)}
                  >
                    <Play size={10} className="mr-1" />
                    Run approved
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 rounded-[4px] px-2 text-[10px] text-amber-500"
                  disabled={isRunning || contextStale}
                  onClick={() => onApproveStep(step)}
                >
                  <ShieldCheck size={10} className="mr-1" />
                  Approve
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-1.5 ml-6 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {summary.message}
        </div>
      )}

      {result !== undefined && (
        <details className="mt-1.5 ml-6 text-[9px] text-[hsl(var(--wb-text-muted))]">
          <summary className="cursor-pointer select-none hover:text-[hsl(var(--wb-text))]">
            Result details
          </summary>
          <pre className="custom-scrollbar mt-1 max-h-40 overflow-auto bg-[hsl(var(--wb-panel))] p-2 leading-4">
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

function StepStatus({
  index,
  isActive,
  result,
}: {
  index: number;
  isActive: boolean;
  result?: AssistantToolCallResult;
}) {
  const className = "mt-0.5 h-4 w-4 shrink-0";
  if (isActive) {
    return (
      <Loader2
        size={13}
        className={cn(className, "animate-spin text-[hsl(var(--wb-accent))]")}
      />
    );
  }
  if (result?.status === "success") {
    return <Check size={13} className={cn(className, "text-emerald-500")} />;
  }
  if (result) {
    return (
      <CircleAlert
        size={13}
        className={cn(className, "text-[hsl(var(--destructive))]")}
      />
    );
  }
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--wb-active))] text-[9px] tabular-nums text-[hsl(var(--wb-text-muted))]">
      {index + 1}
    </span>
  );
}

function PermissionLabel({ permission }: { permission: AiToolPermission }) {
  return (
    <span
      className={cn(
        "text-[9px]",
        permission === "read" && "text-emerald-500",
        permission === "write" && "text-amber-500",
        permission === "destructive" && "text-red-500",
        permission === "external" && "text-sky-500"
      )}
    >
      {permission}
    </span>
  );
}
