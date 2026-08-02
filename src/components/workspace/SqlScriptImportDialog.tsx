import { AlertTriangle, FileCode2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SqlScriptImportPreview } from "@/services/tauri/types";

interface SqlScriptImportDialogProps {
  open: boolean;
  preview: SqlScriptImportPreview | null;
  target: string;
  isSubmitting: boolean;
  onClose: () => void;
  onImport: () => Promise<void>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Native-looking review surface for potentially mutating SQL scripts. The
 * script text comes from a bounded Host preflight; execution still rechecks
 * the returned digest so closing/reopening this dialog cannot approve changed
 * contents.
 */
export function SqlScriptImportDialog({
  open,
  preview,
  target,
  isSubmitting,
  onClose,
  onImport,
}: SqlScriptImportDialogProps) {
  const statementLabel = `${preview?.statementCount.toLocaleString() || 0} statement${preview?.statementCount === 1 ? "" : "s"}`;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSubmitting && onClose()}>
      <DialogContent className="grid h-[min(700px,calc(100vh-32px))] w-[min(920px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <FileCode2 size={15} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[13px] tracking-normal">Review SQL script</DialogTitle>
              <DialogDescription className="truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                {preview?.fileName || "SQL script"} · {statementLabel} · {formatBytes(preview?.totalBytes || 0)} · {target}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <main className="min-h-0 overflow-auto bg-[hsl(var(--wb-editor))]">
          <section className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-[11px] text-amber-100">
            <div className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> This script can create, update, or delete data.</div>
            <p className="mt-1 text-[10px] leading-4 text-amber-100/75">Review the statements below. OxideStudio only runs the exact file contents reviewed here.</p>
          </section>
          <div className="space-y-2 p-3">
            {(preview?.statementPreview || []).map((statement, index) => (
              <section key={`${index}-${statement.slice(0, 24)}`} className="overflow-hidden rounded-[4px] border border-[hsl(var(--wb-border-subtle))]">
                <header className="flex h-7 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-2.5 text-[10px]">
                  <span className="font-medium">Statement {index + 1}</span>
                  <span className="wb-muted">SQL</span>
                </header>
                <pre className="custom-scrollbar overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))]">{statement}</pre>
              </section>
            ))}
            {preview?.truncated && (
              <p className="px-1 text-[10px] wb-muted">Only the first 20 statements are shown. The total count above includes every statement in this file.</p>
            )}
          </div>
        </main>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <span className="text-[10px] wb-muted">No SQL has run yet.</span>
          <div className="flex gap-2">
            <button type="button" className="wb-text-button h-7 px-3 text-[11px]" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button type="button" className="wb-primary-button h-7 min-w-[112px] justify-center px-3 text-[11px]" disabled={!preview || isSubmitting} onClick={() => void onImport()}>
              {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : "Run script"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
