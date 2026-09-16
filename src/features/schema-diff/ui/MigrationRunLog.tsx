import {
  formatMigrationStatus,
  formatTimestamp,
  migrationStatusStyle,
  statusTextStyle,
} from "@/features/schema-diff/model/migrationPresentation";
import { cn } from "@/lib/utils";
import type { SchemaMigrationJournalEntry } from "@/services/tauri/types";
import { OctagonX, RotateCcw } from "lucide-react";

export function MigrationRunLog({
  current,
  entries,
  onSelect,
}: {
  current: SchemaMigrationJournalEntry | null;
  entries: SchemaMigrationJournalEntry[];
  onSelect: (entry: SchemaMigrationJournalEntry) => void;
}) {
  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[10px] wb-muted">
        No migration execution has been recorded for this connection.
      </div>
    );
  }
  const preflightPassed = current.preflightResults.filter(
    (result) => result.status === "passed",
  ).length;
  const preflightWarnings = current.preflightResults.filter(
    (result) => result.status === "warning",
  ).length;
  const preflightBlocked = current.preflightResults.filter(
    (result) => result.blocksExecution,
  ).length;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-h-0 overflow-auto">
        <div className="flex items-start justify-between border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-[3px] border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em]",
                  migrationStatusStyle(current.status),
                )}
              >
                {formatMigrationStatus(current.status)}
              </span>
              <span className="font-mono text-[10px]">
                {current.schemaName}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[8px] wb-muted">
              {current.id} · {formatTimestamp(current.startedAt)}
            </div>
          </div>
          <div className="text-right text-[9px] wb-muted">
            <div>
              {current.committedStatements}/{current.statementCount} committed
            </div>
            <div className="mt-1 font-mono">
              {current.targetFingerprintBefore.slice(0, 12)}
            </div>
          </div>
        </div>

        {current.error && (
          <div className="flex items-start gap-2 border-b border-red-400/20 bg-red-400/5 px-4 py-2.5 text-[9px] leading-4 text-red-200">
            <OctagonX size={12} className="mt-0.5 shrink-0" /> {current.error}
          </div>
        )}

        <div className="grid grid-cols-4 border-b border-[hsl(var(--wb-border-subtle))]">
          <RunStage
            label="Freshness"
            detail="Fingerprint matched"
            state="passed"
          />
          <RunStage
            label="Preflight"
            detail={`${preflightPassed} pass · ${preflightWarnings} warn`}
            state={preflightBlocked > 0 ? "failed" : "passed"}
          />
          <RunStage
            label="Atomic apply"
            detail={`${current.committedStatements}/${current.statementCount} committed`}
            state={
              current.committedStatements === current.statementCount &&
              current.statementCount > 0
                ? "passed"
                : current.status === "blocked"
                  ? "skipped"
                  : "failed"
            }
          />
          <RunStage
            label="Post-verify"
            detail={
              current.verification?.matchesSource
                ? "Schemas match"
                : current.verification
                  ? `${current.verification.remainingSummary.total} remaining`
                  : "Not completed"
            }
            state={
              current.verification?.matchesSource
                ? "passed"
                : current.verification
                  ? "failed"
                  : "skipped"
            }
          />
        </div>

        <div className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-2 text-[9px] font-medium">
          Preflight results
        </div>
        {current.preflightResults.length === 0 ? (
          <div className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3 text-[9px] wb-muted">
            This plan had no generated data preflight checks.
          </div>
        ) : (
          current.preflightResults.map((result) => (
            <div
              key={result.checkId}
              className="grid grid-cols-[80px_minmax(0,1fr)_180px] items-start border-b border-[hsl(var(--wb-border-subtle))] px-4 py-2 text-[9px]"
            >
              <span
                className={cn(
                  "w-fit rounded-[3px] border px-1.5 py-0.5 text-[8px] uppercase tracking-wide",
                  result.status === "passed"
                    ? "border-emerald-400/25 text-emerald-300"
                    : result.status === "warning"
                      ? "border-amber-400/25 text-amber-300"
                      : "border-red-400/25 text-red-300",
                )}
              >
                {result.status}
              </span>
              <span className="min-w-0 pr-4">
                <span className="block text-[hsl(var(--wb-text))]">
                  {result.label}
                </span>
                <span className="mt-0.5 block leading-4 wb-muted">
                  {result.error || result.expectation}
                </span>
              </span>
              <span className="font-mono text-[8px] wb-muted">
                {result.observed}
              </span>
            </div>
          ))
        )}

        <div className="px-4 py-3 text-[9px]">
          <div className="flex items-center gap-2 font-medium">
            <RotateCcw size={11} /> Rollback package
          </div>
          <div className="mt-1 leading-4 wb-muted">
            {current.rollback.available && current.rollback.backupPath
              ? `Verified SQLite recovery backup: ${current.rollback.backupPath}${current.rollback.backupByteLen != null ? ` · ${current.rollback.backupByteLen} bytes` : ""}${current.rollback.backupIntegrityCheck ? ` · integrity ${current.rollback.backupIntegrityCheck}` : ""}`
              : current.rollback.available
                ? `${current.rollback.changeCount} reverse change(s) generated${current.rollback.requiresManualReview ? "; manual review is required" : ""}. The artifact remains a ROLLBACK-guarded preview until opened explicitly.`
                : current.rollback.reason ||
                  "No rollback package is available."}
          </div>
        </div>
      </div>

      <aside className="min-h-0 overflow-auto border-l border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.55)]">
        <div className="sticky top-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2 text-[9px] font-medium">
          Recent journal
        </div>
        {entries.length === 0 ? (
          <div className="px-3 py-3 text-[9px] wb-muted">
            No persisted entries.
          </div>
        ) : (
          entries.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={cn(
                "w-full border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-left hover:bg-[hsl(var(--wb-hover))]",
                current.id === entry.id && "bg-[hsl(var(--wb-active-strong))]",
              )}
              onClick={() => onSelect(entry)}
            >
              <span className="flex items-center justify-between gap-2 text-[9px]">
                <span className="truncate font-mono">{entry.schemaName}</span>
                <span
                  className={cn(
                    "shrink-0 text-[8px]",
                    statusTextStyle(entry.status),
                  )}
                >
                  {formatMigrationStatus(entry.status)}
                </span>
              </span>
              <span className="mt-1 block text-[8px] wb-muted">
                {formatTimestamp(entry.startedAt)} · {entry.committedStatements}
                /{entry.statementCount}
              </span>
            </button>
          ))
        )}
      </aside>
    </div>
  );
}

export function RunStage({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: "passed" | "failed" | "skipped";
}) {
  return (
    <div className="border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2.5 last:border-r-0">
      <div
        className={cn(
          "text-[9px] font-medium",
          state === "passed"
            ? "text-emerald-300"
            : state === "failed"
              ? "text-red-300"
              : "wb-muted",
        )}
      >
        {state === "passed" ? "✓" : state === "failed" ? "×" : "—"} {label}
      </div>
      <div className="mt-1 text-[8px] wb-muted">{detail}</div>
    </div>
  );
}
