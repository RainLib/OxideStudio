import { type DataCompareRowStatus } from "@/lib/dataCompare";
import { type TableDataCompareResult } from "@/services/tauri";

export function isSyncStatus(status: DataCompareRowStatus) {
  return (
    status === "leftOnly" || status === "rightOnly" || status === "changed"
  );
}

export function syncRowId(kind: "added" | "removed" | "modified", key: string) {
  if (kind === "added") return `full:left:${key}`;
  if (kind === "removed") return `full:right:${key}`;
  return `full:changed:${key}`;
}

export function allSyncRowIds(comparison: TableDataCompareResult) {
  return new Set([
    ...comparison.added.map((row) => syncRowId("added", row.key)),
    ...comparison.removed.map((row) => syncRowId("removed", row.key)),
    ...comparison.modified.map((row) => syncRowId("modified", row.key)),
  ]);
}

export function selectSyncRows(
  comparison: TableDataCompareResult,
  selectedRows: ReadonlySet<string>,
): TableDataCompareResult {
  const added = comparison.added.filter((row) =>
    selectedRows.has(syncRowId("added", row.key)),
  );
  const removed = comparison.removed.filter((row) =>
    selectedRows.has(syncRowId("removed", row.key)),
  );
  const modified = comparison.modified.filter((row) =>
    selectedRows.has(syncRowId("modified", row.key)),
  );
  return {
    ...comparison,
    added,
    removed,
    modified,
    addedCount: added.length,
    removedCount: removed.length,
    modifiedCount: modified.length,
  };
}
