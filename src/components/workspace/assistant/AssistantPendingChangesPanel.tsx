import type {
  AssistantProjectFileProposal,
  AssistantTurn,
} from "@/ai/assistant/turns";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronRight,
  FileDiff,
  Loader2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

export type PendingAssistantFileProposal = {
  turnId: string;
  projectId: string;
  proposal: AssistantProjectFileProposal;
};

export function pendingAssistantFileProposals(
  turns: readonly AssistantTurn[],
): PendingAssistantFileProposal[] {
  const latestByPath = new Map<string, PendingAssistantFileProposal>();
  for (const turn of turns) {
    for (const proposal of turn.fileProposals ?? []) {
      const current = latestByPath.get(proposal.relativePath);
      if (!current || proposal.occurredAt >= current.proposal.occurredAt) {
        latestByPath.set(proposal.relativePath, {
          turnId: turn.id,
          projectId: turn.projectId,
          proposal,
        });
      }
    }
  }
  return Array.from(latestByPath.values())
    .filter((item) => item.proposal.status === "pending")
    .sort((left, right) => left.proposal.occurredAt - right.proposal.occurredAt);
}

export function AssistantPendingChangesPanel({
  turns,
  onOpen,
  onAccept,
  onReject,
}: {
  turns: readonly AssistantTurn[];
  onOpen: (item: PendingAssistantFileProposal) => void;
  onAccept: (item: PendingAssistantFileProposal) => Promise<void>;
  onReject: (item: PendingAssistantFileProposal) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [bulkAction, setBulkAction] = useState<"accept" | "reject" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const pending = useMemo(
    () => pendingAssistantFileProposals(turns),
    [turns],
  );
  if (pending.length === 0) return null;

  const additions = pending.reduce(
    (total, item) => total + item.proposal.additions,
    0,
  );
  const deletions = pending.reduce(
    (total, item) => total + item.proposal.deletions,
    0,
  );
  const busy =
    bulkAction !== null ||
    pending.some((item) => item.proposal.isApplying);

  const acceptAll = async () => {
    if (busy) return;
    setBulkAction("accept");
    setError(null);
    try {
      for (const item of pending) {
        await onAccept(item);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBulkAction(null);
    }
  };

  const rejectAll = () => {
    if (busy) return;
    setBulkAction("reject");
    for (const item of pending) onReject(item);
    setBulkAction(null);
  };

  return (
    <section
      className="border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]"
      data-assistant-pending-file-changes
    >
      {expanded && (
        <div className="max-h-48 overflow-y-auto border-b border-[hsl(var(--wb-border-subtle))]">
          {pending.map((item) => (
            <div
              key={`${item.turnId}:${item.proposal.callId}`}
              className="group flex min-h-8 items-center gap-2 px-3 text-[10px] hover:bg-[hsl(var(--wb-hover))]"
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[hsl(var(--wb-text))] outline-none focus-visible:text-[hsl(var(--wb-accent))]"
                title={`Review ${item.proposal.relativePath}`}
                onClick={() => onOpen(item)}
              >
                {item.proposal.relativePath}
              </button>
              <span className="shrink-0 font-mono text-emerald-400">
                +{item.proposal.additions}
              </span>
              <span className="shrink-0 font-mono text-red-400">
                −{item.proposal.deletions}
              </span>
              {item.proposal.isApplying ? (
                <Loader2
                  size={11}
                  className="shrink-0 animate-spin text-[hsl(var(--wb-accent))]"
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="text-[hsl(var(--wb-text-muted))] opacity-0 outline-none hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
                    title={`Reject ${item.proposal.relativePath}`}
                    aria-label={`Reject ${item.proposal.relativePath}`}
                    onClick={() => onReject(item)}
                  >
                    <X size={11} />
                  </button>
                  <button
                    type="button"
                    className="text-[hsl(var(--wb-text-muted))] opacity-0 outline-none hover:text-emerald-300 focus-visible:opacity-100 group-hover:opacity-100"
                    title={`Accept ${item.proposal.relativePath}`}
                    aria-label={`Accept ${item.proposal.relativePath}`}
                    onClick={() => {
                      setError(null);
                      void onAccept(item).catch((reason) =>
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : String(reason),
                        ),
                      );
                    }}
                  >
                    <Check size={11} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-9 items-center gap-1.5 px-2.5">
        <button
          type="button"
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-left text-[10px] text-[hsl(var(--wb-text))] outline-none focus-visible:text-[hsl(var(--wb-accent))]"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <FileDiff
            size={11}
            className="shrink-0 text-[hsl(var(--wb-accent))]"
            aria-hidden="true"
          />
          <span className="truncate">
            {pending.length} pending {pending.length === 1 ? "file" : "files"}
          </span>
          <span className="shrink-0 font-mono text-emerald-400">
            +{additions}
          </span>
          <span className="shrink-0 font-mono text-red-400">−{deletions}</span>
          <ChevronRight
            size={10}
            className={cn(
              "shrink-0 opacity-0 transition-[transform,opacity] group-hover:opacity-100 group-focus-visible:opacity-100",
              expanded && "-rotate-90",
            )}
            aria-hidden="true"
          />
        </button>
        {busy ? (
          <Loader2
            size={12}
            className="animate-spin text-[hsl(var(--wb-accent))]"
            aria-label="Applying file changes"
          />
        ) : (
          <>
            <button
              type="button"
              className="wb-text-button h-6 px-1.5 text-[10px]"
              onClick={rejectAll}
            >
              Reject all
            </button>
            <button
              type="button"
              className="wb-text-button h-6 px-1.5 text-[10px] text-emerald-300"
              onClick={() => void acceptAll()}
            >
              Accept all
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="border-t border-red-500/20 px-3 py-1.5 text-[9px] text-red-300">
          {error}
        </div>
      )}
    </section>
  );
}
