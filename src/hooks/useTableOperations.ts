import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { tableService } from "@/services/tauri";
import type { TableExportFormat } from "@/services/tauri/types";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { useTaskStore } from "@/store/useTaskStore";

export function useTableOperations() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { currentSchema, loadTables } = useSchemaStore();

  const getDriver = () => {
    const conn = connections.find((c) => c.id === activeConnectionId);
    return conn?.driver || DEFAULT_DATABASE_DRIVER;
  };

  const truncateTable = async (tableName: string) => {
    if (!activeConnectionId || !currentSchema) return;
    const driver = getDriver();

    try {
      await tableService.truncateTable(
        activeConnectionId,
        driver,
        currentSchema,
        tableName
      );
      await loadTables(activeConnectionId, currentSchema, true);
      await useTabStore
        .getState()
        .refreshTableTabs(activeConnectionId, currentSchema, tableName);
      // toast.success(`Table ${tableName} truncated successfully`);
      console.log(`Table ${tableName} truncated successfully`);
    } catch (e: any) {
      console.error(e);
      // toast.error(`Failed to truncate table: ${e.message}`);
    }
  };

  const renameTable = async (
    oldName: string,
    newName: string,
    objectType?: string | null
  ) => {
    if (!activeConnectionId || !currentSchema) return;
    const driver = getDriver();

    try {
      await tableService.renameTable(
        activeConnectionId,
        driver,
        currentSchema,
        oldName,
        newName,
        objectType
      );
      console.log(`Table renamed from ${oldName} to ${newName}`);
      await loadTables(activeConnectionId, currentSchema, true);
      useTabStore
        .getState()
        .retargetTableTabs(
          activeConnectionId,
          currentSchema,
          oldName,
          newName,
          objectType
        );
      await useTabStore
        .getState()
        .refreshTableTabs(activeConnectionId, currentSchema, newName);
    } catch (e: any) {
      console.error(e);
      throw e; // Let dialog handle error
    }
  };

  const dropTable = async (tableName: string, objectType?: string | null) => {
    if (!activeConnectionId || !currentSchema) return;
    const driver = getDriver();

    try {
      await tableService.dropTable(
        activeConnectionId,
        driver,
        currentSchema,
        tableName,
        true,
        objectType
      );
      await loadTables(activeConnectionId, currentSchema, true);
      closeOpenTableTabs(activeConnectionId, currentSchema, tableName);
      console.log(`Table ${tableName} dropped successfully`);
    } catch (e: any) {
      console.error(e);
    }
  };

  const exportTableData = async (
    tableName: string,
    format: TableExportFormat = "csv"
  ) => {
    if (!activeConnectionId || !currentSchema) return;
    const driver = getDriver();
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "export",
      title: `Export ${tableName}`,
      detail: format.toUpperCase(),
    });

    try {
      const exported = await tableService.exportTableData(
        activeConnectionId,
        driver,
        currentSchema,
        tableName,
        format
      );
      console.log(
        `Exported ${exported.rowsExported} rows from ${tableName} to ${exported.filePath}`
      );
      taskStore.finishTask(
        taskId,
        `${exported.rowsExported.toLocaleString()} rows to ${format.toUpperCase()}`
      );
      await revealItemInDir(exported.filePath);
    } catch (e: any) {
      taskStore.failTask(taskId, e?.message || String(e));
      console.error("Export failed:", e);
    }
  };

  const getTableDdl = async (
    tableName: string,
    objectType?: string | null
  ): Promise<string> => {
    if (!activeConnectionId || !currentSchema) return "";
    const driver = getDriver();

    try {
      return await tableService.getTableDdl(
        activeConnectionId,
        driver,
        currentSchema,
        tableName,
        objectType
      );
    } catch (e) {
      console.error(e);
      return `-- Failed to fetch DDL: ${e}`;
    }
  };

  const getViewDefinition = async (
    viewName: string,
    objectType?: string | null
  ): Promise<string> => {
    if (!activeConnectionId || !currentSchema) return "";
    const driver = getDriver();

    return tableService.getViewDefinition(
      activeConnectionId,
      driver,
      currentSchema,
      viewName,
      objectType
    );
  };

  const refreshMaterializedView = async (
    viewName: string,
    objectType?: string | null
  ) => {
    if (!activeConnectionId || !currentSchema) return;
    const driver = getDriver();

    await tableService.refreshMaterializedView(
      activeConnectionId,
      driver,
      currentSchema,
      viewName,
      objectType
    );
  };

  return {
    truncateTable,
    dropTable,
    renameTable,
    exportTableData,
    getTableDdl,
    getViewDefinition,
    refreshMaterializedView,
  };
}

function closeOpenTableTabs(
  connectionId: string,
  schema: string,
  tableName: string
) {
  const tabStore = useTabStore.getState();
  for (const tab of tabStore.tabs) {
    if (
      tab.type === "table" &&
      tab.connectionId === connectionId &&
      tab.schemaName === schema &&
      tab.tableName === tableName
    ) {
      tabStore.forceCloseTab(tab.id);
    }
  }
}
