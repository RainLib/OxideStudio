import { saveGridLayout, type GridLayoutScope } from "@/features/data-grid";
import { TabData } from "@/features/workspace-tabs/model/types";

export function gridLayoutScopeForTab(tab: TabData): GridLayoutScope {
  return {
    type: tab.type,
    connectionId: tab.connectionId,
    databaseName: tab.databaseName,
    schemaName: tab.schemaName,
    tableName: tab.tableName,
    queryLanguage: tab.queryLanguage,
    sql: tab.sql,
  };
}

export function saveTabGridLayout(tab: TabData) {
  saveGridLayout(gridLayoutScopeForTab(tab), {
    columnWidths: tab.columnWidths || {},
    columnOrder: tab.columnOrder || [],
    hiddenColumns: tab.hiddenColumns || [],
    frozenColumnCount: tab.frozenColumnCount || 0,
  });
}
