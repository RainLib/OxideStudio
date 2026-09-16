import { useSchemaSnapshotDialog } from "@/features/schema-diff/hooks/useSchemaSnapshotDialog";
import type { SchemaSnapshotDialogProps } from "@/features/schema-diff/model/schemaSnapshotDialog";
import { SchemaSnapshotDialogView } from "@/features/schema-diff/ui/SchemaSnapshotDialogView";

export function SchemaSnapshotDialog({
  open,
  identity,
  onClose,
}: SchemaSnapshotDialogProps) {
  const controller = useSchemaSnapshotDialog({ open, identity, onClose });
  if (!identity || !controller) return null;

  return (
    <SchemaSnapshotDialogView
      open={open}
      identity={identity}
      onClose={onClose}
      controller={controller}
    />
  );
}
