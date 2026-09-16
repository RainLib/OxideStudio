import { hasPendingTableChanges } from "@/features/workspace-tabs/model/tabLifecycle";
import { TabData } from "@/features/workspace-tabs/model/types";
import type { DataCompareSource } from "@/lib/dataCompare";

export function dataCompareSourceFromTab(
  tab: TabData,
  capturedAt = Date.now(),
): DataCompareSource | null {
  if (!canCreateDataCompareSource(tab)) return null;
  const resultIndex = tab.type === "table" ? 0 : tab.activeResultIndex || 0;
  const result = tab.results![resultIndex]!;
  const primaryKeys = (tab.tableColumns || [])
    .filter((column) => column.is_primary_key)
    .map((column) => column.name)
    .filter((column) =>
      result.columns.some((candidate) => candidate.name === column),
    );
  return {
    id: `${tab.id}:${resultIndex}:${capturedAt}`,
    tabId: tab.id,
    label: tab.title,
    sourceKind: tab.type === "table" ? "table" : "query",
    resultIndex,
    page: tab.type === "table" ? tab.tablePage || 1 : undefined,
    connectionId: tab.connectionId,
    databaseName: tab.databaseName,
    schemaName: tab.schemaName,
    objectName: tab.tableName,
    columns: result.columns.map((column) => ({
      name: column.name,
      dataType: column.data_type,
    })),
    rows: result.rows.map((row) => row.map(cloneDataCompareValue)),
    suggestedKeyColumns: primaryKeys,
    truncated: Boolean(result.truncated),
    rowLimit: result.rowLimit,
    capturedAt,
  };
}

export function canCreateDataCompareSource(tab: TabData) {
  if (tab.type !== "query" && tab.type !== "table") return false;
  if (tab.isExecuting || hasPendingTableChanges(tab)) return false;
  const resultIndex = tab.type === "table" ? 0 : tab.activeResultIndex || 0;
  return Boolean(tab.results?.[resultIndex]?.columns.length);
}

export function cloneDataCompareValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneDataCompareValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cloneDataCompareValue(item),
      ]),
    );
  }
  return value;
}
