import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Camera,
  Database,
  GitCompareArrows,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  captureAndSaveSchemaSnapshot,
  compareSnapshotToLive,
  deleteSchemaSnapshot,
  listSchemaSnapshots,
  type SchemaSnapshotIdentity,
} from "@/services/schemaSnapshotStore";
import type { SchemaSnapshot } from "@/services/tauri/types";
import { cn } from "@/lib/utils";
import { useTabStore } from "@/store/useTabStore";
import { useTaskStore } from "@/store/useTaskStore";

interface SchemaSnapshotDialogProps {
  open: boolean;
  identity: SchemaSnapshotIdentity | null;
  onClose: () => void;
}

export function SchemaSnapshotDialog({
  open,
  identity,
  onClose,
}: SchemaSnapshotDialogProps) {
  const [snapshots, setSnapshots] = useState<SchemaSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [operation, setOperation] = useState<"capture" | "compare" | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openSchemaDiffTab = useTabStore((state) => state.openSchemaDiffTab);
  const { startTask, finishTask, failTask } = useTaskStore();
  const selected = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedId) || null,
    [selectedId, snapshots],
  );

  useEffect(() => {
    if (!open || !identity) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPendingDeleteId(null);
    void listSchemaSnapshots(identity)
      .then((nextSnapshots) => {
        if (cancelled) return;
        setSnapshots(nextSnapshots);
        setSelectedId(nextSnapshots[0]?.id || null);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, open]);

  if (!identity) return null;

  const capture = async () => {
    if (operation) return;
    const taskId = startTask({
      kind: "introspection",
      title: `Snapshot ${identity.schemaName}`,
      detail: identity.connectionName,
    });
    setOperation("capture");
    setError(null);
    try {
      const snapshot = await captureAndSaveSchemaSnapshot(identity);
      setSnapshots((current) => [
        snapshot,
        ...current.filter((candidate) => candidate.id !== snapshot.id),
      ]);
      setSelectedId(snapshot.id);
      finishTask(
        taskId,
        `${snapshot.relations.length.toLocaleString()} relations captured`,
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
    }
  };

  const compare = async () => {
    if (!selected || operation) return;
    const taskId = startTask({
      kind: "introspection",
      title: `Compare ${identity.schemaName}`,
      detail: "Snapshot → live target",
    });
    setOperation("compare");
    setError(null);
    try {
      const { target, plan } = await compareSnapshotToLive(selected, identity);
      openSchemaDiffTab(plan, selected, target);
      finishTask(
        taskId,
        `${plan.summary.total.toLocaleString()} schema changes found`,
      );
      onClose();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
    }
  };

  const remove = async (snapshot: SchemaSnapshot) => {
    if (operation || deletingId) return;
    if (pendingDeleteId !== snapshot.id) {
      setPendingDeleteId(snapshot.id);
      return;
    }
    setDeletingId(snapshot.id);
    setError(null);
    try {
      await deleteSchemaSnapshot(snapshot);
      const remaining = snapshots.filter((candidate) => candidate.id !== snapshot.id);
      setSnapshots(remaining);
      if (selectedId === snapshot.id) {
        setSelectedId(remaining[0]?.id || null);
      }
      setPendingDeleteId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setDeletingId(null);
    }
  };

  const busy = Boolean(operation || deletingId);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent className="h-[min(620px,calc(100vh-32px))] w-[min(820px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <GitCompareArrows size={15} />
            </span>
            <div>
              <DialogTitle className="text-[13px] tracking-normal">
                Schema snapshots · {identity.schemaName}
              </DialogTitle>
              <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                {identity.connectionName}
                {identity.databaseName ? ` · ${identity.databaseName}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[310px_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[10px]">
              <span className="font-medium">Saved baselines</span>
              <span className="wb-muted">{snapshots.length} versions</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {isLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[10px] wb-muted">
                  <Loader2 size={13} className="animate-spin" /> Loading snapshots
                </div>
              ) : snapshots.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <Camera size={22} className="mb-2 wb-muted" />
                  <div className="text-[11px] font-medium">No baseline yet</div>
                  <div className="mt-1 text-[9px] leading-4 wb-muted">
                    Capture the current live structure, then compare future drift against it.
                  </div>
                </div>
              ) : (
                snapshots.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className={cn(
                      "mb-1 flex w-full items-stretch overflow-hidden rounded-[4px] border transition-colors",
                      selectedId === snapshot.id
                        ? "border-[hsl(var(--wb-accent)/0.48)] bg-[hsl(var(--wb-active-strong))]"
                        : "border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.42)] hover:bg-[hsl(var(--wb-hover))]",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-2.5 py-2 text-left"
                      onClick={() => {
                        setSelectedId(snapshot.id);
                        setPendingDeleteId(null);
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium">
                          {formatTimestamp(snapshot.capturedAt)}
                        </span>
                        <span className="font-mono text-[8px] wb-muted">
                          {snapshot.fingerprint.slice(0, 8)}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[9px] wb-muted">
                        <Database size={9} />
                        {snapshot.relations.length.toLocaleString()} relations
                      </span>
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex w-11 shrink-0 items-center justify-center border-l border-[hsl(var(--wb-border-subtle))] text-[8px] transition-colors",
                        pendingDeleteId === snapshot.id
                          ? "bg-red-400/10 text-red-300"
                          : "wb-muted hover:bg-red-400/10 hover:text-red-300",
                      )}
                      aria-label={
                        pendingDeleteId === snapshot.id
                          ? "Confirm delete schema snapshot"
                          : "Delete schema snapshot"
                      }
                      title={
                        pendingDeleteId === snapshot.id
                          ? "Click again to delete"
                          : "Delete snapshot"
                      }
                      disabled={busy}
                      onClick={() => void remove(snapshot)}
                    >
                      {deletingId === snapshot.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : pendingDeleteId === snapshot.id ? (
                        "Delete"
                      ) : (
                        <Trash2 size={11} />
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col bg-[hsl(var(--wb-editor))] p-4">
            <div className="text-[11px] font-medium">Comparison direction</div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-center gap-2">
              <TargetCard
                eyebrow="Desired source"
                title={selected ? `Snapshot ${formatTimestamp(selected.capturedAt)}` : "Select a snapshot"}
                detail={selected ? selected.fingerprint.slice(0, 12) : "No baseline selected"}
              />
              <div className="text-center text-[16px] text-[hsl(var(--wb-accent))]">→</div>
              <TargetCard
                eyebrow="Actual target"
                title="Fresh live capture"
                detail={`${identity.connectionName} / ${identity.schemaName}`}
              />
            </div>

            <div className="mt-4 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.4)] p-3 text-[9px] leading-4 wb-muted">
              The generated plan describes how to make the live target match the selected snapshot. It opens as a read-only artifact first. OxideStudio does not execute migration SQL from this dialog.
            </div>

            {selected && (
              <div className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[10px]">
                <span className="wb-muted">Captured</span>
                <span>{formatTimestamp(selected.capturedAt)}</span>
                <span className="wb-muted">Relations</span>
                <span>{selected.relations.length.toLocaleString()}</span>
                <span className="wb-muted">Driver</span>
                <span>{selected.driver}</span>
                <span className="wb-muted">Fingerprint</span>
                <span className="break-all font-mono text-[9px]">{selected.fingerprint}</span>
              </div>
            )}

            {error && (
              <div className="mt-auto flex items-start gap-2 rounded-[4px] border border-red-400/20 bg-red-400/5 px-2.5 py-2 text-[10px] text-red-300" role="alert">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <button
            type="button"
            className="wb-text-button h-7 gap-1.5 px-3 text-[10px]"
            disabled={busy}
            onClick={() => void capture()}
          >
            {operation === "capture" ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
            Capture current schema
          </button>
          <div className="flex gap-2">
            <button type="button" className="wb-text-button h-7 px-3 text-[10px]" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="wb-primary-button h-7 min-w-[132px] justify-center gap-1.5 px-3 text-[10px]"
              disabled={!selected || busy}
              onClick={() => void compare()}
            >
              {operation === "compare" ? <Loader2 size={12} className="animate-spin" /> : <GitCompareArrows size={12} />}
              Preview restore plan
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TargetCard({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.46)] px-3 py-3">
      <div className="text-[8px] uppercase tracking-[0.13em] wb-muted">{eyebrow}</div>
      <div className="mt-1.5 truncate text-[10px] font-medium" title={title}>{title}</div>
      <div className="mt-1 truncate font-mono text-[8px] wb-muted" title={detail}>{detail}</div>
    </div>
  );
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
