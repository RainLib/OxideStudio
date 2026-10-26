import { useCallback, useEffect, useRef, useState } from "react";
import type { DataGridHandle, DataGridSelectionSummary } from "@/components/workspace/DataGrid";
import { transposeQueryResult } from "@/features/data-grid";
import { useTableCapabilities } from "@/features/table-data/hooks/useTableCapabilities";
import { useManagedTablePermissions } from "@/features/table-data/hooks/useManagedTablePermissions";
import { useTableExportReport } from "@/features/table-data/hooks/useTableExportReport";
import { useTableImportEvents } from "@/features/table-data/hooks/useTableImportEvents";
import { useTableTransferProgress } from "@/features/table-data/hooks/useTableTransferProgress";
import { useTableViewLifecycle } from "@/features/table-data/hooks/useTableViewLifecycle";
import { createTableExportActions } from "@/features/table-data/model/createTableExportActions";
import { createTableImportActions } from "@/features/table-data/model/createTableImportActions";
import { createTableImportPickers } from "@/features/table-data/model/createTableImportPickers";
import { createTableNavigationActions } from "@/features/table-data/model/createTableNavigationActions";
import { createTableStructureActions } from "@/features/table-data/model/createTableStructureActions";
import { useTableInspection } from "@/features/table-data/useTableInspection";
import {
  DEFAULT_DATABASE_DRIVER,
  canAlterRelationStructure,
  canManageRelationIndexes,
  isReadOnlyRelationObject,
  isRelationalDataModel,
  normalizeDatabaseDriverName,
} from "@/lib/databaseDialect";
import type {
  ColumnInfo,
  TableExportFormat,
  TableJsonImportPreview,
  TableXlsxImportPreview,
} from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useTaskStore } from "@/store/useTaskStore";
import { useShallow } from "zustand/react/shallow";

const HOST_TABLE_EXPORT_FORMATS: readonly TableExportFormat[] = [
  "csv",
  "json",
  "jsonl",
  "markdown",
  "sql",
  "tsv",
  "xlsx",
  "parquet",
  "arrow",
];

export function useTableDataController() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const dataGridRef = useRef<DataGridHandle>(null);
  const {
    setFilterMode,
    setVisualFilters,
    setSqlFilter,
    setGridSort,
    loadTablePage,
    loadDocumentPage,
    runTabQuery,
    createTab,
    addNewRow,
    commitEdits,
    cancelEdits,
    resetColumnLayout,
    setTableMetadata,
  } = useTabStore(
    useShallow((state) => ({
      setFilterMode: state.setFilterMode,
      setVisualFilters: state.setVisualFilters,
      setSqlFilter: state.setSqlFilter,
      setGridSort: state.setGridSort,
      loadTablePage: state.loadTablePage,
      loadDocumentPage: state.loadDocumentPage,
      runTabQuery: state.runTabQuery,
      createTab: state.createTab,
      addNewRow: state.addNewRow,
      commitEdits: state.commitEdits,
      cancelEdits: state.cancelEdits,
      resetColumnLayout: state.resetColumnLayout,
      setTableMetadata: state.setTableMetadata,
    })),
  );
  const activeTab = useTabStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  );
  const { activeConnectionId, connections } = useConnectionStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
    })),
  );
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const bumpMetadataVersion = useSchemaStore(
    (state) => state.bumpMetadataVersion,
  );
  const { startTask, updateTask, finishTask, failTask, cancelTask } =
    useTaskStore(
      useShallow((state) => ({
        startTask: state.startTask,
        updateTask: state.updateTask,
        finishTask: state.finishTask,
        failTask: state.failTask,
        cancelTask: state.cancelTask,
      })),
    );
  const [activeCsvImportId, setActiveCsvImportId] = useState<string | null>(
    null,
  );
  const [activeTableExport, setActiveTableExport] = useState<{
    exportId: string;
    taskId: string;
  } | null>(null);
  const [exportMaxRows, setExportMaxRows] = useState<number | undefined>();
  const dataGridSettings = useSettingsStore((state) => state.settings.dataGrid);
  const refreshDdlOnOpen = useSettingsStore(
    (state) => state.settings.editor.refreshDdlOnOpen,
  );
  const defaultPageSize = dataGridSettings.pageSize;
  const tabConnectionId = activeTab?.connectionId || activeConnectionId;
  const activeConnection = connections.find((c) => c.id === tabConnectionId);
  const driver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  const { activeCapabilities: connectionCapabilities } = useTableCapabilities({
    driver,
    activeConnection,
  });
  const tablePermissions=useManagedTablePermissions(activeConnection,activeTab?.databaseName,activeTab?.schemaName,activeTab?.tableName);
  const activeCapabilities=activeConnection?.origin==="managed" ? {...connectionCapabilities,
    supportsTableRowMutation:connectionCapabilities.supportsTableRowMutation&&Boolean(tablePermissions.permissions?.dataWrite),
    supportsTableDdl:connectionCapabilities.supportsTableDdl&&Boolean(tablePermissions.permissions?.schemaDdl),
    supportsColumnAlteration:connectionCapabilities.supportsColumnAlteration&&Boolean(tablePermissions.permissions?.schemaDdl),
  } : connectionCapabilities;

  const tableExportFormats = HOST_TABLE_EXPORT_FORMATS.filter((format) =>
    activeCapabilities.tableExportFormats?.includes(format),
  );
  const supportsSqlConflictSkip =
    !activeConnection?.driverPackageVersion &&
    ["postgres", "mysql", "sqlite"].includes(
      normalizeDatabaseDriverName(driver) || "",
    );
  // New package data models (graph, time-series, queue, etc.) must never
  // accidentally enter the mutable relational grid while their dedicated
  // workspace is still unavailable.
  // Older cached capability responses may predate `dataModel`; the backend
  // normalizes those to relational, but preserve the same fallback in the UI
  // while the fresh capability request is still resolving.
  const isNativeObjectPreview =
    Boolean(activeCapabilities.dataModel) &&
    !isRelationalDataModel(activeCapabilities);
  const isSearchObjectPreview = activeCapabilities.dataModel === "search";
  const isMongoDocumentPreview =
    activeCapabilities.dataModel === "document" &&
    normalizeDatabaseDriverName(driver) === "mongodb" &&
    !activeConnection?.driverPackageVersion;
  const isCrossDatabasePreview = Boolean(activeTab?.databaseName) && activeConnection?.origin!=="managed";
  const isReadOnlyRelation = isReadOnlyRelationObject(activeTab?.objectType);
  const isTableReadOnly = isReadOnlyRelation || isNativeObjectPreview || !activeCapabilities.supportsTableRowMutation;
  const canManageIndexes =
    !isCrossDatabasePreview &&
    activeCapabilities.supportsTableDdl &&
    activeCapabilities.supportsTableIndexes &&
    canManageRelationIndexes(activeTab?.objectType);
  const canManageConstraints =
    !isCrossDatabasePreview &&
    activeCapabilities.supportsTableDdl &&
    activeCapabilities.supportsConstraintAlteration &&
    activeCapabilities.supportsTableConstraints &&
    canAlterRelationStructure(activeTab?.objectType);
  const inspection = useTableInspection({
    identity:
      activeTab?.type === "table" &&
      tabConnectionId &&
      activeTab.schemaName &&
      activeTab.tableName &&
      (!isNativeObjectPreview || isSearchObjectPreview)
        ? {
            projectId: activeProjectId,
            connectionId: tabConnectionId,
            driver,
            driverPackageVersion: activeConnection?.driverPackageVersion,
            connectionDatabaseName: activeConnection?.database,
            databaseName: activeTab.databaseName,
            schema: activeTab.schemaName,
            table: activeTab.tableName,
          }
        : null,
    tabId: activeTab?.id,
    objectType: activeTab?.objectType ?? undefined,
    includeIndexes: activeCapabilities.supportsTableIndexes,
    includeConstraints: activeCapabilities.supportsTableConstraints,
    includeForeignKeys: activeCapabilities.supportsForeignKeys,
    onMetadata: setTableMetadata,
  });
  const metadataColumns = inspection.metadata?.columns ?? [];
  const fallbackColumns = metadataColumns.map((column) => ({
    name: column.name,
    type: column.data_type,
  }));
  const tableIndexes = inspection.metadata?.indexes ?? [];
  const tableConstraints = inspection.metadata?.constraints ?? [];
  const {
    referencingForeignKeys,
    isMetadataLoading,
    tableDdl,
    isDdlLoading,
    ddlError,
    refreshStructure,
    refreshDdl,
  } = inspection;
  const [mutationError, setMetadataError] = useState<string | null>(null);
  const metadataError =
    mutationError || tablePermissions.error || inspection.metadataError || inspection.referencesError;
  const supportsSqlConflictUpdate =
    supportsSqlConflictSkip &&
    metadataColumns.some((column) => column.is_primary_key);
  const [showStructure, setShowStructure] = useState(false);
  const [showDdl, setShowDdl] = useState(false);
  const [isIndexDialogOpen, setIsIndexDialogOpen] = useState(false);
  const [isIndexSubmitting, setIsIndexSubmitting] = useState(false);
  const [isConstraintDialogOpen, setIsConstraintDialogOpen] = useState(false);
  const [isConstraintSubmitting, setIsConstraintSubmitting] = useState(false);
  const [csvImportSource, setCsvImportSource] = useState<{
    file: File;
    nativePath?: string;
    previewTruncated?: boolean;
    contentDigest?: string;
  } | null>(null);
  const [jsonImportSource, setJsonImportSource] = useState<{
    nativePath: string;
    preview: TableJsonImportPreview;
  } | null>(null);
  const [xlsxImportSource, setXlsxImportSource] = useState<{
    nativePath: string;
    preview: TableXlsxImportPreview;
  } | null>(null);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [isCsvImportSubmitting, setIsCsvImportSubmitting] = useState(false);
  const [isCsvImportCancelling, setIsCsvImportCancelling] = useState(false);
  const [isJsonImportSubmitting, setIsJsonImportSubmitting] = useState(false);
  const [isXlsxImportSubmitting, setIsXlsxImportSubmitting] = useState(false);
  const [isEditingEnabled, setIsEditingEnabled] = useState(
    !dataGridSettings.readOnlyByDefault,
  );
  const [gridZoomPercent, setGridZoomPercent] = useState(
    dataGridSettings.zoomPercent,
  );
  const [gridSelectionSummary, setGridSelectionSummary] =
    useState<DataGridSelectionSummary>({ selectedRowCount: 0 });
  const [mongoDocumentAction, setMongoDocumentAction] = useState<{
    mode: "clone" | "edit" | "delete";
    sourceId: unknown;
  } | null>(null);
  const [documentFilterDraft, setDocumentFilterDraft] = useState("");
  const [documentSortDraft, setDocumentSortDraft] = useState("");
  const [transposedTabIds, setTransposedTabIds] = useState<Set<string>>(
    () => new Set(),
  );
  const isGridReadOnly = isTableReadOnly || !isEditingEnabled;

  const openDdlInQueryEditor = useCallback(
    (ddl: string) => {
      if (!ddl.trim() || !activeTab || !tabConnectionId) return;
      const relationName = activeTab.tableName || "DDL";
      createTab("query", `Edit DDL · ${relationName}`, ddl, {
        connectionId: tabConnectionId,
        databaseName: activeTab.databaseName,
        schemaName: activeTab.schemaName,
        tableName: activeTab.tableName,
        objectType: activeTab.objectType,
      });
    },
    [activeTab, createTab, tabConnectionId],
  );

  const { openCsvImportPicker, openJsonImportPicker, openXlsxImportPicker } =
    createTableImportPickers({
      importInputRef,
      setCsvImportSource,
      activeTab,
      setJsonImportSource,
      setXlsxImportSource,
    });

  const { activeTableExportRef, activeTableImportsRef } =
    useTableTransferProgress({
      updateTask,
    });

  const { recentExportReport, setRecentExportReport } = useTableExportReport({
    activeProjectId,
    tabConnectionId,
    activeTab,
  });

  useTableImportEvents({
    tabConnectionId,
    activeTab,
    isTableReadOnly,
    openCsvImportPicker,
    openXlsxImportPicker,
    openJsonImportPicker,
  });

  useEffect(() => {
    setIsEditingEnabled(!dataGridSettings.readOnlyByDefault);
  }, [activeTab?.id, dataGridSettings.readOnlyByDefault]);

  useEffect(() => {
    setGridZoomPercent(dataGridSettings.zoomPercent);
    setGridSelectionSummary({ selectedRowCount: 0 });
  }, [activeTab?.id, dataGridSettings.zoomPercent]);

  useTableViewLifecycle({
    setMetadataError,
    setCsvImportSource,
    setIsTransferDialogOpen,
    setShowDdl,
    setShowStructure,
    setMongoDocumentAction,
    setDocumentFilterDraft,
    activeTab,
    setDocumentSortDraft,
    showDdl,
    tableDdl,
    isDdlLoading,
    ddlError,
    refreshDdl,
    refreshDdlOnOpen,
    tabConnectionId,
    isSearchObjectPreview,
    loadDocumentPage,
    isNativeObjectPreview,
    runTabQuery,
    loadTablePage,
  });

  if (!activeTab || activeTab.type !== "table") return null;

  const resultIndex = activeTab?.activeResultIndex ?? 0;
  const result = activeTab?.results?.[resultIndex] ?? activeTab?.results?.[0];
  const isTransposed = Boolean(activeTab && transposedTabIds.has(activeTab.id));
  // Keep all hooks above the non-table early return. Creating a Query tab
  // from a DDL draft changes the active tab synchronously, before the parent
  // has a chance to unmount this view.
  const transposedResult =
    isTransposed && result ? transposeQueryResult(result) : undefined;
  const csvImportColumns: ColumnInfo[] =
    metadataColumns.length > 0
      ? metadataColumns
      : activeTab.tableColumns?.length
        ? activeTab.tableColumns
        : (result?.columns || []).map((column) => ({
            name: column.name,
            data_type: column.data_type,
            is_nullable: true,
            is_primary_key: false,
          }));

  // Get columns from result or fallback
  const columns =
    (result?.columns?.length ? result.columns : fallbackColumns).map((col) => ({
      title: col.name,
      id: col.name,
      width: 150,
    })) || [];

  // Get filter state from active tab
  const filterMode = activeTab.filterMode || "sql";
  const visualFilters = activeTab.visualFilters || [];
  const sqlFilter = activeTab.sqlFilter || "";

  const {
    handleSearch,
    handleRefresh,
    applyDocumentFilterAndSort,
    clearDocumentFilterAndSort,
    handleCalculateTotalRows,
    openMongoDocumentAction,
    handlePrevious,
    handleFirst,
    handleNext,
    handleLast,
    page,
    totalRows,
    visibleRows,
    startRow,
    endRow,
    canPrevious,
    canNext,
    canLast,
    hasEdits,
  } = createTableNavigationActions({
    activeTab,
    filterMode,
    sqlFilter,
    loadTablePage,
    visualFilters,
    defaultPageSize,
    result,
    isSearchObjectPreview,
    loadDocumentPage,
    isNativeObjectPreview,
    tabConnectionId,
    runTabQuery,
    documentFilterDraft,
    documentSortDraft,
    setDocumentFilterDraft,
    setDocumentSortDraft,
    isMongoDocumentPreview,
    isTransposed,
    dataGridRef,
    setMongoDocumentAction,
  });

  const { handleExport, handleCancelExport, handleExportDatabaseSql } =
    createTableExportActions({
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
    });

  const {
    handleImportCsvRows,
    handleCancelCsvImport,
    handleImportJsonRows,
    handleImportXlsxRows,
  } = createTableImportActions({
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
  });

  const {
    handleCreateIndex,
    handleDropIndex,
    handleRenameIndex,
    handleCreateUniqueConstraint,
    handleCreatePrimaryKey,
    handleCreateCheckConstraint,
    handleCreateForeignKey,
    handleDropConstraint,
  } = createTableStructureActions({
    tabConnectionId,
    activeTab,
    canManageIndexes,
    isIndexSubmitting,
    setIsIndexSubmitting,
    setMetadataError,
    driver,
    setIsIndexDialogOpen,
    refreshStructure,
    bumpMetadataVersion,
    activeCapabilities,
    canManageConstraints,
    isConstraintSubmitting,
    setIsConstraintSubmitting,
    setIsConstraintDialogOpen,
  });


  return {
    importInputRef,
    dataGridRef,
    setFilterMode,
    setVisualFilters,
    setSqlFilter,
    setGridSort,
    addNewRow,
    commitEdits,
    cancelEdits,
    resetColumnLayout,
    runTabQuery,
    activeTab,
    connections,
    activeProjectId,
    tabConnectionId,
    driver,
    activeCapabilities,
    dataGridSettings,
    defaultGridZoomPercent: dataGridSettings.zoomPercent,
    tableExportFormats,
    supportsSqlConflictSkip,
    supportsSqlConflictUpdate,
    isNativeObjectPreview,
    isSearchObjectPreview,
    isMongoDocumentPreview,
    isCrossDatabasePreview,
    isTableReadOnly,
    canManageIndexes,
    canManageConstraints,
    metadataColumns,
    fallbackColumns,
    tableIndexes,
    tableConstraints,
    referencingForeignKeys,
    isMetadataLoading,
    tableDdl,
    isDdlLoading,
    ddlError,
    metadataError,
    refreshDdl,
    showStructure,
    setShowStructure,
    showDdl,
    setShowDdl,
    isIndexDialogOpen,
    setIsIndexDialogOpen,
    isIndexSubmitting,
    isConstraintDialogOpen,
    setIsConstraintDialogOpen,
    isConstraintSubmitting,
    csvImportSource,
    setCsvImportSource,
    jsonImportSource,
    setJsonImportSource,
    xlsxImportSource,
    setXlsxImportSource,
    isTransferDialogOpen,
    setIsTransferDialogOpen,
    isCsvImportSubmitting,
    isCsvImportCancelling,
    isJsonImportSubmitting,
    isXlsxImportSubmitting,
    activeCsvImportId,
    activeTableExport,
    exportMaxRows,
    setExportMaxRows,
    isEditingEnabled,
    setIsEditingEnabled,
    isGridReadOnly,
    gridZoomPercent,
    setGridZoomPercent,
    gridSelectionSummary,
    setGridSelectionSummary,
    mongoDocumentAction,
    setMongoDocumentAction,
    documentFilterDraft,
    setDocumentFilterDraft,
    documentSortDraft,
    setDocumentSortDraft,
    setTransposedTabIds,
    openDdlInQueryEditor,
    openCsvImportPicker,
    openJsonImportPicker,
    openXlsxImportPicker,
    recentExportReport,
    result,
    isTransposed,
    transposedResult,
    csvImportColumns,
    columns,
    filterMode,
    visualFilters,
    sqlFilter,
    handleSearch,
    handleRefresh,
    applyDocumentFilterAndSort,
    clearDocumentFilterAndSort,
    handleCalculateTotalRows,
    openMongoDocumentAction,
    handlePrevious,
    handleFirst,
    handleNext,
    handleLast,
    totalRows,
    visibleRows,
    startRow,
    endRow,
    canPrevious,
    canNext,
    canLast,
    hasEdits,
    handleExport,
    handleCancelExport,
    handleExportDatabaseSql,
    handleImportCsvRows,
    handleCancelCsvImport,
    handleImportJsonRows,
    handleImportXlsxRows,
    handleCreateIndex,
    handleDropIndex,
    handleRenameIndex,
    handleCreateUniqueConstraint,
    handleCreatePrimaryKey,
    handleCreateCheckConstraint,
    handleCreateForeignKey,
    handleDropConstraint,
  };
}
