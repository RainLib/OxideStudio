import type { ColumnInfo, TableDataCompareResult, TableInfo } from "@/services/tauri";

export function comparableRelationNames(items: TableInfo[]) {
  return items
    .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
    .map((item) => item.name)
    .sort((left, right) => left.localeCompare(right));
}

export function prepareBatchTableComparison(
  sourceColumns: ColumnInfo[],
  targetColumns: ColumnInfo[],
) {
  const targetColumnNames = new Set(targetColumns.map((column) => column.name));
  const columns = sourceColumns
    .map((column) => column.name)
    .filter((column) => targetColumnNames.has(column));
  const sourceKeys = sourceColumns
    .filter((column) => column.is_primary_key)
    .map((column) => column.name);
  const targetKeys = targetColumns
    .filter((column) => column.is_primary_key)
    .map((column) => column.name);
  const targetKeySet = new Set(targetKeys);
  const keyColumns = sourceKeys.filter((column) => targetKeySet.has(column));
  if (
    keyColumns.length === 0 ||
    keyColumns.length !== sourceKeys.length ||
    keyColumns.length !== targetKeys.length
  ) {
    throw new Error("Both tables need the same complete primary key.");
  }
  if (columns.length === 0) {
    throw new Error("The same-name tables do not share any columns.");
  }
  return { columns, keyColumns };
}

export function tableDataCompareDifferenceCount(result: TableDataCompareResult) {
  return result.addedCount + result.removedCount + result.modifiedCount;
}
