import { cn } from "@/lib/utils";
import { Bot, Circle, Database, ShieldCheck, SquarePen } from "lucide-react";
import type { ReactNode } from "react";

interface AssistantHeaderProps {
  activeContextLabel: string;
  plannerLabel: string;
  plannerDetail: string;
  isConfigured: boolean;
  isRunning: boolean;
  onNewChat: () => void;
}

export function AssistantHeader({
  activeContextLabel,
  plannerLabel,
  plannerDetail,
  isConfigured,
  isRunning,
  onNewChat,
}: AssistantHeaderProps) {
  return (
    <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))]">
      <div className="flex h-8 items-center justify-between gap-2 px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Bot size={14} className="shrink-0 text-[hsl(var(--wb-accent))]" />
          <span className="truncate text-[11px] font-semibold text-[hsl(var(--wb-text))]">
            AI Assistant
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[10px] text-[hsl(var(--wb-text-muted))]">
          <div className="mr-1 flex items-center gap-1.5">
            <Circle
              size={7}
              className={cn(
                "fill-current",
                isRunning
                  ? "text-amber-400"
                  : isConfigured
                    ? "text-emerald-400"
                    : "text-[hsl(var(--wb-text-muted))]"
              )}
            />
            <span>{isRunning ? "Running" : isConfigured ? "Ready" : "Fallback"}</span>
          </div>
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={onNewChat}
            disabled={isRunning}
            title="New chat"
            aria-label="Start a new assistant chat"
          >
            <SquarePen size={12} />
          </button>
        </div>
      </div>
      <div className="space-y-1 border-t border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
        <HeaderLine
          icon={<ShieldCheck size={11} />}
          primary={plannerLabel}
          secondary={plannerDetail}
        />
        <HeaderLine
          icon={<Database size={11} />}
          primary={activeContextLabel}
          secondary="Workspace context"
        />
      </div>
    </div>
  );
}

function HeaderLine({
  icon,
  primary,
  secondary,
}: {
  icon: ReactNode;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[10px]">
      <span className="shrink-0 text-[hsl(var(--wb-text-muted))]">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text))]">
        {primary}
      </span>
      <span className="shrink-0 text-[hsl(var(--wb-text-muted))]">
        {secondary}
      </span>
    </div>
  );
}
