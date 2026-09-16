import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";

export interface SchemaSnapshotDialogProps {
  open: boolean;
  identity: SchemaSnapshotIdentity | null;
  onClose: () => void;
}

export const ALL_PROJECT_DDL_SOURCES = "__oxide_all_project_sql__";

export function formatSchemaSnapshotTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
