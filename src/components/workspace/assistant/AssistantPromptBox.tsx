import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Database, FileText, ListChecks, Send, Square } from "lucide-react";
import type { ReactNode } from "react";

interface AssistantPromptBoxProps {
  message: string;
  onMessageChange: (message: string) => void;
  onPlan: () => void;
  onRunSafe: () => void;
  onStop: () => void;
  activeContextLabel: string;
  plannerLabel: string;
  hasSelection: boolean;
  safeStepCount: number;
  isPlanning: boolean;
  isRunning: boolean;
  isCancelling: boolean;
  canRunSafe: boolean;
}

export function AssistantPromptBox({
  message,
  onMessageChange,
  onPlan,
  onRunSafe,
  onStop,
  activeContextLabel,
  plannerLabel,
  hasSelection,
  safeStepCount,
  isPlanning,
  isRunning,
  isCancelling,
  canRunSafe,
}: AssistantPromptBoxProps) {
  const canPlan = Boolean(message.trim()) && !isPlanning && !isRunning;

  return (
    <div className="shrink-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-2">
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1">
        <AssistantContextChip
          icon={<FileText size={10} />}
          label={activeContextLabel}
          title={activeContextLabel}
        />
        {hasSelection && (
          <AssistantContextChip
            icon={<Database size={10} />}
            label="Selection"
            tone="accent"
            title="The current editor selection is included in planning context"
          />
        )}
        <AssistantContextChip
          label={plannerLabel}
          title={plannerLabel}
        />
      </div>

      <div className="rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] shadow-[inset_0_1px_0_hsl(var(--wb-border-subtle))] focus-within:border-[hsl(var(--wb-accent))]">
        <textarea
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (canPlan) onPlan();
            }
          }}
          placeholder="Ask AI to inspect schema, explain SQL, or prepare a gated action"
          className="min-h-[86px] w-full resize-none bg-transparent px-2 py-2 text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
        />
        <div className="flex items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] px-1.5 py-1">
          <span className="truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
            Plan first · write and destructive SQL stay gated
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {isRunning ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-6 rounded-sm px-2 text-[11px]"
                onClick={onStop}
                disabled={isCancelling}
                title="Stop active assistant tool"
              >
                <Square size={11} className="mr-1 fill-current" />
                {isCancelling ? "Stopping" : "Stop"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 rounded-sm px-2 text-[11px]"
                onClick={onRunSafe}
                disabled={!canRunSafe}
                title="Run read-only steps"
              >
                <ListChecks size={11} className="mr-1" />
                Run Safe{safeStepCount > 0 ? ` ${safeStepCount}` : ""}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="h-6 rounded-sm px-2 text-[11px]"
              onClick={onPlan}
              disabled={!canPlan}
              title="Plan assistant actions"
            >
              <Send size={11} className="mr-1" />
              {isPlanning ? "Planning" : "Plan"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantContextChip({
  icon,
  label,
  title,
  tone = "muted",
}: {
  icon?: ReactNode;
  label: string;
  title?: string;
  tone?: "muted" | "accent";
}) {
  return (
    <span
      className={cn(
        "flex h-5 min-w-0 max-w-full items-center gap-1 rounded-[3px] border px-1.5 text-[10px]",
        tone === "accent"
          ? "border-[hsl(var(--wb-accent)/0.4)] bg-[hsl(var(--wb-accent)/0.12)] text-[hsl(var(--wb-text))]"
          : "border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] wb-muted"
      )}
      title={title}
    >
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}
