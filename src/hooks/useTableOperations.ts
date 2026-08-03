import { useConnectionStore } from "@/store/useConnectionStore";
import { useEffect, useRef, useState } from "react";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";
import { tableService } from "@/services/tauri";
import type {
  TableExportFormat,
  TableExportEncoding,
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
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeTableExportRef = useRef<{
    exportId: string;
    taskId: string;
    tableName: string;
  } | null>(null);
  const [activeTableExport, setActiveTableExport] = useState<{
    exportId: string;
    taskId: string;
    tableName: string;
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tableService
      .listenTableExportProgress((progress) => {
        const activeExport = activeTableExportRef.current;
        if (!activeExport || activeExport.exportId !== progress.exportId) return;
        useTaskStore.getState().updateTask(activeExport.taskId, {
          detail: progress.message
            ? `${progress.rowsExported.toLocaleString()} rows in ${progress.batches.toLocaleString()} batches · ${progress.message}`
            : `${progress.rowsExported.toLocaleString()} rows in ${progress.batches.toLocaleString()} batches`,
        });
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error) => {
        console.error("Failed to listen for Explorer export progress:", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
    format: TableExportFormat = "csv",
    encoding: TableExportEncoding = "utf8",
  ) => {
    if (!activeConnectionId || !currentSchema || activeTableExportRef.current) return;
    const driver = getDriver();
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "export",
      title: `Export ${tableName}`,
      detail: format.toUpperCase(),
    });
    const exportId = tableService.createTableExportId();
    const exportTask = { exportId, taskId, tableName };
    activeTableExportRef.current = exportTask;
    setActiveTableExport(exportTask);

    try {
      const exported = await tableService.exportTableData(
        activeConnectionId,
        driver,
        currentSchema,
        tableName,
        format,
        { exportId, projectId: activeProjectId, encoding },
      );
      console.log(
        `Exported ${exported.rowsExported} rows from ${tableName} to ${exported.filePath}`
      );
      taskStore.finishTask(
        taskId,
        `${exported.rowsExported.toLocaleString()} rows to ${format.toUpperCase()}`
      );
      await revealItemInDir(exported.filePath);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code === "TABLE_EXPORT_CANCELLED") {
        taskStore.cancelTask(taskId, "Export cancelled; partial file removed");
      } else {
        taskStore.failTask(
          taskId,
          error instanceof Error ? error.message : String(error),
        );
        console.error("Export failed:", error);
      }
    } finally {
      if (activeTableExportRef.current?.exportId === exportId) {
        activeTableExportRef.current = null;
        setActiveTableExport(null);
      }
    }
  };

  const cancelActiveTableExport = async () => {
    const activeExport = activeTableExportRef.current;
    if (!activeExport) return;
    useTaskStore
      .getState()
      .updateTask(activeExport.taskId, { detail: "Cancellation requested…" });
    try {
      await tableService.cancelTableExport(activeExport.exportId);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "TABLE_EXPORT_NOT_FOUND") {
        console.error("Failed to cancel Explorer export:", error);
      }
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
        true,
        undefined,
        undefined,
        undefined,
        { projectId: activeProjectId },
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
    activeTableExport,
    cancelActiveTableExport,
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
