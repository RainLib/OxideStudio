import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import { tableService } from "@/services/tauri";
import type {
  SqlInsertConflictPolicy,
  TableExportEncoding,
  TableExportFormat,
} from "@/services/tauri/types";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

interface TableExportActionsContext {
  tabConnectionId: string | null;
  activeTab: import("@/store/useTabStore").TabData;
  activeTableExportRef: React.RefObject<{
    exportId: string;
    taskId: string;
  } | null>;
  isCrossDatabasePreview: boolean;
  isNativeObjectPreview: boolean;
  tableExportFormats: import("@/services/tauri/types").DatabaseTableExportFormat[];
  startTask: (
    task: Pick<import("@/store/useTaskStore").WorkbenchTask, "title" | "kind"> &
      Partial<
        Pick<
          import("@/store/useTaskStore").WorkbenchTask,
          "progress" | "detail"
        >
      >,
  ) => string;
  setActiveTableExport: React.Dispatch<
    React.SetStateAction<{ exportId: string; taskId: string } | null>
  >;
  driver: import("@/services/tauri/types").DatabaseDriver;
  activeProjectId: string;
  finishTask: (id: string, detail?: string | null | undefined) => void;
  setRecentExportReport: React.Dispatch<
    React.SetStateAction<
      import("@/services/tauri/types").TableExportReport | null
    >
  >;
  cancelTask: (id: string, detail?: string | null | undefined) => void;
  failTask: (
    id: string,
    error: string,
    detail?: string | null | undefined,
  ) => void;
  updateTask: (
    id: string,
    updates: Partial<
      Pick<
        import("@/store/useTaskStore").WorkbenchTask,
        "progress" | "title" | "detail"
      >
    >,
  ) => void;
}

export function createTableExportActions({
  tabConnectionId,
  activeTab,
  activeTableExportRef,
  isCrossDatabasePreview,
  isNativeObjectPreview,
  tableExportFormats,
  startTask,
  setActiveTableExport,
  driver,
  activeProjectId,
  finishTask,
  setRecentExportReport,
  cancelTask,
  failTask,
  updateTask,
}: TableExportActionsContext) {
  const handleExport = async (
    format: TableExportFormat,
    encoding: TableExportEncoding = "utf8",
    sqlInsertBatchSize?: number,
    sqlInsertConflictPolicy: SqlInsertConflictPolicy = "strict",
    maxRows?: number,
    xlsxAutoFilter?: boolean,
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      activeTab.isExecuting ||
      activeTableExportRef.current ||
      isCrossDatabasePreview ||
      isNativeObjectPreview ||
      !tableExportFormats.includes(format)
    ) {
      return;
    }

    const sort =
      activeTab.gridState?.sortColumn && activeTab.gridState?.sortDirection
        ? {
            column: activeTab.gridState.sortColumn,
            direction: activeTab.gridState.sortDirection,
          }
        : undefined;

    const taskId = startTask({
      kind: "export",
      title: `Export ${activeTab.tableName}`,
      detail: maxRows
        ? `${format.toUpperCase()} (first ${maxRows.toLocaleString()} rows)`
        : `${format.toUpperCase()} (all matching rows)`,
    });
    const exportId = tableService.createTableExportId();
    const exportTask = { exportId, taskId };
    activeTableExportRef.current = exportTask;
    setActiveTableExport(exportTask);

    try {
      const exported = await tableService.exportTableData(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        format,
        {
          exportId,
          projectId: activeProjectId,
          encoding,
          sqlInsertBatchSize,
          sqlInsertConflictPolicy,
          xlsxAutoFilter,
        },
        activeTab.tableFilterSql || undefined,
        activeTab.tableFilters || undefined,
        sort,
        undefined,
        maxRows,
      );
      const coercionPreview = exported.typeCoercions
        .slice(0, 3)
        .map(
          (coercion) =>
            `${coercion.column} (${coercion.sourceType}→${coercion.outputType})`,
        )
        .join(", ");
      const remainingCoercions = Math.max(0, exported.typeCoercions.length - 3);
      const coercionDetail =
        exported.typeCoercions.length > 0
          ? `; UTF-8 with source metadata: ${coercionPreview}${remainingCoercions > 0 ? ` +${remainingCoercions.toLocaleString()} more` : ""}`
          : "";
      finishTask(
        taskId,
        `${exported.rowsExported.toLocaleString()} rows to ${format.toUpperCase()}${maxRows ? ` (first ${maxRows.toLocaleString()} requested)` : ""}${coercionDetail}`,
      );
      if (exported.reportId && activeProjectId) {
        void tableService
          .listTableExportReports(activeProjectId, tabConnectionId, 20)
          .then((reports) => {
            const report = reports.find(
              (item) => item.id === exported.reportId,
            );
            if (report) setRecentExportReport(report);
          })
          .catch(() => undefined);
      }
      await revealItemInDir(exported.filePath);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      const message = error instanceof Error ? error.message : String(error);
      if (code === "TABLE_EXPORT_CANCELLED") {
        cancelTask(taskId, "Export cancelled; partial file removed");
      } else {
        failTask(taskId, message);
        console.error("Table export failed:", error);
      }
    } finally {
      if (activeTableExportRef.current?.exportId === exportId) {
        activeTableExportRef.current = null;
        setActiveTableExport(null);
      }
    }
  };

  const handleCancelExport = async () => {
    const activeExport = activeTableExportRef.current;
    if (!activeExport) return;
    updateTask(activeExport.taskId, { detail: "Cancellation requested…" });
    try {
      await tableService.cancelTableExport(activeExport.exportId);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "TABLE_EXPORT_NOT_FOUND") {
        console.error("Failed to cancel table export:", error);
      }
    }
  };

  const handleExportDatabaseSql = async (
    scope: "all" | "structure" | "data",
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.schemaName ||
      activeTab.isExecuting ||
      activeTableExportRef.current ||
      isCrossDatabasePreview ||
      isNativeObjectPreview ||
      normalizeDatabaseDriverName(driver) !== "postgres"
    ) {
      return;
    }
    const includeStructure = scope !== "data";
    const includeData = scope !== "structure";
    const scopeLabel =
      includeStructure && includeData
        ? "relation structure and data"
        : includeStructure
          ? "relation structure only"
          : "relation data only (the target structure must already exist)";
    const confirmed = window.confirm(
      `Back up all base relations in schema "${activeTab.schemaName}" to one SQL file?\n\nThis export includes ${scopeLabel} and restores in one PostgreSQL transaction. Sequences are created before relation defaults and their values are restored after data; foreign keys are applied last. Views, materialized views, routines, extensions, grants, and sequence ownership are not included.`,
    );
    if (!confirmed) return;

    const taskId = startTask({
      kind: "export",
      title: `Back up ${activeTab.schemaName}`,
      detail: `PostgreSQL ${scopeLabel}`,
    });
    const exportId = tableService.createTableExportId();
    const exportTask = { exportId, taskId };
    activeTableExportRef.current = exportTask;
    setActiveTableExport(exportTask);
    try {
      const exported = await tableService.exportDatabaseSql(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        { exportId, includeStructure, includeData },
      );
      finishTask(
        taskId,
        `${exported.tablesExported.toLocaleString()} relations, ${exported.rowsExported.toLocaleString()} rows; ${exported.omittedObjectKinds.length.toLocaleString()} object kinds omitted`,
      );
      await revealItemInDir(exported.filePath);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      const message = error instanceof Error ? error.message : String(error);
      if (code === "TABLE_EXPORT_CANCELLED") {
        cancelTask(taskId, "Backup cancelled; partial file removed");
      } else {
        failTask(taskId, message);
        console.error("PostgreSQL schema backup failed:", error);
      }
    } finally {
      if (activeTableExportRef.current?.exportId === exportId) {
        activeTableExportRef.current = null;
        setActiveTableExport(null);
      }
    }
  };

  return { handleExport, handleCancelExport, handleExportDatabaseSql };
}
