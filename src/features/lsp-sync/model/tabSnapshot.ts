import { type LspSyncTab } from "@/services/lsp/syncPlan";
import { type TabData } from "@/store/useTabStore";

export function lspTabSnapshot(tabs: TabData[]): LspSyncTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    type: tab.type,
    connectionId: tab.connectionId,
    databaseName: tab.databaseName,
    targetSchema: tab.targetSchema,
    schemaName: tab.schemaName,
    tableName: tab.tableName,
    sql: tab.sql,
  }));
}

export function lspTabSnapshotsEqual(
  left: readonly LspSyncTab[],
  right: readonly LspSyncTab[],
) {
  if (left.length !== right.length) return false;
  return left.every((tab, index) => {
    const candidate = right[index];
    return Boolean(
      candidate &&
        tab.id === candidate.id &&
        tab.type === candidate.type &&
        tab.connectionId === candidate.connectionId &&
        tab.databaseName === candidate.databaseName &&
        tab.targetSchema === candidate.targetSchema &&
        tab.schemaName === candidate.schemaName &&
        tab.tableName === candidate.tableName &&
        tab.sql === candidate.sql,
    );
  });
}

export function lspTabStructuresEqual(
  left: readonly LspSyncTab[],
  right: readonly LspSyncTab[],
) {
  if (left.length !== right.length) return false;
  return left.every((tab, index) => {
    const candidate = right[index];
    return Boolean(
      candidate &&
        tab.id === candidate.id &&
        tab.type === candidate.type &&
        tab.connectionId === candidate.connectionId &&
        tab.databaseName === candidate.databaseName &&
        tab.targetSchema === candidate.targetSchema &&
        tab.schemaName === candidate.schemaName &&
        tab.tableName === candidate.tableName,
    );
  });
}
