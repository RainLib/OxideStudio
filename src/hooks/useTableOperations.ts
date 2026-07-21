import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { tableService } from "@/services/tauri";
import type {
  TableExportFormat,
  TableImportFormat,
} from "@/services/tauri/types";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { useTaskStore } from "@/store/useTaskStore";
import {
  invalidateTableMetadata,
  loadTableDdl,
  loadViewDefinition,
} from "@/services/tableMetadataCache";

export function useTableOperations() {
  const { activeConnectionId, connections } = useConnectionStore();
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const loadTables = useSchemaStore((state) => state.loadTables);

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
        .refreshTableTabs(activeConnectionId, currentSchema, tableName, false);
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
      await Promise.all([
        invalidateTableMetadata({
          connectionId: activeConnectionId,
          driver,
          schema: currentSchema,
          table: oldName,
        }),
        invalidateTableMetadata({
          connectionId: activeConnectionId,
          driver,
          schema: currentSchema,
          table: newName,
        }),
      ]);
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
      await invalidateTableMetadata({
        connectionId: activeConnectionId,
        driver,
        schema: currentSchema,
        table: tableName,
      });
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

  const importTableData = async (
    tableName: string,
    format: TableImportFormat,
  ) => {
    if (!activeConnectionId || !currentSchema) return;
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        format === "csv"
          ? { name: "CSV data", extensions: ["csv"] }
          : { name: "JSON data", extensions: ["json", "jsonl", "ndjson"] },
      ],
    });
    if (typeof selected !== "string") return;
    const confirmed = window.confirm(
      `Import ${format.toUpperCase()} rows into "${tableName}"?\n\nExisting rows are not replaced. Each imported record will be inserted as a new row.`,
    );
    if (!confirmed) return;

    const driver = getDriver();
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "import",
      title: `Import ${tableName}`,
      detail: format.toUpperCase(),
    });

    try {
      const imported = await tableService.importTableData(
        activeConnectionId,
        driver,
        currentSchema,
        tableName,
        selected,
        format,
      );
      taskStore.finishTask(
        taskId,
        `${imported.rowsImported.toLocaleString()} rows imported`,
      );
      await useTabStore
        .getState()
        .refreshTableTabs(
          activeConnectionId,
          currentSchema,
          tableName,
          false,
        );
    } catch (error: any) {
      taskStore.failTask(taskId, error?.message || String(error));
      throw error;
    }
  };

  const getTableDdl = async (
    tableName: string,
    objectType?: string | null
  ): Promise<string> => {
    if (!activeConnectionId || !currentSchema) return "";
    const driver = getDriver();

    try {
      return await loadTableDdl(
        {
          connectionId: activeConnectionId,
          driver,
          schema: currentSchema,
          table: tableName,
        },
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

    return loadViewDefinition(
      {
        connectionId: activeConnectionId,
        driver,
        schema: currentSchema,
        table: viewName,
      },
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
    importTableData,
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
