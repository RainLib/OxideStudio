import { Camera, Database, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSchemaSnapshotTimestamp } from "@/features/schema-diff/model/schemaSnapshotDialog";
import type { SchemaSnapshotDialogController } from "@/features/schema-diff/hooks/useSchemaSnapshotDialog";

interface SchemaSnapshotDialogSidebarProps {
  controller: SchemaSnapshotDialogController;
}

export function SchemaSnapshotDialogSidebar({
  controller,
}: SchemaSnapshotDialogSidebarProps) {
  const {
    busy,
    deletingId,
    isLoading,
    objectLabel,
    pendingDeleteId,
    remove,
    selectedId,
    setPendingDeleteId,
    setSelectedId,
    snapshots,
  } = controller;

  return (
    <section className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[10px]">
              <span className="font-medium">Saved baselines</span>
              <span className="wb-muted">{snapshots.length} versions</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {isLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[10px] wb-muted">
                  <Loader2 size={13} className="animate-spin" /> Loading
                  snapshots
                </div>
              ) : snapshots.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <Camera size={22} className="mb-2 wb-muted" />
                  <div className="text-[11px] font-medium">No baseline yet</div>
                  <div className="mt-1 text-[9px] leading-4 wb-muted">
                    Capture the current live structure, then compare future
                    drift against it.
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
                          {formatSchemaSnapshotTimestamp(snapshot.capturedAt)}
                        </span>
                        <span className="font-mono text-[8px] wb-muted">
                          {snapshot.fingerprint.slice(0, 8)}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[9px] wb-muted">
                        <Database size={9} />
                        {snapshot.relations.length.toLocaleString()}{" "}
                        {objectLabel}
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
  );
}
