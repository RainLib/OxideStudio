import type { useConnectionStore } from "@/store/useConnectionStore";
import {
  composeTableBatchDdl,
  formatTableBatchNamesForClipboard,
  settleTableBatchWork,
  summarizeTableBatchFailures,
} from "@/features/database-explorer/model/tableBatchSelection";
import { loadTableDdl, loadTableMetadata } from "@/services/tableMetadataCache";
import { tableService } from "@/services/tauri";
import type { DatabaseDriver, TableInfo } from "@/services/tauri/types";
import { useTabStore } from "@/store/useTabStore";
import { useTaskStore } from "@/store/useTaskStore";

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

interface CreateExplorerTableBatchActionsContext {
  tableBatchAction: {
    scopeKey: string;
    running: boolean;
    message: string;
    cancelId?: string | undefined;
    failures?:
      | import("@/features/database-explorer/model/tableBatchSelection").TableBatchFailureDetail[]
      | undefined;
    omittedFailures?: number | undefined;
  } | null;
  setTableBatchAction: React.Dispatch<
    React.SetStateAction<{
      scopeKey: string;
      running: boolean;
      message: string;
      cancelId?: string | undefined;
      failures?:
        | import("@/features/database-explorer/model/tableBatchSelection").TableBatchFailureDetail[]
        | undefined;
      omittedFailures?: number | undefined;
    } | null>
  >;
  setActiveConnection: ConnectionState["setActiveConnection"];
  activeProjectId: string;
  bumpMetadataVersion: () => void;
  copyText: (value: string) => Promise<void>;
  setActiveTable: React.Dispatch<React.SetStateAction<string>>;
  setActiveTableType: React.Dispatch<React.SetStateAction<string | null>>;
  setDdlContent: React.Dispatch<React.SetStateAction<string>>;
  setDdlViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function createExplorerTableBatchActions({
  tableBatchAction,
  setTableBatchAction,
  setActiveConnection,
  activeProjectId,
  bumpMetadataVersion,
  copyText,
  setActiveTable,
  setActiveTableType,
  setDdlContent,
  setDdlViewerOpen,
}: CreateExplorerTableBatchActionsContext) {
  const refreshSelectedTableMetadata = async (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    driverPackageVersion?: string | null;
    connectionDatabaseName?: string | null;
    databaseName?: string;
    schema: string;
    tables: string[];
  }) => {
    if (options.tables.length === 0 || tableBatchAction?.running) return;
    setTableBatchAction({
      scopeKey: options.scopeKey,
      running: true,
      message: `Refreshing ${options.tables.length} table${options.tables.length === 1 ? "" : "s"}…`,
    });
    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "introspection",
      title: `Refresh ${options.tables.length} table${options.tables.length === 1 ? "" : "s"}`,
      detail: options.schema,
    });
    try {
      const readinessError = await setActiveConnection(options.connectionId);
      if (readinessError) throw new Error(readinessError);
      const results = await settleTableBatchWork(
        options.tables,
        (table) =>
          loadTableMetadata({
            projectId: activeProjectId || undefined,
            connectionId: options.connectionId,
            driver: options.driver,
            driverPackageVersion: options.driverPackageVersion,
            connectionDatabaseName: options.connectionDatabaseName,
            databaseName: options.databaseName,
            schema: options.schema,
            table,
            includeIndexes: true,
            includeConstraints: true,
            force: true,
            priority: "interactive",
          }),
        6,
      );
      const failureSummary = summarizeTableBatchFailures(
        options.tables,
        results,
      );
      const refreshed = results.length - failureSummary.total;
      bumpMetadataVersion();
      await settleTableBatchWork(
        options.tables,
        (table) =>
          useTabStore
            .getState()
            .refreshTableTabs(
              options.connectionId,
              options.schema,
              table,
              false,
            ),
        6,
      );
      const message = failureSummary.total
        ? `${refreshed} refreshed · ${failureSummary.total} failed`
        : `${refreshed} refreshed`;
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message,
        failures: failureSummary.failures,
        omittedFailures: failureSummary.omitted,
      });
      if (failureSummary.total) {
        tasks.failTask(
          taskId,
          `${failureSummary.total} table metadata refresh${failureSummary.total === 1 ? "" : "es"} failed`,
          message,
        );
      } else {
        tasks.finishTask(taskId, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: `Refresh failed: ${message}`,
      });
      tasks.failTask(taskId, message);
    }
  };

  const exportSelectedTablesSql = async (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    schema: string;
    tables: string[];
  }) => {
    if (options.tables.length === 0 || tableBatchAction?.running) return;
    const exportId = tableService.createTableExportId();
    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "export",
      title: `Export ${options.tables.length} table${options.tables.length === 1 ? "" : "s"} to SQL`,
      detail: options.schema,
    });
    setTableBatchAction({
      scopeKey: options.scopeKey,
      running: true,
      message: "Preparing SQL export…",
      cancelId: exportId,
    });
    let unlisten: (() => void) | undefined;
    try {
      const readinessError = await setActiveConnection(options.connectionId);
      if (readinessError) throw new Error(readinessError);
      unlisten = await tableService.listenTableExportProgress((progress) => {
        if (progress.exportId !== exportId || progress.terminal) return;
        const detail = `${progress.rowsExported.toLocaleString()} rows · ${progress.batches.toLocaleString()} batches`;
        tasks.updateTask(taskId, { detail });
        setTableBatchAction((current) =>
          current?.cancelId === exportId
            ? { ...current, message: detail }
            : current,
        );
      });
      const result = await tableService.exportDatabaseSql(
        options.connectionId,
        options.driver,
        options.schema,
        {
          exportId,
          includeStructure: false,
          includeData: true,
          tableNames: [...options.tables],
        },
      );
      const message = `${result.tablesExported.toLocaleString()} tables · ${result.rowsExported.toLocaleString()} rows`;
      tasks.finishTask(taskId, `${message} · ${result.filePath}`);
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: `${message} exported`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(message)) {
        tasks.cancelTask(taskId, "Export cancelled; partial file removed");
        setTableBatchAction({
          scopeKey: options.scopeKey,
          running: false,
          message: "Export cancelled",
        });
      } else {
        tasks.failTask(taskId, message);
        setTableBatchAction({
          scopeKey: options.scopeKey,
          running: false,
          message: `Export failed: ${message}`,
        });
      }
    } finally {
      unlisten?.();
    }
  };

  const cancelSelectedTableExport = async () => {
    const exportId = tableBatchAction?.cancelId;
    if (!exportId || !tableBatchAction.running) return;
    setTableBatchAction((current) =>
      current?.cancelId === exportId
        ? { ...current, message: "Cancellation requested…" }
        : current,
    );
    await tableService.cancelTableExport(exportId);
  };

  const copySelectedTableNames = async (options: {
    scopeKey: string;
    tables: string[];
  }) => {
    if (options.tables.length === 0 || tableBatchAction?.running) return;
    try {
      await copyText(formatTableBatchNamesForClipboard(options.tables));
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: `${options.tables.length} name${options.tables.length === 1 ? "" : "s"} copied`,
      });
    } catch {
      // copyText owns the user-visible clipboard failure message.
    }
  };

  const showSelectedTableDdl = async (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    driverPackageVersion?: string | null;
    connectionDatabaseName?: string | null;
    databaseName?: string;
    schema: string;
    tables: TableInfo[];
  }) => {
    if (options.tables.length === 0 || tableBatchAction?.running) return;
    setTableBatchAction({
      scopeKey: options.scopeKey,
      running: true,
      message: `Loading DDL for ${options.tables.length} table${options.tables.length === 1 ? "" : "s"}…`,
    });
    try {
      const readinessError = await setActiveConnection(options.connectionId);
      if (readinessError) throw new Error(readinessError);
      const tableNames = options.tables.map((table) => table.name);
      const tableTypes = new Map(
        options.tables.map((table) => [table.name, table.type] as const),
      );
      const results = await settleTableBatchWork(
        tableNames,
        (table) =>
          loadTableDdl(
            {
              projectId: activeProjectId || undefined,
              connectionId: options.connectionId,
              driver: options.driver,
              driverPackageVersion: options.driverPackageVersion,
              connectionDatabaseName: options.connectionDatabaseName,
              databaseName: options.databaseName,
              schema: options.schema,
              table,
            },
            tableTypes.get(table),
          ),
        6,
      );
      const failureSummary = summarizeTableBatchFailures(tableNames, results);
      const ddl = composeTableBatchDdl(options.schema, tableNames, results);
      const loadedCount = results.filter(
        (result) => result.status === "fulfilled" && result.value.trim(),
      ).length;
      if (!ddl) {
        throw new Error("No table DDL could be loaded.");
      }
      setActiveTable(
        `${options.tables.length} selected table${options.tables.length === 1 ? "" : "s"}`,
      );
      setActiveTableType(null);
      setDdlContent(ddl);
      setDdlViewerOpen(true);
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: failureSummary.total
          ? `${loadedCount} DDL loaded · ${failureSummary.total} failed`
          : `${loadedCount} DDL loaded`,
        failures: failureSummary.failures,
        omittedFailures: failureSummary.omitted,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: `DDL failed: ${message}`,
      });
    }
  };

  return {
    refreshSelectedTableMetadata,
    exportSelectedTablesSql,
    cancelSelectedTableExport,
    copySelectedTableNames,
    showSelectedTableDdl,
  };
}
