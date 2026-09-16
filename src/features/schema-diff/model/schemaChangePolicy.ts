import type { SchemaChange } from "@/services/tauri/types";

export function isDescriptorOnlySchemaObjectChange(change: SchemaChange) {
  return (
    (change.kind === "schemaObjectCreate" ||
      change.kind === "schemaObjectDrop" ||
      change.kind === "schemaObjectModify") &&
    change.sql.length === 0
  );
}

export function isCatalogBackedObjectChange(change: SchemaChange) {
  return (
    (change.kind === "routineCreate" ||
      change.kind === "routineModify" ||
      change.kind === "schemaObjectCreate" ||
      change.kind === "schemaObjectModify") &&
    change.sql.length > 0 &&
    change.manualReview
  );
}
