import type { AiToolAuditEntry } from "@/ai/tools/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ShieldBan,
  Trash2,
} from "lucide-react";
import { useState } from "react";

interface AssistantActivityProps {
  entries: AiToolAuditEntry[];
  onClear: () => void;
}

export function AssistantActivity({
  entries,
  onClear,
}: AssistantActivityProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (entries.length === 0) return null;

  return (
    <section
      className="mx-3 mb-3 border-y border-[hsl(var(--wb-border-subtle))]"
      aria-label="AI tool activity"
    >
      <div className="flex h-7 items-center px-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-left text-[10px] font-medium text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          <ChevronDown
            size={11}
            className={cn(
              "shrink-0 transition-transform duration-150",
              !isExpanded && "-rotate-90"
            )}
          />
          <span>Activity</span>
          <span className="rounded-[3px] bg-[hsl(var(--wb-active))] px-1 text-[9px] tabular-nums">
            {entries.length}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-sm text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]"
          onClick={onClear}
          title="Clear activity"
          aria-label="Clear AI tool activity"
        >
          <Trash2 size={11} />
        </Button>
      </div>

      {isExpanded && (
        <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
          {entries.map((entry, index) => (
            <AssistantActivityRow
              key={`${entry.requestId}:${entry.toolName}:${entry.startedAt}:${index}`}
              entry={entry}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AssistantActivityRow({ entry }: { entry: AiToolAuditEntry }) {
  const statusLabel =
    entry.status === "success"
      ? "Succeeded"
      : entry.status === "blocked"
        ? "Blocked by policy"
        : "Failed";

  return (
    <div className="px-2 py-1.5 text-[10px]">
      <div className="flex min-w-0 items-center gap-1.5">
        <ActivityStatusIcon status={entry.status} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[hsl(var(--wb-text))]"
          title={entry.toolName}
        >
          {entry.toolName}
        </span>
        <span
          className="shrink-0 tabular-nums text-[hsl(var(--wb-text-muted))]"
          title={statusLabel}
        >
          {formatDuration(entry.durationMs)}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-start gap-1 pl-[17px] text-[9px] text-[hsl(var(--wb-text-muted))]">
        <span className="shrink-0">{entry.permissions.join(" / ")}</span>
        {entry.reason && (
          <>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 break-words" title={entry.reason}>
              {entry.reason}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function ActivityStatusIcon({ status }: { status: AiToolAuditEntry["status"] }) {
  if (status === "success") {
    return (
      <CheckCircle2
        size={11}
        className="shrink-0 text-emerald-400"
        aria-label="Succeeded"
      />
    );
  }
  if (status === "blocked") {
    return (
      <ShieldBan
        size={11}
        className="shrink-0 text-amber-400"
        aria-label="Blocked by policy"
      />
    );
  }
  return (
    <CircleAlert
      size={11}
      className="shrink-0 text-red-400"
      aria-label="Failed"
    />
  );
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}
