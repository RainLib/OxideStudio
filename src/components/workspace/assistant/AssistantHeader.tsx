import { cn } from "@/lib/utils";
import { Circle, Sparkles, SquarePen } from "lucide-react";

interface AssistantHeaderProps {
  providerLabel: string;
  isConfigured: boolean;
  isRunning: boolean;
  onNewChat: () => void;
}

export function AssistantHeader({
  providerLabel,
  isConfigured,
  isRunning,
  onNewChat,
}: AssistantHeaderProps) {
  return (
    <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)] px-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Sparkles
          size={14}
          className="shrink-0 text-[hsl(var(--wb-accent))]"
        />
        <span className="truncate text-[11px] font-semibold text-[hsl(var(--wb-text))]">
          Assistant
        </span>
        <span
          className="ml-1 flex min-w-0 items-center gap-1 text-[10px] text-[hsl(var(--wb-text-muted))]"
          title={providerLabel}
        >
          <Circle
            size={6}
            className={cn(
              "shrink-0 fill-current",
              isRunning
                ? "text-amber-400"
                : isConfigured
                  ? "text-emerald-400"
                  : "text-[hsl(var(--wb-text-muted))]"
            )}
          />
          <span className="truncate">
            {isRunning ? "Working" : providerLabel}
          </span>
        </span>
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
    </header>
  );
}
