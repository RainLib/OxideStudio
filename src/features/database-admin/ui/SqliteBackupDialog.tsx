import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  databaseAdminErrorPresentation,
  type DatabaseAdminErrorPresentation,
} from "@/features/database-admin/model/databaseAdminErrors";
import { cn } from "@/lib/utils";
import { databaseService } from "@/services/tauri";
import type {
  SqliteBackupExecutionReceipt,
  SqliteBackupOperation,
  SqliteBackupPlan,
} from "@/services/tauri/types";
import { open as openFile, save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  DatabaseBackup,
  FileCheck2,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface SqliteBackupTarget {
  connectionId: string;
  connectionName: string;
  initialOperation?: SqliteBackupOperation;
}

interface SqliteBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SqliteBackupTarget;
  onCompleted?: () => void | Promise<void>;
}

function formatBytes(value: number | null | undefined) {
  if (value == null) return "New file";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function suggestedBackupName(connectionName: string) {
  const safeName =
    connectionName
      .trim()
      .replace(/[^a-z0-9._-]+/giu, "-")
      .replace(/^-+|-+$/gu, "") || "database";
  const day = new Date().toISOString().slice(0, 10);
  return `${safeName}-${day}.sqlite`;
}

export function SqliteBackupDialog({
  open,
  onOpenChange,
  target,
  onCompleted,
}: SqliteBackupDialogProps) {
  const [operation, setOperation] = useState<SqliteBackupOperation>(
    target.initialOperation || "backup",
  );
  const [path, setPath] = useState("");
  const [plan, setPlan] = useState<SqliteBackupPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<DatabaseAdminErrorPresentation | null>(null);
  const [receipt, setReceipt] = useState<SqliteBackupExecutionReceipt | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setOperation(target.initialOperation || "backup");
    setPath("");
    setPlan(null);
    setConfirmation("");
    setError(null);
    setReceipt(null);
    generationRef.current += 1;
  }, [open, target.connectionId, target.initialOperation]);

  useEffect(() => {
    if (!open || !path) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsPreviewing(true);
    setPlan(null);
    setConfirmation("");
    setReceipt(null);
    setError(null);
    void databaseService
      .previewSqliteBackupPlan(target.connectionId, { operation, path })
      .then((nextPlan) => {
        if (generationRef.current === generation) setPlan(nextPlan);
      })
      .catch((reason) => {
        if (generationRef.current === generation)
          setError(databaseAdminErrorPresentation(reason));
      })
      .finally(() => {
        if (generationRef.current === generation) setIsPreviewing(false);
      });
    return () => {
      generationRef.current += 1;
    };
  }, [open, operation, path, previewVersion, target.connectionId]);

  const fileDetail = useMemo(() => {
    if (!plan) return null;
    if (plan.operation === "backup")
      return plan.destinationExists
        ? `Existing backup · ${formatBytes(plan.byteLen)}`
        : "New backup file";
    return `Validated restore source · ${formatBytes(plan.byteLen)}`;
  }, [plan]);

  const chooseFile = async () => {
    setError(null);
    try {
      const selected =
        operation === "backup"
          ? await save({
              title: "Choose SQLite backup destination",
              defaultPath: suggestedBackupName(target.connectionName),
              filters: [
                {
                  name: "SQLite database",
                  extensions: ["sqlite", "sqlite3", "db"],
                },
              ],
            })
          : await openFile({
              title: "Choose SQLite restore source",
              multiple: false,
              directory: false,
              filters: [
                {
                  name: "SQLite database",
                  extensions: ["sqlite", "sqlite3", "db"],
                },
              ],
            });
      if (typeof selected === "string" && selected.trim()) setPath(selected);
    } catch (reason) {
      setError(databaseAdminErrorPresentation(reason));
    }
  };

  const execute = async () => {
    if (!plan || confirmation !== plan.confirmationText) return;
    setIsExecuting(true);
    setError(null);
    try {
      const nextReceipt = await databaseService.executeSqliteBackupPlan(
        target.connectionId,
        {
          plan: { operation, path: plan.path },
          confirmationToken: plan.confirmationToken,
          confirmationText: confirmation,
        },
      );
      setReceipt(nextReceipt);
      if (onCompleted) {
        void Promise.resolve(onCompleted()).catch(() => undefined);
      }
    } catch (reason) {
      setError(databaseAdminErrorPresentation(reason));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isExecuting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-[640px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[13px]">
            <DatabaseBackup size={15} /> SQLite backup and restore
          </DialogTitle>
          <DialogDescription className="text-[11px] wb-muted">
            {target.connectionName} · Native, integrity-checked snapshots of the live database
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-4 py-4 text-[11px]">
          <div className="grid grid-cols-2 gap-1 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-1">
            {(
              [
                ["backup", DatabaseBackup, "Protect", "Create a consistent snapshot"],
                ["restore", ArchiveRestore, "Restore", "Replace from a reviewed snapshot"],
              ] as const
            ).map(([value, Icon, label, description]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "flex items-start gap-2 rounded-[4px] border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
                  operation === value
                    ? "border-[hsl(var(--wb-accent)/0.5)] bg-[hsl(var(--wb-accent)/0.1)]"
                    : "border-transparent hover:bg-[hsl(var(--wb-hover))]",
                )}
                aria-pressed={operation === value}
                disabled={isExecuting}
                onClick={() => {
                  if (operation === value) return;
                  setOperation(value);
                  setPath("");
                  setPlan(null);
                  setConfirmation("");
                  setError(null);
                }}
              >
                <Icon
                  size={14}
                  className={cn(
                    "mt-0.5 shrink-0",
                    operation === value
                      ? "text-[hsl(var(--wb-accent))]"
                      : "wb-muted",
                  )}
                />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="mt-0.5 block wb-muted">{description}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid gap-1.5">
            <span className="font-medium">
              {operation === "backup" ? "Backup destination" : "Restore source"}
            </span>
            <div className="flex gap-2">
              <div
                className="wb-input flex h-8 min-w-0 flex-1 items-center truncate px-2 font-mono text-[10px]"
                title={path || undefined}
              >
                {path || "No file selected"}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void chooseFile()}
                disabled={isExecuting}
              >
                <FolderOpen size={13} className="mr-1.5" /> Choose file
              </Button>
            </div>
          </div>

          {isPreviewing ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] px-3 py-3 wb-muted"
            >
              <RefreshCw size={13} className="animate-spin" /> Validating the exact file and live SQLite connection…
            </div>
          ) : plan ? (
            <div
              className={cn(
                "space-y-3 rounded-[5px] border px-3 py-3",
                plan.risk === "high"
                  ? "border-amber-500/40 bg-amber-500/10"
                  : "border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))]",
              )}
            >
              <div className="flex items-start gap-2">
                {plan.risk === "high" ? (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
                ) : (
                  <FileCheck2 size={14} className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{plan.summary}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 wb-muted">
                    <span>{fileDetail}</span>
                    <span>SQLite {plan.serverVersion || "version unavailable"}</span>
                  </div>
                </div>
              </div>

              {plan.createsRecoveryPoint && (
                <div className="flex items-start gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2.5 py-2">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-300" />
                  <span>
                    Oxide creates an integrity-checked recovery point before replacing the live database. The recovery path is shown after completion.
                  </span>
                </div>
              )}

              {plan.sourceSha256 && (
                <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 font-mono text-[10px] wb-muted">
                  <span>SHA-256</span>
                  <span className="truncate" title={plan.sourceSha256}>
                    {plan.sourceSha256}
                  </span>
                </div>
              )}

              <label className="grid gap-1.5">
                <span>
                  Type <code className="font-mono text-[hsl(var(--wb-text))]">{plan.confirmationText}</code> to confirm:
                </span>
                <input
                  aria-label="SQLite backup confirmation text"
                  className="wb-input h-8 font-mono"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isExecuting || Boolean(receipt)}
                />
              </label>
            </div>
          ) : !path ? (
            <div className="rounded-[4px] border border-dashed border-[hsl(var(--wb-border-subtle))] px-3 py-4 text-center wb-muted">
              Choose a file to review the exact operation before anything changes.
            </div>
          ) : null}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{error.title}</div>
                <div className="mt-0.5 text-red-200/80">{error.message}</div>
                {error.guidance && <div className="mt-0.5 text-red-200/70">{error.guidance}</div>}
              </div>
              {path && (
                <button
                  type="button"
                  className="wb-toolbar-button h-6 shrink-0 px-2 text-[10px]"
                  onClick={() => setPreviewVersion((current) => current + 1)}
                  disabled={isExecuting}
                >
                  Review again
                </button>
              )}
            </div>
          )}

          {receipt && (
            <div
              role="status"
              aria-live="polite"
              className="space-y-1.5 rounded-[4px] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200"
            >
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 size={13} /> {receipt.message}
              </div>
              <div className="text-[10px] text-emerald-200/75">
                {formatBytes(receipt.byteLen)} · integrity check: {receipt.integrityCheck}
              </div>
              {receipt.recoveryPath && (
                <div className="break-all font-mono text-[10px] text-emerald-200/75">
                  Recovery point: {receipt.recoveryPath}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3 sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isExecuting}
            onClick={() => onOpenChange(false)}
          >
            {receipt ? "Done" : "Cancel"}
          </Button>
          {!receipt && (
            <Button
              type="button"
              variant={plan?.risk === "high" ? "destructive" : "default"}
              size="sm"
              disabled={
                !plan ||
                isPreviewing ||
                isExecuting ||
                confirmation !== plan.confirmationText
              }
              onClick={() => void execute()}
            >
              {isExecuting
                ? operation === "backup"
                  ? "Creating backup…"
                  : "Restoring database…"
                : operation === "backup"
                  ? "Create backup"
                  : "Restore database"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
