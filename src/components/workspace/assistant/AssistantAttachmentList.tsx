import type {
  AssistantAttachment,
  UiActionRequest,
  UiActionResult,
} from "@/ai/ui-actions/types";
import { cn } from "@/lib/utils";
import {
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  Database,
  FileCode2,
  Loader2,
  Table2,
} from "lucide-react";
import { useState } from "react";

interface AssistantAttachmentListProps {
  attachments: AssistantAttachment[];
  onExecute: (request: UiActionRequest) => Promise<UiActionResult>;
}

export function AssistantAttachmentList({
  attachments,
  onExecute,
}: AssistantAttachmentListProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5" aria-label="Assistant references">
      {attachments.map((attachment) => (
        <AssistantAttachmentCard
          key={attachment.id}
          attachment={attachment}
          onExecute={onExecute}
        />
      ))}
    </div>
  );
}

function AssistantAttachmentCard({
  attachment,
  onExecute,
}: {
  attachment: AssistantAttachment;
  onExecute: (request: UiActionRequest) => Promise<UiActionResult>;
}) {
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [result, setResult] = useState<UiActionResult | null>(null);
  const Icon = attachmentIcon(attachment.kind);

  const execute = async (request: UiActionRequest) => {
    if (pendingActionId) return;
    setPendingActionId(request.id);
    setResult(null);
    try {
      setResult(await onExecute(request));
    } finally {
      setPendingActionId(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.62)]">
      <button
        type="button"
        className="group flex min-h-8 w-full items-center gap-2 px-2 text-left hover:bg-[hsl(var(--wb-hover)/0.58)] disabled:cursor-wait"
        onClick={() => void execute(attachment.action)}
        disabled={Boolean(pendingActionId)}
        title={attachment.action.presentation.label}
      >
        <Icon size={12} className="shrink-0 text-[hsl(var(--wb-accent))]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-medium text-[hsl(var(--wb-text))]">
            {attachment.label}
          </span>
          {attachment.detail && (
            <span className="block truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
              {attachment.detail}
            </span>
          )}
        </span>
        {pendingActionId === attachment.action.id ? (
          <Loader2 size={11} className="shrink-0 animate-spin wb-muted" />
        ) : result?.status === "success" ? (
          <Check size={11} className="shrink-0 text-emerald-400" />
        ) : (
          <ChevronRight
            size={11}
            className="shrink-0 wb-muted transition-transform group-hover:translate-x-0.5"
          />
        )}
      </button>

      {attachment.secondaryActions && attachment.secondaryActions.length > 0 && (
        <div className="flex items-center gap-1 border-t border-[hsl(var(--wb-border-subtle))] px-2 py-1">
          {attachment.secondaryActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="rounded-[3px] px-1.5 py-0.5 text-[9px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] disabled:cursor-wait disabled:opacity-60"
              onClick={() => void execute(action)}
              disabled={Boolean(pendingActionId)}
            >
              {pendingActionId === action.id ? "Opening…" : action.presentation.label}
            </button>
          ))}
        </div>
      )}

      {result && result.status !== "success" && (
        <div
          className={cn(
            "flex items-start gap-1.5 border-t border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-[9px] leading-4",
            result.status === "stale"
              ? "text-amber-300"
              : "text-[hsl(var(--destructive))]"
          )}
          role="status"
        >
          <CircleAlert size={10} className="mt-0.5 shrink-0" />
          <span>
            {result.message || result.code}
            {result.recovery ? ` ${result.recovery}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function attachmentIcon(kind: AssistantAttachment["kind"]) {
  if (kind === "databaseObject") return Database;
  if (kind === "editorRange") return Code2;
  if (kind === "file") return FileCode2;
  if (kind === "result") return Table2;
  if (kind === "plan") return Braces;
  return FileCode2;
}
