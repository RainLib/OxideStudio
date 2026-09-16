import type { SchemaDiffPlan } from "@/services/tauri/types/schemaDiff";
import { Loader2, OctagonX, Play, ShieldAlert, X } from "lucide-react";

interface SchemaMigrationConfirmationContext {
  isTargetOwnedPlan: boolean;
  isNonTransactionalPlan: boolean;
  plan: SchemaDiffPlan;
  setConfirmationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  requiredConfirmationTarget: string;
  confirmationTarget: string;
  setConfirmationTarget: React.Dispatch<React.SetStateAction<string>>;
  isApplying: boolean;
  requiresReview: boolean;
  allowReview: boolean;
  setAllowReview: React.Dispatch<React.SetStateAction<boolean>>;
  reviewChangeCount: number;
  requiresDestructive: boolean;
  allowDestructive: boolean;
  setAllowDestructive: React.Dispatch<React.SetStateAction<boolean>>;
  destructiveChangeCount: number;
  allowNonTransactional: boolean;
  setAllowNonTransactional: React.Dispatch<React.SetStateAction<boolean>>;
  confirmationReady: boolean;
  applyMigration: () => Promise<void>;
  executionError: string | null;
}

export function SchemaMigrationConfirmation({
  isTargetOwnedPlan,
  isNonTransactionalPlan,
  plan,
  setConfirmationOpen,
  requiredConfirmationTarget,
  confirmationTarget,
  setConfirmationTarget,
  isApplying,
  requiresReview,
  allowReview,
  setAllowReview,
  reviewChangeCount,
  requiresDestructive,
  allowDestructive,
  setAllowDestructive,
  destructiveChangeCount,
  allowNonTransactional,
  setAllowNonTransactional,
  confirmationReady,
  applyMigration,
  executionError,
}: SchemaMigrationConfirmationContext) {
  return (
    <section className="shrink-0 border-b border-amber-400/25 bg-amber-400/[0.045] px-4 py-3">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-200">
            <ShieldAlert size={13} /> Confirm{" "}
            {isTargetOwnedPlan
              ? "target-owned"
              : isNonTransactionalPlan
                ? "non-transactional"
                : "transactional"}{" "}
            migration
          </div>
          <p className="mt-1 max-w-3xl text-[9px] leading-4 wb-muted">
            {isTargetOwnedPlan
              ? `OxideStudio will recapture the live target, then ask the verified driver process to preflight, apply and verify its opaque semantic plan. Sidecar tokens remain only in Host memory, and no driver-generated DDL is exposed or executed as console SQL.${isNonTransactionalPlan ? " The driver declares non-transactional execution, so partial apply remains possible." : ""}`
              : isNonTransactionalPlan
                ? `OxideStudio will recapture the live target and reject stale plans, run every generated preflight check, then execute ${plan.changes.flatMap((change) => change.sql).length} reviewed MySQL statement(s) one at a time. MySQL can auto-commit DDL, so a failed run may leave earlier statements applied; the journal and post-verification show the exact outcome.`
                : `OxideStudio will recapture the live target and reject stale plans, run every generated preflight check, commit all ${plan.changes.flatMap((change) => change.sql).length} statement(s) in one PostgreSQL transaction, then recapture and compare the schema again.`}
          </p>
        </div>
        <button
          type="button"
          className="wb-icon-button h-6 w-6 shrink-0"
          onClick={() => setConfirmationOpen(false)}
          aria-label="Close migration confirmation"
        >
          <X size={12} />
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="text-[9px] wb-muted">
          Type exact target{" "}
          <span className="font-mono text-[hsl(var(--wb-text))]">
            {requiredConfirmationTarget}
          </span>
          <input
            type="text"
            value={confirmationTarget}
            onChange={(event) => setConfirmationTarget(event.target.value)}
            className="mt-1 block h-7 w-72 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[10px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent)/0.65)]"
            autoComplete="off"
            spellCheck={false}
            disabled={isApplying}
          />
        </label>
        {requiresReview && (
          <label className="flex h-7 items-center gap-2 text-[9px] text-amber-100/85">
            <input
              type="checkbox"
              checked={allowReview}
              onChange={(event) => setAllowReview(event.target.checked)}
              disabled={isApplying}
              className="accent-[hsl(var(--wb-accent))]"
            />
            I reviewed {reviewChangeCount} manual-review change(s)
          </label>
        )}
        {requiresDestructive && (
          <label className="flex h-7 items-center gap-2 text-[9px] text-red-200/90">
            <input
              type="checkbox"
              checked={allowDestructive}
              onChange={(event) => setAllowDestructive(event.target.checked)}
              disabled={isApplying}
              className="accent-red-400"
            />
            I approve {destructiveChangeCount} destructive/non-reversible
            change(s)
          </label>
        )}
        {isNonTransactionalPlan && (
          <label className="flex h-7 items-center gap-2 text-[9px] text-amber-100/90">
            <input
              type="checkbox"
              checked={allowNonTransactional}
              onChange={(event) =>
                setAllowNonTransactional(event.target.checked)
              }
              disabled={isApplying}
              className="accent-amber-400"
            />
            I understand{" "}
            {isTargetOwnedPlan ? "this target-owned migration" : "MySQL DDL"}{" "}
            can partially commit before a failure
          </label>
        )}
        <button
          type="button"
          className="wb-primary-button h-7 gap-1.5 px-3 text-[10px]"
          disabled={!confirmationReady || isApplying}
          onClick={() => void applyMigration()}
        >
          {isApplying ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          Run preflight & apply
        </button>
      </div>
      {executionError && (
        <div className="mt-2 flex items-start gap-1.5 text-[9px] leading-4 text-red-300">
          <OctagonX size={11} className="mt-0.5 shrink-0" /> {executionError}
        </div>
      )}
    </section>
  );
}
