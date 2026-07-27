import type { AgentFileDiffPreview } from "@/lib/agentFileReview";
import { requestAgentFileReviewDecision } from "@/lib/agentFileReview";
import { createLineDiffHunks } from "@/lib/lineDiff";
import { cn } from "@/lib/utils";
import { Check, Loader2, Undo2 } from "lucide-react";
import { useMemo } from "react";

export function AgentFileDiffReviewBar({
  preview,
}: {
  preview: AgentFileDiffPreview;
}) {
  const hunks = useMemo(
    () =>
      createLineDiffHunks(
        preview.originalContent,
        preview.proposedContent,
      ),
    [preview.originalContent, preview.proposedContent],
  );
  const pending = preview.status === "pending";

  const decide = (
    action:
      | "keep-file"
      | "undo-file"
      | "keep-hunk"
      | "undo-hunk",
    hunk?: (typeof hunks)[number],
  ) =>
    requestAgentFileReviewDecision({
      turnId: preview.turnId,
      callId: preview.callId,
      action,
      hunk,
    });

  return (
    <section className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.7)]">
      <div className="flex min-h-9 items-center gap-2 px-3 text-[10px]">
        <span
          className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text))]"
          title={preview.relativePath}
        >
          {preview.relativePath}
        </span>
        <span className="shrink-0 font-mono text-emerald-400">
          +{preview.additions}
        </span>
        <span className="shrink-0 font-mono text-red-400">
          −{preview.deletions}
        </span>
        {preview.isApplying ? (
          <Loader2
            size={12}
            className="animate-spin text-[hsl(var(--wb-accent))]"
            aria-label="Applying change"
          />
        ) : pending ? (
          <>
            <button
              type="button"
              className="wb-text-button h-6 px-1.5 text-[10px]"
              onClick={() => decide("undo-file")}
            >
              <Undo2 size={10} aria-hidden="true" />
              Undo
            </button>
            <button
              type="button"
              className="wb-text-button h-6 px-1.5 text-[10px] text-emerald-300"
              onClick={() => decide("keep-file")}
            >
              <Check size={10} aria-hidden="true" />
              Keep
            </button>
          </>
        ) : (
          <span
            className={cn(
              "shrink-0",
              preview.status === "accepted"
                ? "text-emerald-400"
                : "text-[hsl(var(--wb-text-muted))]",
            )}
          >
            {preview.status === "accepted"
              ? "Kept"
              : preview.status === "mixed"
                ? "Partially kept"
                : "Undone"}
          </span>
        )}
      </div>

      {pending && hunks.length > 0 && (
        <div className="no-scrollbar flex max-h-20 flex-wrap items-center gap-x-3 gap-y-1 overflow-y-auto border-t border-[hsl(var(--wb-border-subtle))] px-3 py-1.5">
          {hunks.map((hunk, index) => (
            <div
              key={hunk.id}
              className="flex min-w-0 items-center gap-1.5 text-[9px]"
            >
              <span className="font-mono text-[hsl(var(--wb-text-muted))]">
                {hunks.length > 1 ? `Change ${index + 1}` : "Change"} · −
                {hunk.originalStartLine} +{hunk.modifiedStartLine}
              </span>
              <button
                type="button"
                className="text-[hsl(var(--wb-text-muted))] hover:text-red-300 focus-visible:outline-none focus-visible:text-red-300"
                onClick={() => decide("undo-hunk", hunk)}
                title="Undo this change"
              >
                Undo
              </button>
              <button
                type="button"
                className="text-[hsl(var(--wb-text-muted))] hover:text-emerald-300 focus-visible:outline-none focus-visible:text-emerald-300"
                onClick={() => decide("keep-hunk", hunk)}
                title="Keep this change"
              >
                Keep
              </button>
            </div>
          ))}
        </div>
      )}

      {preview.error && (
        <div className="border-t border-red-500/20 px-3 py-1.5 text-[9px] text-red-300">
          {preview.error}
        </div>
      )}
    </section>
  );
}
