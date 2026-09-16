import { tableService } from "@/services/tauri";
import type {
  TableCsvImportOptions,
  TableImportMode,
} from "@/services/tauri/types";
import { confirmDiscardTableChanges, useTabStore } from "@/store/useTabStore";

interface TableImportActionsContext {
  tabConnectionId: string | null;
  activeTab: import("@/store/useTabStore").TabData;
  isTableReadOnly: boolean;
  isCsvImportSubmitting: boolean;
  csvImportSource: {
    file: File;
    nativePath?: string | undefined;
    previewTruncated?: boolean | undefined;
    contentDigest?: string | undefined;
  } | null;
  startTask: (
    task: Pick<import("@/store/useTaskStore").WorkbenchTask, "title" | "kind"> &
      Partial<
        Pick<
          import("@/store/useTaskStore").WorkbenchTask,
          "progress" | "detail"
        >
      >,
  ) => string;
  setIsCsvImportSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  updateTask: (
    id: string,
    updates: Partial<
      Pick<
        import("@/store/useTaskStore").WorkbenchTask,
        "progress" | "title" | "detail"
      >
    >,
  ) => void;
  driver: import("@/services/tauri/types").DatabaseDriver;
  activeTableImportsRef: React.RefObject<Map<string, string>>;
  setActiveCsvImportId: React.Dispatch<React.SetStateAction<string | null>>;
  activeProjectId: string;
  cancelTask: (id: string, detail?: string | null | undefined) => void;
  failTask: (
    id: string,
    error: string,
    detail?: string | null | undefined,
  ) => void;
  setIsCsvImportCancelling: React.Dispatch<React.SetStateAction<boolean>>;
  finishTask: (id: string, detail?: string | null | undefined) => void;
  setCsvImportSource: React.Dispatch<
    React.SetStateAction<{
      file: File;
      nativePath?: string | undefined;
      previewTruncated?: boolean | undefined;
      contentDigest?: string | undefined;
    } | null>
  >;
  loadTablePage: import("@/features/workspace-tabs/model/types").TabState["loadTablePage"];
  page: number;
  activeCsvImportId: string | null;
  isCsvImportCancelling: boolean;
  isJsonImportSubmitting: boolean;
  jsonImportSource: {
    nativePath: string;
    preview: import("@/services/tauri/types").TableJsonImportPreview;
  } | null;
  setIsJsonImportSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  setJsonImportSource: React.Dispatch<
    React.SetStateAction<{
      nativePath: string;
      preview: import("@/services/tauri/types").TableJsonImportPreview;
    } | null>
  >;
  isXlsxImportSubmitting: boolean;
  xlsxImportSource: {
    nativePath: string;
    preview: import("@/services/tauri/types").TableXlsxImportPreview;
  } | null;
  setIsXlsxImportSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  setXlsxImportSource: React.Dispatch<
    React.SetStateAction<{
      nativePath: string;
      preview: import("@/services/tauri/types").TableXlsxImportPreview;
    } | null>
  >;
}

export function createTableImportActions({
  tabConnectionId,
  activeTab,
  isTableReadOnly,
  isCsvImportSubmitting,
  csvImportSource,
  startTask,
  setIsCsvImportSubmitting,
  updateTask,
  driver,
  activeTableImportsRef,
  setActiveCsvImportId,
  activeProjectId,
  cancelTask,
  failTask,
  setIsCsvImportCancelling,
  finishTask,
  setCsvImportSource,
  loadTablePage,
  page,
  activeCsvImportId,
  isCsvImportCancelling,
  isJsonImportSubmitting,
  jsonImportSource,
  setIsJsonImportSubmitting,
  setJsonImportSource,
  isXlsxImportSubmitting,
  xlsxImportSource,
  setIsXlsxImportSubmitting,
  setXlsxImportSource,
}: TableImportActionsContext) {
  const handleImportCsvRows = async (
    rows: Array<Record<string, unknown>>,
    csvOptions: TableCsvImportOptions,
    _sourceEncoding: string,
    mode: TableImportMode,
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      activeTab.isExecuting ||
      isTableReadOnly ||
      isCsvImportSubmitting ||
      !csvImportSource
    ) {
      return;
    }
    const taskId = startTask({
      kind: "import",
      title: `Import ${csvImportSource.file.name}`,
      detail: activeTab.tableName,
    });
    setIsCsvImportSubmitting(true);
    updateTask(taskId, {
      detail: `${rows.length.toLocaleString()} rows validated; committing transaction`,
    });
    let rowsImported = rows.length;
    let nativeImportId: string | null = null;
    try {
      if (csvImportSource.nativePath) {
        updateTask(taskId, { detail: "Running full-file CSV preflight" });
        const preflight = await tableService.preflightTableCsvImport(
          tabConnectionId,
          driver,
          activeTab.schemaName,
          activeTab.tableName,
          csvImportSource.nativePath,
          csvOptions.firstRowHeader ?? true,
          activeTab.databaseName,
          csvOptions,
          csvImportSource.contentDigest,
          mode,
        );
        if (preflight.rejectedRows > 0) {
          const locations = preflight.issues
            .slice(0, 5)
            .map((issue) => issue.rowNumber)
            .join(", ");
          throw new Error(
            `CSV preflight rejected ${preflight.rejectedRows.toLocaleString()} row(s)${locations ? ` (for example: ${locations})` : ""}. Strict import was not started.`,
          );
        }
        updateTask(taskId, {
          detail: `${preflight.acceptedRows.toLocaleString()} rows preflighted; committing transaction`,
        });
        const importId = tableService.createTableImportId();
        nativeImportId = importId;
        activeTableImportsRef.current.set(importId, taskId);
        setActiveCsvImportId(importId);
        const imported = await tableService.importTableData(
          tabConnectionId,
          driver,
          activeTab.schemaName,
          activeTab.tableName,
          csvImportSource.nativePath,
          "csv",
          csvOptions.firstRowHeader ?? true,
          activeTab.databaseName,
          csvOptions,
          csvImportSource.contentDigest,
          { projectId: activeProjectId, importId, mode },
        );
        rowsImported = imported.rowsImported;
      } else if (activeTab.databaseName) {
        await tableService.mutateTableRows(
          tabConnectionId,
          driver,
          activeTab.schemaName,
          activeTab.tableName,
          rows,
          [],
          [],
          activeTab.databaseName,
        );
      } else {
        await tableService.mutateTableRows(
          tabConnectionId,
          driver,
          activeTab.schemaName,
          activeTab.tableName,
          rows,
        );
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code === "TABLE_IMPORT_CANCELLED") {
        cancelTask(taskId, "Import cancelled; transaction rolled back");
      } else {
        failTask(
          taskId,
          error instanceof Error ? error.message : String(error),
        );
        console.error("CSV import failed:", error);
      }
      setIsCsvImportSubmitting(false);
      return;
    } finally {
      if (nativeImportId) activeTableImportsRef.current.delete(nativeImportId);
      setActiveCsvImportId(null);
      setIsCsvImportCancelling(false);
    }
    const importedRowCount = rowsImported.toLocaleString();
    finishTask(taskId, `${importedRowCount} rows imported`);
    setCsvImportSource(null);
    setIsCsvImportSubmitting(false);
    if (
      !confirmDiscardTableChanges(
        activeTab.id,
        "refresh the table after importing CSV rows",
      )
    ) {
      const message =
        "Rows were imported. Existing unsaved table changes were preserved; submit or revert them before refreshing.";
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab.id ? { ...tab, error: message } : tab,
        ),
      }));
      updateTask(taskId, {
        detail: `${importedRowCount} rows imported; refresh skipped to preserve drafts`,
      });
      return;
    }

    let refreshSucceeded = false;
    let refreshFailure: string | null = null;
    try {
      refreshSucceeded = await loadTablePage(
        activeTab.id,
        page,
        undefined,
        undefined,
        { discardDraftsConfirmed: true },
      );
    } catch (error) {
      refreshFailure = error instanceof Error ? error.message : String(error);
    }

    if (!refreshSucceeded) {
      const refreshedTab = useTabStore
        .getState()
        .tabs.find((tab) => tab.id === activeTab.id);
      const details = refreshFailure || refreshedTab?.error;
      const message = `Rows were imported, but the table could not be refreshed. Click Refresh to load the latest data.${
        details ? ` Details: ${details}` : ""
      }`;
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab.id ? { ...tab, error: message } : tab,
        ),
      }));
      updateTask(taskId, {
        detail: `${importedRowCount} rows imported; refresh failed — click Refresh`,
      });
    }
  };

  const handleCancelCsvImport = async () => {
    const importId = activeCsvImportId;
    if (!importId || isCsvImportCancelling) return;
    setIsCsvImportCancelling(true);
    try {
      await tableService.cancelTableImport(importId);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "TABLE_IMPORT_NOT_FOUND") {
        console.error("Failed to cancel table import:", error);
      }
    }
  };

  const handleImportJsonRows = async (mode: TableImportMode) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      activeTab.isExecuting ||
      isTableReadOnly ||
      isJsonImportSubmitting ||
      !jsonImportSource
    ) {
      return;
    }
    const taskId = startTask({
      kind: "import",
      title: `Import ${jsonImportSource.preview.fileName}`,
      detail: activeTab.tableName,
    });
    setIsJsonImportSubmitting(true);
    updateTask(taskId, { detail: "Running full-file JSON preflight" });
    const importId = tableService.createTableImportId();
    activeTableImportsRef.current.set(importId, taskId);
    try {
      const preflight = await tableService.preflightTableJsonImport(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        jsonImportSource.nativePath,
        activeTab.databaseName,
        jsonImportSource.preview.contentDigest,
        mode,
      );
      if (preflight.rejectedRows > 0) {
        const locations = preflight.issues
          .slice(0, 5)
          .map((issue) => issue.rowNumber)
          .join(", ");
        throw new Error(
          `JSON preflight rejected ${preflight.rejectedRows.toLocaleString()} row(s)${locations ? ` (for example: ${locations})` : ""}. Strict import was not started.`,
        );
      }
      updateTask(taskId, {
        detail: `${preflight.acceptedRows.toLocaleString()} rows preflighted; committing transaction`,
      });
      const imported = await tableService.importTableData(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        jsonImportSource.nativePath,
        "json",
        true,
        activeTab.databaseName,
        undefined,
        jsonImportSource.preview.contentDigest,
        { projectId: activeProjectId, importId, mode },
      );
      const importedRowCount = imported.rowsImported.toLocaleString();
      finishTask(taskId, `${importedRowCount} rows imported`);
      setJsonImportSource(null);
      if (
        !confirmDiscardTableChanges(
          activeTab.id,
          "refresh the table after importing JSON rows",
        )
      ) {
        updateTask(taskId, {
          detail: `${importedRowCount} rows imported; refresh skipped to preserve drafts`,
        });
        return;
      }
      await loadTablePage(activeTab.id, page, undefined, undefined, {
        discardDraftsConfirmed: true,
      });
    } catch (error) {
      failTask(taskId, error instanceof Error ? error.message : String(error));
      console.error("JSON import failed:", error);
    } finally {
      activeTableImportsRef.current.delete(importId);
      setIsJsonImportSubmitting(false);
    }
  };

  const handleImportXlsxRows = async (mode: TableImportMode) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      activeTab.isExecuting ||
      isTableReadOnly ||
      isXlsxImportSubmitting ||
      !xlsxImportSource
    ) {
      return;
    }
    const taskId = startTask({
      kind: "import",
      title: `Import ${xlsxImportSource.preview.fileName}`,
      detail: activeTab.tableName,
    });
    setIsXlsxImportSubmitting(true);
    updateTask(taskId, {
      detail: "XLSX preview approved; committing transaction",
    });
    const importId = tableService.createTableImportId();
    activeTableImportsRef.current.set(importId, taskId);
    try {
      const imported = await tableService.importTableData(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        xlsxImportSource.nativePath,
        "xlsx",
        true,
        activeTab.databaseName,
        undefined,
        xlsxImportSource.preview.contentDigest,
        { projectId: activeProjectId, importId, mode },
      );
      const importedRowCount = imported.rowsImported.toLocaleString();
      finishTask(taskId, `${importedRowCount} rows imported`);
      setXlsxImportSource(null);
      if (
        !confirmDiscardTableChanges(
          activeTab.id,
          "refresh the table after importing XLSX rows",
        )
      ) {
        updateTask(taskId, {
          detail: `${importedRowCount} rows imported; refresh skipped to preserve drafts`,
        });
        return;
      }
      await loadTablePage(activeTab.id, page, undefined, undefined, {
        discardDraftsConfirmed: true,
      });
    } catch (error) {
      failTask(taskId, error instanceof Error ? error.message : String(error));
      console.error("XLSX import failed:", error);
    } finally {
      activeTableImportsRef.current.delete(importId);
      setIsXlsxImportSubmitting(false);
    }
  };

  return {
    handleImportCsvRows,
    handleCancelCsvImport,
    handleImportJsonRows,
    handleImportXlsxRows,
  };
}
