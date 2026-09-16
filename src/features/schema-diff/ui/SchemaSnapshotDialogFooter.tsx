import { Camera, GitCompareArrows, Loader2, Network } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import type { SchemaSnapshotDialogController } from "@/features/schema-diff/hooks/useSchemaSnapshotDialog";

interface SchemaSnapshotDialogFooterProps {
  identity: SchemaSnapshotIdentity;
  onClose: () => void;
  controller: SchemaSnapshotDialogController;
}

export function SchemaSnapshotDialogFooter({
  identity,
  onClose,
  controller,
}: SchemaSnapshotDialogFooterProps) {
  const {
    busy,
    capture,
    compare,
    openDiagram,
    operation,
    selected,
    selectedSupportsRestorePlan,
    supportsRestorePlan,
    supportsSchemaReviewPlan,
  } = controller;

  return (
    <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <button
            type="button"
            className="wb-text-button h-7 gap-1.5 px-3 text-[10px]"
            disabled={busy}
            onClick={() => void capture()}
          >
            {operation === "capture" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Camera size={12} />
            )}
            Capture current {supportsSchemaReviewPlan ? "schema" : "metadata"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="wb-text-button h-7 px-3 text-[10px]"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="wb-text-button h-7 gap-1.5 px-3 text-[10px]"
              disabled={!selected || busy}
              onClick={openDiagram}
            >
              <Network size={12} /> Open diagram
            </button>
            <button
              type="button"
              className="wb-primary-button h-7 min-w-[132px] justify-center gap-1.5 px-3 text-[10px]"
              disabled={!selected || busy}
              title={
                supportsRestorePlan
                  ? "Compare the selected schema snapshot with live metadata"
                  : identity?.driver === "sqlite"
                    ? "Compare the selected schema snapshot and generate a guarded rebuild plan"
                    : "Compare document or search metadata without generating restore commands"
              }
              onClick={() => void compare()}
            >
              {operation === "compare" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <GitCompareArrows size={12} />
              )}
              {selectedSupportsRestorePlan
                ? identity?.driver === "sqlite"
                  ? "Preview rebuild plan"
                  : "Preview restore plan"
                : "Preview metadata diff"}
            </button>
          </div>
        </DialogFooter>
  );
}
