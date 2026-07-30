import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDiscardTableChanges, useTabStore } from "@/store/useTabStore";
import {
  ensureConnectionReady,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTaskStore } from "@/store/useTaskStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { databaseService, schemaService, tableService } from "@/services/tauri";
import { loadTableDdl, loadTableMetadata } from "@/services/tableMetadataCache";
import type {
  ColumnInfo,
  ConstraintInfo,
  DatabaseCapabilities,
  ForeignKeyReferenceInfo,
  IndexInfo,
  TableExportFormat,
} from "@/services/tauri/types";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  DataGrid,
  type DataGridHandle,
  type DataGridSelectionSummary,
} from "./DataGrid";
import { GridFilterRow } from "./GridFilterRow";
import { TableDataToolbar } from "./TableDataToolbar";
import { TableDdlView } from "./TableDdlView";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  Pencil,
  Plus,
  TableProperties,
  Trash2,
} from "lucide-react";
import { CreateConstraintDialog } from "./CreateConstraintDialog";
import { CreateIndexDialog } from "./CreateIndexDialog";
import { CsvImportDialog } from "./CsvImportDialog";
import {
  DEFAULT_DATABASE_DRIVER,
  canAlterRelationStructure,
  canManageRelationIndexes,
  defaultDatabaseCapabilities,
  isReadOnlyRelationObject,
} from "@/lib/databaseDialect";
import { stepGridZoom } from "@/lib/dataGridView";
import { cn } from "@/lib/utils";

export function TableDataView() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const dataGridRef = useRef<DataGridHandle>(null);
  const {
    tabs,
    activeTabId,
    setFilterMode,
    setVisualFilters,
    setSqlFilter,
    setGridSort,
    loadTablePage,
    runTabQuery,
    addNewRow,
    commitEdits,
    cancelEdits,
    resetColumnLayout,
    setTableMetadata,
  } = useTabStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const bumpMetadataVersion = useSchemaStore(
    (state) => state.bumpMetadataVersion,
  );
  const { startTask, updateTask, finishTask, failTask } = useTaskStore();
  const dataGridSettings = useSettingsStore((state) => state.settings.dataGrid);
  const defaultPageSize = dataGridSettings.pageSize;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const tabConnectionId = activeTab?.connectionId || activeConnectionId;
  const activeConnection = connections.find((c) => c.id === tabConnectionId);
  const driver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  const [capabilities, setCapabilities] = useState<DatabaseCapabilities>(() =>
    defaultDatabaseCapabilities(driver),
  );
  const activeCapabilities =
    capabilities.driver === driver
      ? capabilities
      : defaultDatabaseCapabilities(driver);
  const isNativeObjectPreview =
    activeCapabilities.dataModel === "document" ||
    activeCapabilities.dataModel === "keyValue" ||
    activeCapabilities.dataModel === "search";
  const isSearchObjectPreview = activeCapabilities.dataModel === "search";
  const isCrossDatabasePreview = Boolean(activeTab?.databaseName);
  const isReadOnlyRelation = isReadOnlyRelationObject(activeTab?.objectType);
  const isTableReadOnly = isReadOnlyRelation || isNativeObjectPreview;
  const canManageIndexes =
    !isCrossDatabasePreview &&
    activeCapabilities.supportsTableIndexes &&
    canManageRelationIndexes(activeTab?.objectType);
  const canManageConstraints =
    !isCrossDatabasePreview &&
    activeCapabilities.supportsTableConstraints &&
    canAlterRelationStructure(activeTab?.objectType);
  const [fallbackColumns, setFallbackColumns] = useState<
    Array<{ name: string; type?: string }>
  >([]);
  const [metadataColumns, setMetadataColumns] = useState<ColumnInfo[]>([]);
  const [tableIndexes, setTableIndexes] = useState<IndexInfo[]>([]);
  const [tableConstraints, setTableConstraints] = useState<ConstraintInfo[]>(
    [],
  );
  const [referencingForeignKeys, setReferencingForeignKeys] = useState<
    ForeignKeyReferenceInfo[]
  >([]);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [showDdl, setShowDdl] = useState(false);
  const [tableDdl, setTableDdl] = useState("");
  const [isDdlLoading, setIsDdlLoading] = useState(false);
  const [ddlError, setDdlError] = useState<string | null>(null);
  const [isIndexDialogOpen, setIsIndexDialogOpen] = useState(false);
  const [isIndexSubmitting, setIsIndexSubmitting] = useState(false);
  const [isConstraintDialogOpen, setIsConstraintDialogOpen] = useState(false);
  const [isConstraintSubmitting, setIsConstraintSubmitting] = useState(false);
  const [csvImportFile, setCsvImportFile] = useState<File | null>(null);
  const [isCsvImportSubmitting, setIsCsvImportSubmitting] = useState(false);
  const [isEditingEnabled, setIsEditingEnabled] = useState(
    !dataGridSettings.readOnlyByDefault,
  );
  const [gridZoomPercent, setGridZoomPercent] = useState(
    dataGridSettings.zoomPercent,
  );
  const [gridSelectionSummary, setGridSelectionSummary] =
    useState<DataGridSelectionSummary>({ selectedRowCount: 0 });
  const structureRequestRef = useRef(0);
  const ddlRequestRef = useRef(0);
  const isGridReadOnly = isTableReadOnly || !isEditingEnabled;

  useEffect(() => {
    setIsEditingEnabled(!dataGridSettings.readOnlyByDefault);
  }, [activeTab?.id, dataGridSettings.readOnlyByDefault]);

  useEffect(() => {
    setGridZoomPercent(dataGridSettings.zoomPercent);
    setGridSelectionSummary({ selectedRowCount: 0 });
  }, [activeTab?.id, dataGridSettings.zoomPercent]);

  useEffect(() => {
    let cancelled = false;
    const fallback = defaultDatabaseCapabilities(driver);
    setCapabilities(fallback);

    databaseService
      .getDatabaseCapabilities(driver)
      .then((nextCapabilities) => {
        if (!cancelled) setCapabilities(nextCapabilities);
      })
      .catch((error) => {
        console.error("Failed to load database capabilities:", error);
        if (!cancelled) setCapabilities(fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [driver]);

  const refreshStructure = useCallback(
    async (force = false) => {
      if (
        activeTab?.type !== "table" ||
        (isNativeObjectPreview && !isSearchObjectPreview) ||
        !tabConnectionId ||
        !activeTab.schemaName ||
        !activeTab.tableName
      ) {
        return;
      }

      const requestId = structureRequestRef.current + 1;
      structureRequestRef.current = requestId;
      const tabId = activeTab.id;
      setIsMetadataLoading(true);
      setMetadataError(null);
      setMetadataColumns([]);
      setFallbackColumns([]);
      setTableIndexes([]);
      setTableConstraints([]);
      setReferencingForeignKeys([]);

      try {
        const readiness = await ensureConnectionReady(tabConnectionId);
        if (structureRequestRef.current !== requestId) return;
        if (readiness.status === "cancelled") return;
        if (readiness.status === "error") {
          throw new Error(readiness.message);
        }

        const reverseForeignKeys = activeCapabilities.supportsForeignKeys
          ? activeTab.databaseName
            ? schemaService.getDatabaseReferencingForeignKeys(
                tabConnectionId,
                activeTab.databaseName,
                activeTab.schemaName,
                activeTab.tableName,
              )
            : schemaService.getReferencingForeignKeys(
                tabConnectionId,
                activeTab.schemaName,
                activeTab.tableName,
              )
          : Promise.resolve([]);
        const [metadata, incomingForeignKeys] = await Promise.all([
          loadTableMetadata({
            projectId: activeProjectId,
            connectionId: tabConnectionId,
            driver,
            databaseName: activeTab.databaseName,
            schema: activeTab.schemaName,
            table: activeTab.tableName,
            includeIndexes: activeCapabilities.supportsTableIndexes,
            includeConstraints: activeCapabilities.supportsTableConstraints,
            force,
          }),
          reverseForeignKeys.catch((error) => {
            console.warn("Failed to load reverse foreign keys:", error);
            return [];
          }),
        ]);
        setTableMetadata(tabId, metadata);
        if (structureRequestRef.current !== requestId) return;

        setMetadataColumns(metadata.columns);
        setFallbackColumns(
          metadata.columns.map((column) => ({
            name: column.name,
            type: column.data_type,
          })),
        );
        setTableIndexes(metadata.indexes);
        setTableConstraints(metadata.constraints);
        setReferencingForeignKeys(incomingForeignKeys);
        if (metadata.ddl) setTableDdl(metadata.ddl);
      } catch (err: any) {
        if (structureRequestRef.current !== requestId) return;
        setMetadataError(err?.message || String(err));
        console.error("Failed to fetch table metadata:", err);
      } finally {
        if (structureRequestRef.current === requestId) {
          setIsMetadataLoading(false);
        }
      }
    },
    [
      activeTab?.id,
      activeTab?.type,
      activeTab?.databaseName,
      activeTab?.schemaName,
      activeTab?.tableName,
      activeCapabilities.supportsTableConstraints,
      activeCapabilities.supportsTableIndexes,
      activeCapabilities.supportsForeignKeys,
      activeProjectId,
      driver,
      isNativeObjectPreview,
      isSearchObjectPreview,
      setTableMetadata,
      tabConnectionId,
    ],
  );

  const refreshDdl = useCallback(
    async (force = false) => {
      if (
        activeTab?.type !== "table" ||
        (isNativeObjectPreview && !isSearchObjectPreview) ||
        !tabConnectionId ||
        !activeTab.schemaName ||
        !activeTab.tableName
      ) {
        return;
      }

      const requestId = ddlRequestRef.current + 1;
      ddlRequestRef.current = requestId;
      setIsDdlLoading(true);
      setDdlError(null);
      try {
        const ddl = await loadTableDdl(
          {
            projectId: activeProjectId,
            connectionId: tabConnectionId,
            driver,
            databaseName: activeTab.databaseName,
            schema: activeTab.schemaName,
            table: activeTab.tableName,
          },
          activeTab.objectType,
          force,
        );
        if (ddlRequestRef.current === requestId) setTableDdl(ddl);
      } catch (error) {
        if (ddlRequestRef.current !== requestId) return;
        setDdlError(error instanceof Error ? error.message : String(error));
      } finally {
        if (ddlRequestRef.current === requestId) setIsDdlLoading(false);
      }
    },
    [
      activeProjectId,
      activeTab?.databaseName,
      activeTab?.objectType,
      activeTab?.schemaName,
      activeTab?.tableName,
      activeTab?.type,
      driver,
      isNativeObjectPreview,
      isSearchObjectPreview,
      tabConnectionId,
    ],
  );

  useEffect(() => {
    ddlRequestRef.current += 1;
    setCsvImportFile(null);
    setShowDdl(false);
    setShowStructure(false);
    setTableDdl("");
    setDdlError(null);
    setIsDdlLoading(false);
  }, [activeTab?.id]);

  useEffect(() => {
    if (showDdl && !tableDdl && !isDdlLoading && !ddlError) {
      void refreshDdl(false);
    }
  }, [ddlError, isDdlLoading, refreshDdl, showDdl, tableDdl]);

  // Auto-fetch data on mount if no results
  useEffect(() => {
    if (
      activeTab &&
      activeTab.type === "table" &&
      !activeTab.results &&
      !activeTab.isExecuting &&
      !activeTab.error &&
      tabConnectionId &&
      activeTab.tableName &&
      activeTab.schemaName
    ) {
      if (isNativeObjectPreview && activeTab.sql.trim()) {
        void runTabQuery(activeTab.id, tabConnectionId, activeTab.sql);
      } else {
        void loadTablePage(activeTab.id, 0);
      }
    }
  }, [
    activeTab,
    isNativeObjectPreview,
    loadTablePage,
    runTabQuery,
    tabConnectionId,
  ]);

  // Fetch structure metadata for empty headers, save logic, and table inspection.
  useEffect(() => {
    void refreshStructure(false);
  }, [activeTab?.id, refreshStructure]);

  if (!activeTab || activeTab.type !== "table") return null;

  const result = activeTab?.results?.[0];
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

  const handleSearch = () => {
    if (!activeTab || !activeTab.tableName || !activeTab.schemaName) return;

    if (filterMode === "sql") {
      let whereClause = sqlFilter.trim();
      if (whereClause && !whereClause.toUpperCase().startsWith("WHERE")) {
        whereClause = "WHERE " + whereClause;
      }
      void loadTablePage(activeTab.id, 0, whereClause || null, null, {
        discardAction: "apply the filter",
      });
      return;
    }

    const activeVisualFilters = visualFilters.filter(
      (filter) =>
        filter.column && filter.operator && filter.value.trim().length > 0,
    );

    void loadTablePage(
      activeTab.id,
      0,
      null,
      activeVisualFilters.length > 0 ? activeVisualFilters : null,
      { discardAction: "apply the filter" },
    );
  };

  const page = activeTab.tablePage || 0;
  const pageSize = activeTab.tablePageSize || defaultPageSize;
  const totalRows = activeTab.tableTotalRows;
  const visibleRows = result?.rows.length || 0;
  const startRow = totalRows && visibleRows > 0 ? page * pageSize + 1 : 0;
  const endRow =
    totalRows && visibleRows > 0 ? page * pageSize + visibleRows : visibleRows;
  const canPrevious = page > 0 && !activeTab.isExecuting;
  const canNext =
    !activeTab.isExecuting &&
    visibleRows === pageSize &&
    (totalRows == null || (page + 1) * pageSize < totalRows);
  const lastPage =
    totalRows == null ? null : Math.max(0, Math.ceil(totalRows / pageSize) - 1);
  const canLast = lastPage != null && page < lastPage && !activeTab.isExecuting;
  const hasEdits =
    (activeTab.pendingEdits?.size || 0) > 0 ||
    (activeTab.newRowsCount || 0) > 0;
  const formatColumnList = (columns: string[]) =>
    columns.length > 0 ? columns.join(", ") : "-";

  const renderMetadataRow = (
    key: string,
    label: string,
    value: string,
    detail?: string | null,
  ) => (
    <div
      key={key}
      className="flex min-w-0 items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0"
      title={detail || value}
    >
      <span className="w-24 shrink-0 truncate text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">{value}</span>
    </div>
  );

  const handleRefresh = () => {
    if (isNativeObjectPreview) {
      if (tabConnectionId && activeTab.sql.trim()) {
        void runTabQuery(activeTab.id, tabConnectionId, activeTab.sql);
      }
      return;
    }
    void loadTablePage(activeTab.id, page, undefined, undefined, {
      discardAction: "refresh the table",
    });
  };

  const handlePrevious = () => {
    if (canPrevious) {
      void loadTablePage(activeTab.id, page - 1, undefined, undefined, {
        discardAction: "change pages",
      });
    }
  };

  const handleFirst = () => {
    if (canPrevious) {
      void loadTablePage(activeTab.id, 0, undefined, undefined, {
        discardAction: "change pages",
      });
    }
  };

  const handleNext = () => {
    if (canNext) {
      void loadTablePage(activeTab.id, page + 1, undefined, undefined, {
        discardAction: "change pages",
      });
    }
  };

  const handleLast = () => {
    if (canLast && lastPage != null) {
      void loadTablePage(activeTab.id, lastPage, undefined, undefined, {
        discardAction: "change pages",
      });
    }
  };

  const handleExport = async (format: TableExportFormat) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      activeTab.isExecuting ||
      isCrossDatabasePreview ||
      isNativeObjectPreview
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
      detail: format.toUpperCase(),
    });

    try {
      const exported = await tableService.exportTableData(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        format,
        activeTab.tableFilterSql || undefined,
        activeTab.tableFilters || undefined,
        sort,
      );
      finishTask(
        taskId,
        `${exported.rowsExported.toLocaleString()} rows to ${format.toUpperCase()}`,
      );
      await revealItemInDir(exported.filePath);
    } catch (error) {
      failTask(taskId, error instanceof Error ? error.message : String(error));
      console.error("Table export failed:", error);
    }
  };

  const handleImportCsvRows = async (rows: Array<Record<string, unknown>>) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      activeTab.isExecuting ||
      isTableReadOnly ||
      isCsvImportSubmitting ||
      !csvImportFile
    ) {
      return;
    }
    const taskId = startTask({
      kind: "import",
      title: `Import ${csvImportFile.name}`,
      detail: activeTab.tableName,
    });
    setIsCsvImportSubmitting(true);
    updateTask(taskId, {
      detail: `${rows.length.toLocaleString()} rows validated; committing transaction`,
    });
    try {
      if (activeTab.databaseName) {
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
      failTask(taskId, error instanceof Error ? error.message : String(error));
      console.error("CSV import failed:", error);
      setIsCsvImportSubmitting(false);
      return;
    }
    const importedRowCount = rows.length.toLocaleString();
    finishTask(taskId, `${importedRowCount} rows imported`);
    setCsvImportFile(null);
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

  const handleCreateIndex = async (
    indexName: string,
    columns: string[],
    unique: boolean,
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageIndexes ||
      isIndexSubmitting
    ) {
      return;
    }

    setIsIndexSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTableIndex(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        indexName,
        columns,
        unique,
      );
      setIsIndexDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsIndexSubmitting(false);
    }
  };

  const handleDropIndex = async (index: IndexInfo) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageIndexes ||
      index.is_primary
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Drop index "${index.name}" from "${activeTab.tableName}"?`,
    );
    if (!confirmed) return;

    setMetadataError(null);
    try {
      await tableService.dropTableIndex(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        index.name,
      );
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    }
  };

  const handleRenameIndex = async (index: IndexInfo) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageIndexes ||
      index.is_primary
    ) {
      return;
    }

    const nextName = window.prompt("Rename index to:", index.name);
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === index.name) return;

    setMetadataError(null);
    try {
      await tableService.renameTableIndex(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        index.name,
        trimmedName,
      );
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    }
  };

  const handleCreateUniqueConstraint = async (
    constraintName: string,
    columns: string[],
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints ||
      !activeCapabilities.supportsCheckConstraints ||
      isConstraintSubmitting
    ) {
      return;
    }

    setIsConstraintSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTableUniqueConstraint(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraintName,
        columns,
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleCreatePrimaryKey = async (
    constraintName: string,
    columns: string[],
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints ||
      !activeCapabilities.supportsForeignKeys ||
      isConstraintSubmitting
    ) {
      return;
    }

    setIsConstraintSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTablePrimaryKey(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraintName,
        columns,
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleCreateCheckConstraint = async (
    constraintName: string,
    expression: string,
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints ||
      isConstraintSubmitting
    ) {
      return;
    }

    setIsConstraintSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTableCheckConstraint(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraintName,
        expression,
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleCreateForeignKey = async (request: {
    constraintName: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete: string | null;
    onUpdate: string | null;
  }) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints ||
      isConstraintSubmitting
    ) {
      return;
    }

    setIsConstraintSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTableForeignKey(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        request.constraintName,
        request.columns,
        activeTab.schemaName,
        request.referencedTable,
        request.referencedColumns,
        request.onDelete,
        request.onUpdate,
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleDropConstraint = async (constraint: ConstraintInfo) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Drop constraint "${constraint.name}" from "${activeTab.tableName}"?`,
    );
    if (!confirmed) return;

    setMetadataError(null);
    try {
      await tableService.dropTableConstraint(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraint.name,
      );
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    }
  };

  return (
    <div
      className="flex flex-col h-full wb-grid-surface"
      onKeyDownCapture={(event) => {
        if (!event.metaKey && !event.ctrlKey) return;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          setGridZoomPercent((value) => stepGridZoom(value, 1));
        } else if (event.key === "-") {
          event.preventDefault();
          setGridZoomPercent((value) => stepGridZoom(value, -1));
        } else if (event.key === "0") {
          event.preventDefault();
          setGridZoomPercent(dataGridSettings.zoomPercent);
        }
      }}
      onWheelCapture={(event) => {
        if (!event.metaKey && !event.ctrlKey) return;
        event.preventDefault();
        setGridZoomPercent((value) =>
          stepGridZoom(value, event.deltaY < 0 ? 1 : -1),
        );
      }}
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            setCsvImportFile(file);
          }
        }}
      />

      <CsvImportDialog
        open={csvImportFile !== null}
        file={csvImportFile}
        tableName={activeTab.tableName || "table"}
        columns={csvImportColumns}
        isSubmitting={isCsvImportSubmitting}
        onClose={() => setCsvImportFile(null)}
        onImport={handleImportCsvRows}
      />

      <TableDataToolbar
        isExecuting={activeTab.isExecuting}
        readOnly={isTableReadOnly}
        exportDisabled={isCrossDatabasePreview || isNativeObjectPreview}
        editingEnabled={isEditingEnabled}
        hasEdits={hasEdits}
        editedCellCount={activeTab.pendingEdits?.size || 0}
        newRowCount={activeTab.newRowsCount || 0}
        selectedRowCount={gridSelectionSummary.selectedRowCount}
        onRefresh={handleRefresh}
        onAddRow={() => addNewRow(activeTab.id)}
        onDeleteRows={() => void dataGridRef.current?.deleteSelectedRows()}
        onSave={() => void commitEdits(activeTab.id)}
        onRevert={() => cancelEdits(activeTab.id)}
        onSearch={() => dataGridRef.current?.openSearch()}
        onFitColumns={() => dataGridRef.current?.fitColumns()}
        onResetColumns={() => resetColumnLayout(activeTab.id)}
        onToggleEditing={() => setIsEditingEnabled((value) => !value)}
        onImport={() => importInputRef.current?.click()}
        onExportCsv={() => void handleExport("csv")}
        onExportJson={() => void handleExport("json")}
        onExportSql={() => void handleExport("sql")}
      />

      {/* Query Builder Filter Row */}
      {!isNativeObjectPreview &&
        !showStructure &&
        !showDdl &&
        (result || fallbackColumns.length > 0) && (
          <GridFilterRow
            columns={columns}
            mode={filterMode}
            visualFilters={visualFilters}
            sqlFilter={sqlFilter}
            onModeChange={(mode) => setFilterMode(activeTab.id, mode)}
            onVisualFiltersChange={(filters) =>
              setVisualFilters(activeTab.id, filters)
            }
            onSqlFilterChange={(sql) => setSqlFilter(activeTab.id, sql)}
            onSearch={handleSearch}
            connectionId={tabConnectionId}
            driver={driver}
            tabId={activeTab.id}
            schemaName={activeTab.schemaName}
            tableName={activeTab.tableName}
            sortColumn={activeTab.gridState?.sortColumn}
            sortDirection={activeTab.gridState?.sortDirection}
            onSortChange={(column, direction) =>
              void setGridSort(activeTab.id, column, direction)
            }
          />
        )}

      {activeTab.error && (
        <div
          role="alert"
          className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--destructive)/0.08)] px-3 py-1.5 text-[11px] text-[hsl(var(--destructive))]"
        >
          {activeTab.error}
        </div>
      )}

      <div className="flex h-7 shrink-0 items-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-1.5">
        <button
          type="button"
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
            !showStructure && !showDdl
              ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
              : "wb-muted hover:text-[hsl(var(--wb-text))]",
          )}
          onClick={() => {
            setShowDdl(false);
            setShowStructure(false);
          }}
        >
          <TableProperties size={12} />
          Data
        </button>
        {(!isNativeObjectPreview || isSearchObjectPreview) && (
          <button
            type="button"
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
              showDdl
                ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                : "wb-muted hover:text-[hsl(var(--wb-text))]",
            )}
            onClick={() => {
              setShowDdl(true);
              setShowStructure(false);
            }}
          >
            <Code2 size={12} />
            {isSearchObjectPreview ? "Mapping" : "DDL"}
          </button>
        )}
        <span className="ml-auto min-w-0 truncate px-2 text-[10px] wb-muted">
          {[activeTab.databaseName, activeTab.schemaName, activeTab.tableName]
            .filter(Boolean)
            .join(".")}
        </span>
      </div>
      {showStructure && metadataError && (
        <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1 text-xs text-destructive">
          {metadataError}
        </div>
      )}
      {showStructure && isMetadataLoading && !metadataError && (
        <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1 text-xs text-[hsl(var(--wb-text-muted))]">
          Loading structure...
        </div>
      )}

      {showDdl && (
        <TableDdlView
          ddl={tableDdl}
          isLoading={isDdlLoading}
          error={ddlError}
          onRefresh={() => void refreshDdl(true)}
          kind={isSearchObjectPreview ? "mapping" : "ddl"}
        />
      )}

      {showStructure && (
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-5 overflow-auto bg-[hsl(var(--wb-panel))] px-4 py-3 text-xs">
          <div className="min-w-0">
            <div className="mb-1 font-medium text-foreground">Columns</div>
            {metadataColumns.length === 0 ? (
              <div className="text-muted-foreground">No columns loaded</div>
            ) : (
              metadataColumns.map((column) =>
                renderMetadataRow(
                  `column:${column.name}`,
                  column.name,
                  column.data_type,
                  [
                    column.is_primary_key ? "primary key" : null,
                    column.is_unique ? "unique" : null,
                    column.is_indexed ? "indexed" : null,
                    column.is_nullable ? "nullable" : "not null",
                  ]
                    .filter(Boolean)
                    .join(", "),
                ),
              )
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="font-medium text-foreground">Indexes</div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsIndexDialogOpen(true)}
                disabled={!canManageIndexes}
                title={
                  isCrossDatabasePreview
                    ? "Index changes are unavailable for a table opened from another database"
                    : activeCapabilities.supportsTableIndexes
                      ? "Create index"
                      : "Indexes are not supported by this driver"
                }
              >
                <Plus size={12} />
              </Button>
            </div>
            {tableIndexes.length === 0 ? (
              <div className="text-muted-foreground">No indexes loaded</div>
            ) : (
              tableIndexes.map((index) => (
                <div
                  key={`index:${index.name}`}
                  className="flex min-w-0 items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0"
                  title={[
                    index.is_primary ? "primary" : null,
                    index.is_unique ? "unique" : null,
                    index.index_type || null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                >
                  <span className="w-24 shrink-0 truncate text-muted-foreground">
                    {index.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {formatColumnList(index.columns)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={!canManageIndexes || index.is_primary}
                    onClick={() => void handleRenameIndex(index)}
                    title={
                      !canManageIndexes
                        ? "Index changes are not available for this object"
                        : index.is_primary
                          ? "Primary indexes are managed through constraints"
                          : "Rename index"
                    }
                  >
                    <Pencil size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={!canManageIndexes || index.is_primary}
                    onClick={() => void handleDropIndex(index)}
                    title={
                      !canManageIndexes
                        ? "Index changes are not available for this object"
                        : index.is_primary
                          ? "Primary indexes are managed through constraints"
                          : "Drop index"
                    }
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="font-medium text-foreground">Constraints</div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsConstraintDialogOpen(true)}
                disabled={!canManageConstraints}
                title={
                  isCrossDatabasePreview
                    ? "Constraint changes are unavailable for a table opened from another database"
                    : activeCapabilities.supportsTableConstraints
                      ? "Create constraint"
                      : "Constraints are not supported by this driver"
                }
              >
                <Plus size={12} />
              </Button>
            </div>
            {tableConstraints.length === 0 ? (
              <div className="text-muted-foreground">No constraints loaded</div>
            ) : (
              tableConstraints.map((constraint) => {
                const reference =
                  constraint.referenced_table &&
                  `${constraint.referenced_schema || ""}${
                    constraint.referenced_schema ? "." : ""
                  }${constraint.referenced_table}(${formatColumnList(
                    constraint.referenced_columns,
                  )})`;
                const isPrimary =
                  constraint.constraint_type.toUpperCase() === "PRIMARY KEY";
                return (
                  <div
                    key={`constraint:${constraint.name}`}
                    className="flex min-w-0 items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0"
                    title={
                      reference ||
                      constraint.definition ||
                      formatColumnList(constraint.columns)
                    }
                  >
                    <span className="w-24 shrink-0 truncate text-muted-foreground">
                      {constraint.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {constraint.constraint_type}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={!canManageConstraints}
                      onClick={() => void handleDropConstraint(constraint)}
                      title={
                        !canManageConstraints
                          ? "Constraint changes are not available for this object"
                          : isPrimary
                            ? "Drop primary key"
                            : "Drop constraint"
                      }
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Main Grid View */}
      {!showStructure && !showDdl && (
        <div className="relative min-h-0 flex-1 wb-grid-surface">
          <DataGrid
            ref={dataGridRef}
            overrideColumns={fallbackColumns}
            readOnly={isGridReadOnly || activeTab.isExecuting}
            zoomPercent={gridZoomPercent}
            onSelectionSummaryChange={setGridSelectionSummary}
            tableConstraints={tableConstraints}
            referencingForeignKeys={referencingForeignKeys}
          />
          <div className="absolute bottom-3 left-1/2 z-40 flex h-8 -translate-x-1/2 items-center gap-0.5 rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised)/0.94)] px-1 shadow-[0_8px_22px_rgba(0,0,0,0.26)] backdrop-blur-sm">
            <button
              type="button"
              className="wb-icon-button"
              disabled={!canPrevious}
              onClick={handleFirst}
              title="First page"
            >
              <ChevronsLeft size={13} />
            </button>
            <button
              type="button"
              className="wb-icon-button"
              disabled={!canPrevious}
              onClick={handlePrevious}
              title="Previous page"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="min-w-[112px] px-2 text-center text-[10px] tabular-nums text-[hsl(var(--wb-text-muted))]">
              {totalRows == null
                ? `${visibleRows.toLocaleString()} rows`
                : `${startRow.toLocaleString()}-${endRow.toLocaleString()} of ${totalRows.toLocaleString()}`}
            </span>
            <button
              type="button"
              className="wb-icon-button"
              disabled={!canNext}
              onClick={handleNext}
              title="Next page"
            >
              <ChevronRight size={13} />
            </button>
            <button
              type="button"
              className="wb-icon-button"
              disabled={!canLast}
              onClick={handleLast}
              title="Last page"
            >
              <ChevronsRight size={13} />
            </button>
          </div>
        </div>
      )}
      <CreateIndexDialog
        isOpen={isIndexDialogOpen}
        onClose={() => setIsIndexDialogOpen(false)}
        tableName={activeTab.tableName || ""}
        columns={metadataColumns}
        isSubmitting={isIndexSubmitting}
        onCreate={handleCreateIndex}
      />
      <CreateConstraintDialog
        isOpen={isConstraintDialogOpen}
        onClose={() => setIsConstraintDialogOpen(false)}
        connectionId={tabConnectionId || ""}
        driver={driver}
        schema={activeTab.schemaName || ""}
        tableName={activeTab.tableName || ""}
        columns={metadataColumns}
        isSubmitting={isConstraintSubmitting}
        supportsForeignKeys={activeCapabilities.supportsForeignKeys}
        supportsCheckConstraints={activeCapabilities.supportsCheckConstraints}
        onCreateUnique={handleCreateUniqueConstraint}
        onCreatePrimaryKey={handleCreatePrimaryKey}
        onCreateCheck={handleCreateCheckConstraint}
        onCreateForeignKey={handleCreateForeignKey}
      />
    </div>
  );
}
