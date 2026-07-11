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
  Bot,
  FileSearch,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";

interface AssistantPlanViewProps {
  preparedTurn: AssistantPreparedTurn | null;
  runnableStepCount: number;
  activeStepId: string | null;
  isRunning: boolean;
  turnSummary: AssistantToolResultSummary | null;
  toolResults: Record<string, AssistantToolCallResult>;
  toolSummaries: Record<string, AssistantToolResultSummary>;
  approvedStepIds: Set<string>;
  onApproveStep: (step: AssistantPlanStep) => void;
  onRevokeStepApproval: (step: AssistantPlanStep) => void;
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
  approvedStepIds,
  onApproveStep,
  onRevokeStepApproval,
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
          tool={preparedTurn.availableTools.find(
            (candidate) => candidate.name === step.toolName
          )}
          isApproved={approvedStepIds.has(step.id)}
          isActive={activeStepId === step.id}
          isRunning={isRunning}
          onApproveStep={onApproveStep}
          onRevokeStepApproval={onRevokeStepApproval}
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
  tool,
  isApproved,
  isActive,
  isRunning,
  onApproveStep,
  onRevokeStepApproval,
  onRunStep,
}: {
  step: AssistantPlanStep;
  result?: AssistantToolCallResult;
  summary?: AssistantToolResultSummary;
  tool?: AiToolSummary;
  isApproved: boolean;
  isActive: boolean;
  isRunning: boolean;
  onApproveStep: (step: AssistantPlanStep) => void;
  onRevokeStepApproval: (step: AssistantPlanStep) => void;
  onRunStep: (step: AssistantPlanStep, approved?: boolean) => void;
}) {
  const permissions = tool?.permissions ?? [];
  const canRun = Boolean(step.toolName) && (!step.requiresApproval || isApproved);

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
          {permissions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {permissions.map((permission) => (
                <PermissionBadge key={permission} permission={permission} />
              ))}
            </div>
          )}
        </div>
        {step.toolName && !step.requiresApproval && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6 rounded-sm text-muted-foreground hover:text-primary",
              isActive && "animate-pulse"
            )}
            onClick={() => onRunStep(step, false)}
            disabled={isRunning}
            title="Run"
          >
            <Play size={12} />
          </Button>
        )}
      </div>

      {step.requiresApproval && (
        <div className="mt-2 border border-amber-500/35 bg-amber-500/10 p-2">
          <div className="flex items-start gap-2">
            <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-medium text-amber-300">
                Approval required
              </div>
              <div className="mt-0.5 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                This step can change data, delete data, or call an external capability.
                Approve it only after reviewing the tool and input.
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap justify-end gap-1">
            {isApproved ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-sm px-2 text-[10px] text-[hsl(var(--wb-text-muted))]"
                  disabled={isRunning}
                  onClick={() => onRevokeStepApproval(step)}
                >
                  <RotateCcw size={11} className="mr-1" />
                  Revoke
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 rounded-sm px-2 text-[10px]"
                  disabled={isRunning || !canRun}
                  onClick={() => onRunStep(step, true)}
                >
                  <Play size={11} className="mr-1" />
                  Run approved
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-6 rounded-sm px-2 text-[10px] text-amber-300"
                disabled={isRunning}
                onClick={() => onApproveStep(step)}
              >
                <ShieldCheck size={11} className="mr-1" />
                Approve
              </Button>
            )}
          </div>
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

function PermissionBadge({ permission }: { permission: AiToolPermission }) {
  return (
    <span
      className={cn(
        "rounded-[3px] border px-1 py-0.5 text-[9px] uppercase leading-none",
        permission === "read" &&
          "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
        permission === "write" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-300",
        permission === "destructive" &&
          "border-red-500/35 bg-red-500/10 text-red-300",
        permission === "external" &&
          "border-sky-500/35 bg-sky-500/10 text-sky-300"
      )}
    >
      {permission}
    </span>
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
