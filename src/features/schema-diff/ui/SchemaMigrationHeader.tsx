import { formatTimestamp } from "@/features/schema-diff/model/migrationPresentation";
import type {
  SchemaDiffPlan,
  SchemaMigrationJournalEntry,
  SchemaSnapshot,
} from "@/services/tauri/types/schemaDiff";
import {
  Check,
  Clipboard,
  GitCompareArrows,
  Loader2,
  Play,
  TerminalSquare,
} from "lucide-react";

interface SchemaMigrationHeaderContext {
  target: SchemaSnapshot;
  plan: SchemaDiffPlan;
  source: SchemaSnapshot;
  copySql: () => Promise<void>;
  previewSql: string;
  previewSurface: "migration" | "preflight" | "rollback" | "run";
  copied: boolean;
  openInConsole: () => void;
  isOfflineSource: boolean;
  offlineSourceLabel: string;
  isTargetOwnedPlan: boolean;
  isSqliteRebuildPlan: boolean;
  setExecutionError: React.Dispatch<React.SetStateAction<string | null>>;
  setConfirmationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isApplying: boolean;
  supportsSafeApply: boolean;
  executionOwner: "hostSql" | "externalDriver" | "reviewOnly";
  isNonTransactionalPlan: boolean;
  currentJournal: SchemaMigrationJournalEntry | null;
  recaptureInterruptedMigration: () => Promise<void>;
  isRecapturing: boolean;
}

export function SchemaMigrationHeader({
  target,
  plan,
  source,
  copySql,
  previewSql,
  previewSurface,
  copied,
  openInConsole,
  isOfflineSource,
  offlineSourceLabel,
  isTargetOwnedPlan,
  isSqliteRebuildPlan,
  setExecutionError,
  setConfirmationOpen,
  isApplying,
  supportsSafeApply,
  executionOwner,
  isNonTransactionalPlan,
  currentJournal,
  recaptureInterruptedMigration,
  isRecapturing,
}: SchemaMigrationHeaderContext) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
          <GitCompareArrows size={16} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-semibold">
            <span className="truncate">{target.connectionName}</span>
            <span className="font-normal wb-muted">/</span>
            <span className="truncate font-mono">{plan.targetSchemaName}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[9px] wb-muted">
            <span>Make live target match snapshot</span>
            <span>·</span>
            <span>{formatTimestamp(source.capturedAt)}</span>
            <span>·</span>
            <span className="font-mono">{source.fingerprint.slice(0, 10)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
          onClick={() => void copySql()}
          disabled={!previewSql || previewSurface === "run"}
        >
          {copied ? <Check size={12} /> : <Clipboard size={12} />}
          {copied
            ? "Copied"
            : previewSurface === "preflight"
              ? "Copy checks"
              : previewSurface === "rollback"
                ? "Copy rollback"
                : "Copy SQL"}
        </button>
        <button
          type="button"
          className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
          onClick={openInConsole}
          title={
            isOfflineSource
              ? `${offlineSourceLabel} review artifacts cannot open a runnable console.`
              : isTargetOwnedPlan
                ? "Target-owned plans never expose or execute sidecar DDL in a Host SQL console."
                : isSqliteRebuildPlan
                  ? "SQLite rebuild SQL runs only through its verified backup and atomic driver boundary."
                  : previewSurface === "migration" && plan.summary.blocked > 0
                    ? "Resolve blocked changes before opening a runnable migration console"
                    : undefined
          }
          disabled={
            isOfflineSource ||
            isTargetOwnedPlan ||
            isSqliteRebuildPlan ||
            (previewSurface === "run" || previewSurface === "rollback"
              ? !previewSql
              : previewSurface === "migration"
                ? plan.changes.length === 0 || plan.summary.blocked > 0
                : plan.preflightChecks.length === 0)
          }
        >
          <TerminalSquare size={12} />
          Open in console
        </button>
        <button
          type="button"
          className="wb-primary-button h-7 gap-1.5 px-2.5 text-[10px]"
          onClick={() => {
            setExecutionError(null);
            setConfirmationOpen(true);
          }}
          disabled={
            isApplying ||
            !supportsSafeApply ||
            plan.summary.total === 0 ||
            plan.summary.blocked > 0
          }
          title={
            !supportsSafeApply
              ? isOfflineSource
                ? `${offlineSourceLabel} baselines are review-only. Capture a live snapshot before applying a migration.`
                : executionOwner === "reviewOnly"
                  ? "This external package or server version has no exact semantic migration evidence."
                  : "Automatic apply is available for verified target-owned plans, PostgreSQL transactions, complete SQLite rebuilds, and explicitly acknowledged MySQL DDL"
              : plan.summary.blocked > 0
                ? "Resolve blocked changes before applying"
                : isNonTransactionalPlan
                  ? "Refresh the live target, run target-owned preflight/apply, then verify"
                  : "Refresh the live target, run preflight, apply atomically, then verify"
          }
        >
          {isApplying ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          {isApplying
            ? "Applying…"
            : isTargetOwnedPlan
              ? "Apply target-owned plan"
              : isNonTransactionalPlan
                ? "Apply reviewed plan"
                : "Apply safely"}
        </button>
        {currentJournal?.status === "interrupted" && (
          <button
            type="button"
            className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
            onClick={() => void recaptureInterruptedMigration()}
            disabled={isApplying || isRecapturing}
            title="Read the current target schema and create a new plan. This never resumes the interrupted migration."
          >
            {isRecapturing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <GitCompareArrows size={12} />
            )}
            Recapture & recompare
          </button>
        )}
      </div>
    </header>
  );
}
