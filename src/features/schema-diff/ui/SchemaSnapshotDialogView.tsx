import { GitCompareArrows } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import type { SchemaSnapshotDialogController } from "@/features/schema-diff/hooks/useSchemaSnapshotDialog";
import { SchemaSnapshotDialogDetails } from "@/features/schema-diff/ui/SchemaSnapshotDialogDetails";
import { SchemaSnapshotDialogFooter } from "@/features/schema-diff/ui/SchemaSnapshotDialogFooter";
import { SchemaSnapshotDialogSidebar } from "@/features/schema-diff/ui/SchemaSnapshotDialogSidebar";

interface SchemaSnapshotDialogViewProps {
  open: boolean;
  identity: SchemaSnapshotIdentity;
  onClose: () => void;
  controller: SchemaSnapshotDialogController;
}

export function SchemaSnapshotDialogView({
  open,
  identity,
  onClose,
  controller,
}: SchemaSnapshotDialogViewProps) {
  const { busy, supportsSchemaReviewPlan } = controller;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}
    >
      <DialogContent layout="custom" className="h-[min(620px,calc(100vh-32px))] w-[min(820px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <GitCompareArrows size={15} />
            </span>
            <div>
              <DialogTitle className="text-[13px] tracking-normal">
                {supportsSchemaReviewPlan ? "Schema" : "Metadata"} snapshots ·{" "}
                {identity.schemaName}
              </DialogTitle>
              <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                {identity.connectionName}
                {identity.databaseName ? ` · ${identity.databaseName}` : ""}
                {identity.tableName
                  ? ` · started from ${identity.schemaName}.${identity.tableName}; the full schema is included so dependencies can be reviewed`
                  : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[310px_minmax(0,1fr)]">
          <SchemaSnapshotDialogSidebar controller={controller} />
          <SchemaSnapshotDialogDetails identity={identity} controller={controller} />
        </div>

        <SchemaSnapshotDialogFooter
          identity={identity}
          onClose={onClose}
          controller={controller}
        />
      </DialogContent>
    </Dialog>
  );
}
