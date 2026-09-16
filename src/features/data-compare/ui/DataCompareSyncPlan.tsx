import type {
  TableDataCompareSyncPreview,
  TableDataCompareSyncReceipt,
} from "@/services/tauri/types/tableCompare";
import { AlertTriangle, Check, Copy, FileCode2 } from "lucide-react";

interface DataCompareSyncPlanContext {
  syncPreview: TableDataCompareSyncPreview | null;
  copySyncSql: () => Promise<void>;
  syncPreviewError: string | null;
  syncReceipt: TableDataCompareSyncReceipt | null;
  syncConfirmation: string;
  setSyncConfirmation: React.Dispatch<React.SetStateAction<string>>;
  isExecutingSync: boolean;
  executeSync: () => Promise<void>;
}

export function DataCompareSyncPlan({
  syncPreview,
  copySyncSql,
  syncPreviewError,
  syncReceipt,
  syncConfirmation,
  setSyncConfirmation,
  isExecutingSync,
  executeSync,
}: DataCompareSyncPlanContext) {
  return (
    <section className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.76)] p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px]">
        <FileCode2 size={12} className="text-cyan-300" />
        <span className="font-medium">Synchronization plan</span>
        {syncPreview && (
          <span className="wb-muted">
            {syncPreview.insertCount.toLocaleString()} inserts ·{" "}
            {syncPreview.updateCount.toLocaleString()} updates ·{" "}
            {syncPreview.deleteCount.toLocaleString()} deletes
          </span>
        )}
        {syncPreview && (
          <button
            type="button"
            className="wb-text-button ml-auto h-6 gap-1 px-2 text-[9px]"
            onClick={() => void copySyncSql()}
          >
            <Copy size={10} /> Copy SQL
          </button>
        )}
      </div>
      {syncPreviewError && (
        <div className="mb-2 text-[9px] leading-4 text-rose-300">
          {syncPreviewError}
        </div>
      )}
      {syncReceipt && (
        <div className="flex items-center gap-2 rounded-[5px] border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-2 text-[9px] text-emerald-200">
          <Check size={11} />
          Applied {syncReceipt.rowsAffected.toLocaleString()} frozen
          operation(s) atomically. Run the comparison again to refresh both
          sides.
        </div>
      )}
      {syncPreview && (
        <>
          <textarea
            readOnly
            aria-label="Data compare synchronization SQL"
            value={syncPreview.sql}
            className="h-44 w-full resize-y rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 font-mono text-[9px] leading-4 outline-none"
          />
          <div className="mt-2 space-y-1 text-[8px] leading-4 text-amber-200">
            {syncPreview.warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-1.5">
                <AlertTriangle size={9} className="mt-0.5 shrink-0" /> {warning}
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2.5">
            <div className="text-[8px] leading-4 wb-muted">
              Type{" "}
              <span className="select-all font-mono text-[hsl(var(--wb-text))]">
                {syncPreview.confirmationText}
              </span>{" "}
              to consume this single-use plan. It expires at{" "}
              {new Date(syncPreview.expiresAt).toLocaleTimeString()}.
            </div>
            <div className="mt-2 flex gap-2">
              <input
                aria-label="Synchronization confirmation phrase"
                value={syncConfirmation}
                onChange={(event) => setSyncConfirmation(event.target.value)}
                className="h-7 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 font-mono text-[9px] outline-none focus:border-[hsl(var(--wb-accent)/0.55)]"
                placeholder={syncPreview.confirmationText}
              />
              <button
                type="button"
                className="wb-text-button h-7 px-3 text-[9px]"
                disabled={
                  !syncPreview.canExecute ||
                  syncConfirmation !== syncPreview.confirmationText ||
                  isExecutingSync
                }
                onClick={() => void executeSync()}
              >
                {isExecutingSync ? "Applying…" : "Apply atomically"}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
