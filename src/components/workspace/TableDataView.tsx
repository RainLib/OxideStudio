import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { confirmDiscardTableChanges, useTabStore } from "@/store/useTabStore";
import {
  ensureConnectionReady,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTaskStore } from "@/store/useTaskStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { databaseService, schemaService, tableService } from "@/services/tauri";
import { loadTableDdl, loadTableMetadata } from "@/services/tableMetadataCache";
import type {
  ColumnInfo,
  ConstraintInfo,
  DatabaseCapabilities,
  ForeignKeyReferenceInfo,
  IndexInfo,
  TableCsvImportOptions,
  TableImportMode,
  TableJsonImportPreview,
  TableXlsxImportPreview,
  TableExportFormat,
  TableExportEncoding,
  TableExportReport,
  SqlInsertConflictPolicy,
} from "@/services/tauri/types";
import { isTauri } from "@tauri-apps/api/core";
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
  RefreshCw,
  TableProperties,
  Trash2,
} from "lucide-react";
import { CreateConstraintDialog } from "./CreateConstraintDialog";
import { CreateIndexDialog } from "./CreateIndexDialog";
import { CsvImportDialog } from "./CsvImportDialog";
import { JsonImportDialog } from "./JsonImportDialog";
import { TableDataTransferDialog } from "./TableDataTransferDialog";
import {
  DEFAULT_DATABASE_DRIVER,
  canAlterRelationStructure,
  canManageRelationIndexes,
  defaultDatabaseCapabilities,
  isRelationalDataModel,
  isReadOnlyRelationObject,
  normalizeDatabaseDriverName,
} from "@/lib/databaseDialect";
import { stepGridZoom } from "@/lib/dataGridView";
import { cn } from "@/lib/utils";
import {
  APP_EVENT_REQUEST_TABLE_CSV_IMPORT,
  APP_EVENT_REQUEST_TABLE_JSON_IMPORT,
  APP_EVENT_REQUEST_TABLE_XLSX_IMPORT,
  type TableCsvImportRequest,
  type TableJsonImportRequest,
  type TableXlsxImportRequest,
} from "@/lib/actionEvents";
import { transposeQueryResult } from "@/features/data-grid";

const MongoDocumentCloneDialog = lazy(() =>
  import("@/features/data-grid/ui/MongoDocumentCloneDialog").then((module) => ({
    default: module.MongoDocumentCloneDialog,
  })),
);

const MongoDocumentMutationDialog = lazy(() =>
  import("@/features/data-grid/ui/MongoDocumentMutationDialog").then(
    (module) => ({ default: module.MongoDocumentMutationDialog }),
  ),
);

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
    loadDocumentPage,
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
  const { startTask, updateTask, finishTask, failTask, cancelTask } =
    useTaskStore();
  const activeTableExportRef = useRef<{
    exportId: string;
    taskId: string;
  } | null>(null);
  const activeTableImportsRef = useRef(new Map<string, string>());
  const [activeCsvImportId, setActiveCsvImportId] = useState<string | null>(null);
  const [activeTableExport, setActiveTableExport] = useState<{
    exportId: string;
    taskId: string;
  } | null>(null);
  const [recentExportReport, setRecentExportReport] =
    useState<TableExportReport | null>(null);
  const [exportMaxRows, setExportMaxRows] = useState<number | undefined>();
  const dataGridSettings = useSettingsStore((state) => state.settings.dataGrid);
  const refreshDdlOnOpen = useSettingsStore(
    (state) => state.settings.editor.refreshDdlOnOpen,
  );
  const defaultPageSize = dataGridSettings.pageSize;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const tabConnectionId = activeTab?.connectionId || activeConnectionId;
  const activeConnection = connections.find((c) => c.id === tabConnectionId);
  const driver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );
  const [connectionCapabilities, setConnectionCapabilities] = useState<{
    connectionId: string;
    capabilities: DatabaseCapabilities;
  } | null>(null);
  const resolvedCapabilities =
    connectionCapabilities &&
    connectionCapabilities.connectionId === activeConnection?.id
      ? connectionCapabilities.capabilities
      : null;
  const activeCapabilities =
    resolvedCapabilities?.driver === driver
      ? resolvedCapabilities
      : defaultDatabaseCapabilities(driver);
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
  const isNativeObjectPreview = Boolean(activeCapabilities.dataModel) &&
    !isRelationalDataModel(activeCapabilities);
  const isSearchObjectPreview = activeCapabilities.dataModel === "search";
  const isMongoDocumentPreview =
    activeCapabilities.dataModel === "document" &&
    normalizeDatabaseDriverName(driver) === "mongodb" &&
    !activeConnection?.driverPackageVersion;
  const isCrossDatabasePreview = Boolean(activeTab?.databaseName);
  const isReadOnlyRelation = isReadOnlyRelationObject(activeTab?.objectType);
  const isTableReadOnly = isReadOnlyRelation || isNativeObjectPreview;
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
  const [fallbackColumns, setFallbackColumns] = useState<
    Array<{ name: string; type?: string }>
  >([]);
  const [metadataColumns, setMetadataColumns] = useState<ColumnInfo[]>([]);
  const supportsSqlConflictUpdate =
    supportsSqlConflictSkip &&
    metadataColumns.some((column) => column.is_primary_key);
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
  const structureRequestRef = useRef(0);
  const ddlRequestRef = useRef(0);
  const isGridReadOnly = isTableReadOnly || !isEditingEnabled;

  const openCsvImportPicker = async () => {
    if (!isTauri()) {
      importInputRef.current?.click();
      return;
    }

    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Delimited text", extensions: ["csv", "tsv", "txt"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const preview = await tableService.previewTableCsvImport(selected);
      const bytes = new Uint8Array(preview.bytes);
      const file = new File([bytes], preview.fileName, { type: "text/plain" });
      setCsvImportSource({
        file,
        nativePath: selected,
        previewTruncated: preview.truncated,
        contentDigest: preview.contentDigest,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab?.id ? { ...tab, error: `Delimited text preview failed: ${message}` } : tab,
        ),
      }));
    }
  };

  const openJsonImportPicker = async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON data", extensions: ["json", "jsonl", "ndjson"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const preview = await tableService.previewTableJsonImport(selected);
      setJsonImportSource({ nativePath: selected, preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab?.id ? { ...tab, error: `JSON preview failed: ${message}` } : tab,
        ),
      }));
    }
  };

  const openXlsxImportPicker = async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const preview = await tableService.previewTableXlsxImport(selected);
      setXlsxImportSource({ nativePath: selected, preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab?.id ? { ...tab, error: `XLSX preview failed: ${message}` } : tab,
        ),
      }));
    }
  };

  useEffect(() => {
    if (typeof tableService.listenTableExportProgress !== "function") {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tableService
      .listenTableExportProgress((progress) => {
        const activeExport = activeTableExportRef.current;
        if (!activeExport || activeExport.exportId !== progress.exportId) return;
        const progressDetail = `${progress.rowsExported.toLocaleString()} rows in ${progress.batches.toLocaleString()} batches`;
        updateTask(activeExport.taskId, {
          detail: progress.message
            ? `${progressDetail} · ${progress.message}`
            : progressDetail,
        });
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error) => {
        console.error("Failed to listen for table export progress:", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [updateTask]);

  useEffect(() => {
    if (typeof tableService.listenTableImportProgress !== "function") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tableService
      .listenTableImportProgress((progress) => {
        const taskId = activeTableImportsRef.current.get(progress.importId);
        if (!taskId) return;
        const count = `${progress.rowsImported.toLocaleString()} rows in ${progress.batches.toLocaleString()} batches`;
        const total = progress.totalRows != null
          ? ` / ${progress.totalRows.toLocaleString()} total`
          : "";
        updateTask(taskId, {
          detail: progress.message
            ? `${count}${total} · ${progress.message}`
            : `${count}${total}`,
        });
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error) => {
        console.error("Failed to listen for table import progress:", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [updateTask]);

  useEffect(() => {
    let active = true;
    if (
      !activeProjectId ||
      !tabConnectionId ||
      !activeTab?.schemaName ||
      !activeTab.tableName ||
      typeof tableService.listTableExportReports !== "function"
    ) {
      setRecentExportReport(null);
      return () => {
        active = false;
      };
    }
    void tableService
      .listTableExportReports(activeProjectId, tabConnectionId, 20)
      .then((reports) => {
        if (!active) return;
        setRecentExportReport(
          reports.find(
            (report) =>
              report.schema === activeTab.schemaName &&
              report.table === activeTab.tableName,
          ) || null,
        );
      })
      .catch(() => {
        if (active) setRecentExportReport(null);
      });
    return () => {
      active = false;
    };
  }, [activeProjectId, activeTab?.schemaName, activeTab?.tableName, tabConnectionId]);

  useEffect(() => {
    const requestCsvImport = (
      event: Event,
    ) => {
      const detail = (event as CustomEvent<TableCsvImportRequest>).detail;
      if (
        !detail ||
        detail.connectionId !== tabConnectionId ||
        detail.schema !== activeTab?.schemaName ||
        detail.table !== activeTab?.tableName ||
        detail.database !== activeTab?.databaseName ||
        isTableReadOnly ||
        activeTab?.isExecuting
      ) {
        return;
      }
      void openCsvImportPicker();
    };
    window.addEventListener(APP_EVENT_REQUEST_TABLE_CSV_IMPORT, requestCsvImport);
    return () =>
      window.removeEventListener(
        APP_EVENT_REQUEST_TABLE_CSV_IMPORT,
        requestCsvImport,
      );
  }, [activeTab?.databaseName, activeTab?.isExecuting, activeTab?.schemaName, activeTab?.tableName, isTableReadOnly, tabConnectionId]);

  useEffect(() => {
    const requestXlsxImport = (event: Event) => {
      const detail = (event as CustomEvent<TableXlsxImportRequest>).detail;
      if (
        !detail ||
        detail.connectionId !== tabConnectionId ||
        detail.schema !== activeTab?.schemaName ||
        detail.table !== activeTab?.tableName ||
        detail.database !== activeTab?.databaseName ||
        isTableReadOnly ||
        activeTab?.isExecuting
      ) {
        return;
      }
      void openXlsxImportPicker();
    };
    window.addEventListener(APP_EVENT_REQUEST_TABLE_XLSX_IMPORT, requestXlsxImport);
    return () =>
      window.removeEventListener(
        APP_EVENT_REQUEST_TABLE_XLSX_IMPORT,
        requestXlsxImport,
      );
  }, [activeTab?.databaseName, activeTab?.isExecuting, activeTab?.schemaName, activeTab?.tableName, isTableReadOnly, tabConnectionId]);

  useEffect(() => {
    const requestJsonImport = (event: Event) => {
      const detail = (event as CustomEvent<TableJsonImportRequest>).detail;
      if (
        !detail ||
        detail.connectionId !== tabConnectionId ||
        detail.schema !== activeTab?.schemaName ||
        detail.table !== activeTab?.tableName ||
        detail.database !== activeTab?.databaseName ||
        isTableReadOnly ||
        activeTab?.isExecuting
      ) {
        return;
      }
      void openJsonImportPicker();
    };
    window.addEventListener(APP_EVENT_REQUEST_TABLE_JSON_IMPORT, requestJsonImport);
    return () =>
      window.removeEventListener(
        APP_EVENT_REQUEST_TABLE_JSON_IMPORT,
        requestJsonImport,
      );
  }, [activeTab?.databaseName, activeTab?.isExecuting, activeTab?.schemaName, activeTab?.tableName, isTableReadOnly, tabConnectionId]);

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
    if (!activeConnection) {
      setConnectionCapabilities(null);
      return () => {
        cancelled = true;
      };
    }
    setConnectionCapabilities(null);

    databaseService
      .getDatabaseCapabilities(driver, activeConnection?.driverPackageVersion)
      .then((nextCapabilities) => {
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            capabilities: nextCapabilities,
          });
        }
      })
      .catch((error) => {
        console.error("Failed to load database capabilities:", error);
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            capabilities: fallback,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeConnection?.driverPackageVersion,
    activeConnection?.id,
    driver,
    driverCatalogStatus,
  ]);

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
    setCsvImportSource(null);
    setIsTransferDialogOpen(false);
    setShowDdl(false);
    setShowStructure(false);
    setTableDdl("");
    setDdlError(null);
    setIsDdlLoading(false);
    setMongoDocumentAction(null);
    setDocumentFilterDraft(activeTab?.documentFilter || "");
    setDocumentSortDraft(activeTab?.documentSort || "");
  }, [activeTab?.id]);

  useEffect(() => {
    if (showDdl && !tableDdl && !isDdlLoading && !ddlError) {
      void refreshDdl(refreshDdlOnOpen);
    }
  }, [ddlError, isDdlLoading, refreshDdl, refreshDdlOnOpen, showDdl, tableDdl]);

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
      if (isSearchObjectPreview) {
        void loadDocumentPage(activeTab.id, 0);
      } else if (isNativeObjectPreview && activeTab.sql.trim()) {
        void runTabQuery(activeTab.id, tabConnectionId, activeTab.sql);
      } else {
        void loadTablePage(activeTab.id, 0);
      }
    }
  }, [
    activeTab,
    isNativeObjectPreview,
    isSearchObjectPreview,
    loadDocumentPage,
    loadTablePage,
    runTabQuery,
    tabConnectionId,
  ]);

  // Fetch structure metadata for empty headers, save logic, and table inspection.
  useEffect(() => {
    void refreshStructure(false);
  }, [activeTab?.id, refreshStructure]);

  if (!activeTab || activeTab.type !== "table") return null;

  const resultIndex = activeTab?.activeResultIndex ?? 0;
  const result =
    activeTab?.results?.[resultIndex] ?? activeTab?.results?.[0];
  const isTransposed = Boolean(activeTab && transposedTabIds.has(activeTab.id));
  const transposedResult = useMemo(
    () => (isTransposed && result ? transposeQueryResult(result) : undefined),
    [isTransposed, result],
  );
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
    (isSearchObjectPreview
      ? Boolean(activeTab.documentHasNextCursor)
      : visibleRows === pageSize &&
        (totalRows == null || (page + 1) * pageSize < totalRows));
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
    if (isSearchObjectPreview) {
      void loadDocumentPage(activeTab.id, 0, {
        discardAction: "refresh the index documents",
      });
      return;
    }
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

  const applyDocumentFilterAndSort = () => {
    if (!isSearchObjectPreview || activeTab.isExecuting) return;
    void loadDocumentPage(activeTab.id, 0, {
      filter: documentFilterDraft.trim() || null,
      sort: documentSortDraft.trim() || null,
      discardAction: "apply the document filter or sort order",
    });
  };

  const clearDocumentFilterAndSort = () => {
    if (!isSearchObjectPreview || activeTab.isExecuting) return;
    setDocumentFilterDraft("");
    setDocumentSortDraft("");
    void loadDocumentPage(activeTab.id, 0, {
      filter: null,
      sort: null,
      discardAction: "clear the document filter or sort order",
    });
  };

  const handleCalculateTotalRows = () => {
    if (
      isSearchObjectPreview ||
      isNativeObjectPreview ||
      activeTab.isExecuting ||
      hasEdits
    ) {
      return;
    }
    void loadTablePage(activeTab.id, page, undefined, undefined, {
      discardAction: "calculate the exact total",
      includeTotal: true,
    });
  };

  const openMongoDocumentAction = (
    mode: "clone" | "edit" | "delete",
    sourceRowIndex?: number,
  ) => {
    if (!isMongoDocumentPreview || !result || isTransposed) return;
    const selectedRows =
      sourceRowIndex === undefined
        ? dataGridRef.current?.getSelectedRowIndexes() || []
        : [sourceRowIndex];
    if (selectedRows.length !== 1) return;
    const selectedRow = selectedRows[0];
    if (selectedRow === undefined) return;
    const idColumn = result.columns.findIndex((column) => column.name === "_id");
    const sourceId = idColumn >= 0 ? result.rows[selectedRow]?.[idColumn] : undefined;
    if (sourceId === undefined || sourceId === null) return;
    setMongoDocumentAction({ mode, sourceId });
  };

  const handlePrevious = () => {
    if (canPrevious) {
      if (isSearchObjectPreview) {
        void loadDocumentPage(activeTab.id, page - 1, {
          discardAction: "change document pages",
        });
      } else {
        void loadTablePage(activeTab.id, page - 1, undefined, undefined, {
          discardAction: "change pages",
        });
      }
    }
  };

  const handleFirst = () => {
    if (canPrevious) {
      if (isSearchObjectPreview) {
        void loadDocumentPage(activeTab.id, 0, {
          discardAction: "return to the first document page",
        });
      } else {
        void loadTablePage(activeTab.id, 0, undefined, undefined, {
          discardAction: "change pages",
        });
      }
    }
  };

  const handleNext = () => {
    if (canNext) {
      if (isSearchObjectPreview) {
        void loadDocumentPage(activeTab.id, page + 1, {
          discardAction: "change document pages",
        });
      } else {
        void loadTablePage(activeTab.id, page + 1, undefined, undefined, {
          discardAction: "change pages",
        });
      }
    }
  };

  const handleLast = () => {
    if (canLast && lastPage != null) {
      void loadTablePage(activeTab.id, lastPage, undefined, undefined, {
        discardAction: "change pages",
      });
    }
  };

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
      const remainingCoercions = Math.max(
        0,
        exported.typeCoercions.length - 3,
      );
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
            const report = reports.find((item) => item.id === exported.reportId);
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
    const scopeLabel = includeStructure && includeData
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
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (code === "TABLE_IMPORT_CANCELLED") {
        cancelTask(taskId, "Import cancelled; transaction rolled back");
      } else {
        failTask(taskId, error instanceof Error ? error.message : String(error));
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
      const code = error && typeof error === "object" && "code" in error
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
    updateTask(taskId, { detail: "JSON preview approved; committing transaction" });
    const importId = tableService.createTableImportId();
    activeTableImportsRef.current.set(importId, taskId);
    try {
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
    updateTask(taskId, { detail: "XLSX preview approved; committing transaction" });
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
      !activeCapabilities.supportsIndexRename ||
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
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            setCsvImportSource({ file });
          }
        }}
      />

      <CsvImportDialog
        open={csvImportSource !== null}
        file={csvImportSource?.file || null}
        tableName={activeTab.tableName || "table"}
        columns={csvImportColumns}
        isSubmitting={isCsvImportSubmitting}
        isCancelling={isCsvImportCancelling}
        isNativeSource={Boolean(csvImportSource?.nativePath)}
        nativePreviewTruncated={csvImportSource?.previewTruncated}
        onClose={() => setCsvImportSource(null)}
        onCancelImport={activeCsvImportId ? handleCancelCsvImport : undefined}
        onImport={handleImportCsvRows}
      />

      <JsonImportDialog
        open={jsonImportSource !== null}
        preview={jsonImportSource?.preview || null}
        format="JSON"
        tableName={activeTab.tableName || "table"}
        columns={csvImportColumns}
        isSubmitting={isJsonImportSubmitting}
        onClose={() => setJsonImportSource(null)}
        onImport={handleImportJsonRows}
      />

      <JsonImportDialog
        open={xlsxImportSource !== null}
        preview={xlsxImportSource?.preview || null}
        format="XLSX"
        tableName={activeTab.tableName || "table"}
        columns={csvImportColumns}
        isSubmitting={isXlsxImportSubmitting}
        onClose={() => setXlsxImportSource(null)}
        onImport={handleImportXlsxRows}
      />

      {tabConnectionId && activeTab.schemaName && activeTab.tableName && (
        <TableDataTransferDialog
          open={isTransferDialogOpen}
          projectId={activeProjectId}
          source={{
            connectionId: tabConnectionId,
            driver,
            schema: activeTab.schemaName,
            table: activeTab.tableName,
            database: activeTab.databaseName || undefined,
          }}
          sourceCapabilities={activeCapabilities}
          connections={connections}
          onClose={() => setIsTransferDialogOpen(false)}
          onTransferred={handleRefresh}
        />
      )}

      {tabConnectionId &&
        activeTab.schemaName &&
        activeTab.tableName &&
        mongoDocumentAction?.mode === "clone" && (
          <Suspense fallback={null}>
            <MongoDocumentCloneDialog
              open
              connectionId={tabConnectionId}
              driver={driver}
              database={activeTab.schemaName}
              collection={activeTab.tableName}
              sourceId={mongoDocumentAction.sourceId}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setMongoDocumentAction(null);
              }}
              onCloned={async () => {
                if (tabConnectionId && activeTab.sql.trim()) {
                  await runTabQuery(activeTab.id, tabConnectionId, activeTab.sql);
                }
              }}
            />
          </Suspense>
        )}

      {tabConnectionId &&
        activeTab.schemaName &&
        activeTab.tableName &&
        mongoDocumentAction &&
        mongoDocumentAction.mode !== "clone" && (
          <Suspense fallback={null}>
            <MongoDocumentMutationDialog
              open
              mode={mongoDocumentAction.mode}
              connectionId={tabConnectionId}
              driver={driver}
              database={activeTab.schemaName}
              collection={activeTab.tableName}
              sourceId={mongoDocumentAction.sourceId}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setMongoDocumentAction(null);
              }}
              onMutated={async () => {
                if (tabConnectionId && activeTab.sql.trim()) {
                  await runTabQuery(activeTab.id, tabConnectionId, activeTab.sql);
                }
              }}
            />
          </Suspense>
        )}

      <TableDataToolbar
        isExecuting={activeTab.isExecuting}
        readOnly={isTableReadOnly}
        viewOnly={isTransposed}
        exportDisabled={isCrossDatabasePreview || isNativeObjectPreview}
        exportFormats={tableExportFormats}
        exportMaxRows={exportMaxRows}
        onExportMaxRowsChange={setExportMaxRows}
        supportsSqlConflictSkip={supportsSqlConflictSkip}
        supportsSqlConflictUpdate={supportsSqlConflictUpdate}
        isExporting={Boolean(activeTableExport)}
        transferDisabled={
          isCrossDatabasePreview ||
          isNativeObjectPreview ||
          !activeCapabilities.supportsTableDataTransfer
        }
        editingEnabled={isEditingEnabled}
        hasEdits={hasEdits}
        editedCellCount={activeTab.pendingEdits?.size || 0}
        newRowCount={activeTab.newRowsCount || 0}
        selectedRowCount={gridSelectionSummary.selectedRowCount}
        onRefresh={handleRefresh}
        onAddRow={() => addNewRow(activeTab.id)}
        onDeleteRows={() => void dataGridRef.current?.deleteSelectedRows()}
        onEditDocument={
          isMongoDocumentPreview
            ? () => openMongoDocumentAction("edit")
            : undefined
        }
        onDeleteDocument={
          isMongoDocumentPreview
            ? () => openMongoDocumentAction("delete")
            : undefined
        }
        onCloneDocument={
          isMongoDocumentPreview
            ? () => openMongoDocumentAction("clone")
            : undefined
        }
        cloneDocumentDisabled={
          isTransposed ||
          !result?.columns.some((column) => column.name === "_id")
        }
        onSave={() => void commitEdits(activeTab.id)}
        onRevert={() => cancelEdits(activeTab.id)}
        onSearch={() => dataGridRef.current?.openSearch()}
        onGoToColumn={() => dataGridRef.current?.openColumnLookup()}
        onFitColumns={() => dataGridRef.current?.fitColumns()}
        onResetColumns={() => resetColumnLayout(activeTab.id)}
        onToggleEditing={() => setIsEditingEnabled((value) => !value)}
        transposed={isTransposed}
        transposeDisabled={!result || hasEdits}
        onToggleTranspose={() => {
          setTransposedTabIds((previous) => {
            const next = new Set(previous);
            if (next.has(activeTab.id)) next.delete(activeTab.id);
            else next.add(activeTab.id);
            return next;
          });
        }}
        onImportCsv={() => void openCsvImportPicker()}
        onImportJson={() => void openJsonImportPicker()}
        onImportXlsx={() => void openXlsxImportPicker()}
        onTransfer={() => setIsTransferDialogOpen(true)}
        onExportCsv={() => void handleExport("csv", "utf8", undefined, "strict", exportMaxRows)}
        onExportCsvBom={() => void handleExport("csv", "utf8Bom", undefined, "strict", exportMaxRows)}
        onExportJson={() => void handleExport("json", "utf8", undefined, "strict", exportMaxRows)}
        onExportJsonl={() => void handleExport("jsonl", "utf8", undefined, "strict", exportMaxRows)}
        onExportMarkdown={() => void handleExport("markdown", "utf8", undefined, "strict", exportMaxRows)}
        onExportSql={(batchSize, conflictPolicy) =>
          void handleExport("sql", "utf8", batchSize, conflictPolicy, exportMaxRows)
        }
        onExportDatabaseSql={
          normalizeDatabaseDriverName(driver) === "postgres" &&
          !isCrossDatabasePreview &&
          !isNativeObjectPreview
            ? (scope) => void handleExportDatabaseSql(scope)
            : undefined
        }
        onExportTsv={() => void handleExport("tsv", "utf8", undefined, "strict", exportMaxRows)}
        onExportXlsx={(autoFilter) =>
          void handleExport(
            "xlsx",
            "binary",
            undefined,
            "strict",
            exportMaxRows,
            autoFilter,
          )
        }
        onExportParquet={() => void handleExport("parquet", "binary", undefined, "strict", exportMaxRows)}
        onExportArrow={() => void handleExport("arrow", "binary", undefined, "strict", exportMaxRows)}
        onCancelExport={() => void handleCancelExport()}
      />

      {recentExportReport && (
        <div
          className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-1 text-[10px] wb-muted"
          title={recentExportReport.error || "Latest export audit record"}
        >
          Latest export: {recentExportReport.status} · {recentExportReport.format.toUpperCase()} · {recentExportReport.encoding === "utf8Bom" ? "UTF-8 BOM" : recentExportReport.encoding === "binary" ? "Binary" : "UTF-8"} · {recentExportReport.maxRows ? `first ${recentExportReport.maxRows.toLocaleString()} requested · ` : "all matching rows · "}{recentExportReport.rowsExported.toLocaleString()} rows · {recentExportReport.batches.toLocaleString()} batches
        </div>
      )}

      {isSearchObjectPreview &&
        !showStructure &&
        !showDdl &&
        !isTransposed && (
          <form
            className="flex shrink-0 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              applyDocumentFilterAndSort();
            }}
          >
            <input
              value={documentFilterDraft}
              onChange={(event) => setDocumentFilterDraft(event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
              placeholder={
                normalizeDatabaseDriverName(driver) === "meilisearch"
                  ? 'Filter: {"status":"published"} or status = "published"'
                  : 'Filter JSON: {"term":{"status":"published"}}'
              }
              aria-label="Document filter"
              disabled={activeTab.isExecuting}
            />
            <input
              value={documentSortDraft}
              onChange={(event) => setDocumentSortDraft(event.target.value)}
              className="h-7 w-48 max-w-[30%] rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
              placeholder={
                normalizeDatabaseDriverName(driver) === "meilisearch"
                  ? 'Sort: {"title":"asc"}'
                  : 'Sort JSON: [{"createdAt":"desc"}]'
              }
              aria-label="Document sort"
              disabled={activeTab.isExecuting}
            />
            <Button type="submit" variant="outline" size="sm" disabled={activeTab.isExecuting}>
              Apply
            </Button>
            {(documentFilterDraft || documentSortDraft || activeTab.documentFilter || activeTab.documentSort) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={activeTab.isExecuting}
                onClick={clearDocumentFilterAndSort}
              >
                Clear
              </Button>
            )}
          </form>
        )}

      {/* Query Builder Filter Row */}
      {!isNativeObjectPreview &&
        !showStructure &&
        !showDdl &&
        !isTransposed &&
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
            capabilities={activeCapabilities}
            tabId={activeTab.id}
            databaseName={activeTab.databaseName}
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
                    disabled={
                      !canManageIndexes ||
                      index.is_primary ||
                      !activeCapabilities.supportsIndexRename
                    }
                    onClick={() => void handleRenameIndex(index)}
                    title={
                      !canManageIndexes
                        ? "Index changes are not available for this object"
                        : index.is_primary
                          ? "Primary indexes are managed through constraints"
                          : !activeCapabilities.supportsIndexRename
                            ? "This driver requires recreating indexes to rename"
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
            resultOverride={transposedResult}
            transposed={isTransposed}
            onEditDocument={
              isMongoDocumentPreview && !isTransposed
                ? (rowIndex) => openMongoDocumentAction("edit", rowIndex)
                : undefined
            }
            onCloneDocument={
              isMongoDocumentPreview && !isTransposed
                ? (rowIndex) => openMongoDocumentAction("clone", rowIndex)
                : undefined
            }
            onDeleteDocument={
              isMongoDocumentPreview && !isTransposed
                ? (rowIndex) => openMongoDocumentAction("delete", rowIndex)
                : undefined
            }
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
            {!isSearchObjectPreview && !isNativeObjectPreview && (
              <button
                type="button"
                className="wb-icon-button"
                disabled={activeTab.isExecuting || hasEdits}
                onClick={handleCalculateTotalRows}
                title={
                  hasEdits
                    ? "Apply or discard edits before calculating the exact total"
                    : "Calculate exact total rows for the current filter"
                }
                aria-label="Calculate exact total rows"
              >
                <RefreshCw
                  size={12}
                  className={activeTab.isExecuting ? "animate-spin" : undefined}
                />
              </button>
            )}
            <span className="min-w-[112px] px-1 text-center text-[10px] tabular-nums text-[hsl(var(--wb-text-muted))]">
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
              disabled={isSearchObjectPreview || !canLast}
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
