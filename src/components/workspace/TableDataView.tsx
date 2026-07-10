import { useCallback, useEffect, useRef, useState } from "react";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTaskStore } from "@/store/useTaskStore";
import { databaseService, schemaService, tableService } from "@/services/tauri";
import type {
  ColumnInfo,
  ConstraintInfo,
  DatabaseCapabilities,
  IndexInfo,
  TableExportFormat,
} from "@/services/tauri/types";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { DataGrid } from "./DataGrid";
import { GridFilterRow } from "./GridFilterRow";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  KeyRound,
  Link2,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  TableProperties,
  Trash2,
  Upload,
} from "lucide-react";
import { CreateConstraintDialog } from "./CreateConstraintDialog";
import { CreateIndexDialog } from "./CreateIndexDialog";
import {
  DEFAULT_DATABASE_DRIVER,
  canAlterRelationStructure,
  canManageRelationIndexes,
  defaultDatabaseCapabilities,
  isReadOnlyRelationObject,
} from "@/lib/databaseDialect";

export function TableDataView() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const {
    tabs,
    activeTabId,
    setFilterMode,
    setVisualFilters,
    setSqlFilter,
    loadTablePage,
  } = useTabStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const { bumpMetadataVersion } = useSchemaStore();
  const { startTask, updateTask, finishTask, failTask } = useTaskStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const tabConnectionId = activeTab?.connectionId || activeConnectionId;
  const activeConnection = connections.find((c) => c.id === tabConnectionId);
  const driver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  const [capabilities, setCapabilities] = useState<DatabaseCapabilities>(() =>
    defaultDatabaseCapabilities(driver)
  );
  const activeCapabilities =
    capabilities.driver === driver ? capabilities : defaultDatabaseCapabilities(driver);
  const isReadOnlyRelation = isReadOnlyRelationObject(activeTab?.objectType);
  const canManageIndexes =
    activeCapabilities.supportsTableIndexes &&
    canManageRelationIndexes(activeTab?.objectType);
  const canManageConstraints =
    activeCapabilities.supportsTableConstraints &&
    canAlterRelationStructure(activeTab?.objectType);
  const [fallbackColumns, setFallbackColumns] = useState<
    Array<{ name: string; type?: string }>
  >([]);
  const [metadataColumns, setMetadataColumns] = useState<ColumnInfo[]>([]);
  const [tableIndexes, setTableIndexes] = useState<IndexInfo[]>([]);
  const [tableConstraints, setTableConstraints] = useState<ConstraintInfo[]>(
    []
  );
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [isIndexDialogOpen, setIsIndexDialogOpen] = useState(false);
  const [isIndexSubmitting, setIsIndexSubmitting] = useState(false);
  const [isConstraintDialogOpen, setIsConstraintDialogOpen] = useState(false);
  const [isConstraintSubmitting, setIsConstraintSubmitting] = useState(false);

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

  const refreshStructure = useCallback(async () => {
    if (
      activeTab?.type !== "table" ||
      !tabConnectionId ||
      !activeTab.schemaName ||
      !activeTab.tableName
    ) {
      return;
    }

    setIsMetadataLoading(true);
    setMetadataError(null);
    setMetadataColumns([]);
    setFallbackColumns([]);
    setTableIndexes([]);
    setTableConstraints([]);

    try {
      const [columns, indexes, constraints] = await Promise.all([
        schemaService.getColumns(
          tabConnectionId,
          activeTab.schemaName,
          activeTab.tableName
        ),
        activeCapabilities.supportsTableIndexes
          ? schemaService.getIndexes(
              tabConnectionId,
              activeTab.schemaName,
              activeTab.tableName
            )
          : Promise.resolve([]),
        activeCapabilities.supportsTableConstraints
          ? schemaService.getConstraints(
              tabConnectionId,
              activeTab.schemaName,
              activeTab.tableName
            )
          : Promise.resolve([]),
      ]);
      setMetadataColumns(columns);
      setFallbackColumns(
        columns.map((column) => ({
          name: column.name,
          type: column.data_type,
        }))
      );
      setTableIndexes(indexes);
      setTableConstraints(constraints);
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
      console.error("Failed to fetch table metadata:", err);
    } finally {
      setIsMetadataLoading(false);
    }
  }, [
    activeTab?.type,
    activeTab?.schemaName,
    activeTab?.tableName,
    activeCapabilities.supportsTableConstraints,
    activeCapabilities.supportsTableIndexes,
    tabConnectionId,
  ]);

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
      void loadTablePage(activeTab.id, 0);
    }
  }, [activeTab, loadTablePage, tabConnectionId]);

  // Fetch structure metadata for empty headers, save logic, and table inspection.
  useEffect(() => {
    void refreshStructure();
  }, [activeTab?.id, refreshStructure]);

  if (!activeTab || activeTab.type !== "table") return null;

  const result = activeTab?.results?.[0];

  // Get columns from result or fallback
  const columns =
    (result?.columns?.length ? result.columns : fallbackColumns).map((col) => ({
      title: col.name,
      id: col.name,
      width: 150,
    })) || [];

  // Get filter state from active tab
  const filterMode = activeTab.filterMode || "visual";
  const visualFilters = activeTab.visualFilters || [];
  const sqlFilter = activeTab.sqlFilter || "";

  const handleSearch = () => {
    if (!activeTab || !activeTab.tableName || !activeTab.schemaName) return;

    if (filterMode === "sql") {
      let whereClause = sqlFilter.trim();
      if (whereClause && !whereClause.toUpperCase().startsWith("WHERE")) {
        whereClause = "WHERE " + whereClause;
      }
      void loadTablePage(activeTab.id, 0, whereClause || null, null);
      return;
    }

    const activeVisualFilters = visualFilters.filter(
      (filter) => filter.column && filter.operator
    );

    void loadTablePage(
      activeTab.id,
      0,
      null,
      activeVisualFilters.length > 0 ? activeVisualFilters : null
    );
  };

  const page = activeTab.tablePage || 0;
  const pageSize = activeTab.tablePageSize || 500;
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
  const metadataPrimaryKeyColumns = metadataColumns
    .filter((column) => column.is_primary_key)
    .map((column) => column.name);
  const primaryKeyColumns =
    metadataPrimaryKeyColumns.length > 0
      ? metadataPrimaryKeyColumns
      : tableIndexes.find((index) => index.is_primary)?.columns || [];
  const foreignKeys = tableConstraints.filter((constraint) =>
    constraint.constraint_type.toUpperCase().includes("FOREIGN")
  );

  const formatColumnList = (columns: string[]) =>
    columns.length > 0 ? columns.join(", ") : "-";

  const renderMetadataRow = (
    key: string,
    label: string,
    value: string,
    detail?: string | null
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
    void loadTablePage(activeTab.id, page);
  };

  const handlePrevious = () => {
    if (canPrevious) {
      void loadTablePage(activeTab.id, page - 1);
    }
  };

  const handleNext = () => {
    if (canNext) {
      void loadTablePage(activeTab.id, page + 1);
    }
  };

  const handleExport = async (format: TableExportFormat) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      activeTab.isExecuting
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
        sort
      );
      finishTask(
        taskId,
        `${exported.rowsExported.toLocaleString()} rows to ${format.toUpperCase()}`
      );
      await revealItemInDir(exported.filePath);
    } catch (error) {
      failTask(taskId, error instanceof Error ? error.message : String(error));
      console.error("Table export failed:", error);
    }
  };

  const parseCsv = (content: string) => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    for (let index = 0; index < content.length; index += 1) {
      const char = content[index];
      const nextChar = content[index + 1];

      if (char === '"' && inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && nextChar === "\n") {
          index += 1;
        }
        row.push(cell);
        if (row.some((value) => value.length > 0)) {
          rows.push(row);
        }
        row = [];
        cell = "";
        continue;
      }

      cell += char;
    }

    row.push(cell);
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }

    return rows;
  };

  const handleImportCsv = async (file: File) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      activeTab.isExecuting ||
      isReadOnlyRelation
    ) {
      return;
    }

    const taskId = startTask({
      kind: "import",
      title: `Import ${file.name}`,
      detail: activeTab.tableName,
    });

    const content = await file.text();
    const rows = parseCsv(content);
    const [headers, ...dataRows] = rows;
    const normalizedHeaders = (headers || []).map((header) => header.trim());
    if (normalizedHeaders.length === 0 || dataRows.length === 0) {
      failTask(taskId, "CSV file has no importable rows");
      return;
    }

    updateTask(taskId, {
      detail: `${dataRows.length.toLocaleString()} rows parsed`,
    });

    const knownColumns = new Set(
      (metadataColumns.length > 0
        ? metadataColumns.map((column) => column.name)
        : normalizedHeaders
      ).map((column) => column.toLowerCase())
    );
    const insertRows = dataRows.map((values) =>
      normalizedHeaders.reduce<Record<string, unknown>>((record, header, index) => {
        if (!header || !knownColumns.has(header.toLowerCase())) return record;
        const value = values[index] ?? "";
        record[header] = value === "" ? null : value;
        return record;
      }, {})
    );

    const usableRows = insertRows.filter((row) => Object.keys(row).length > 0);
    if (usableRows.length === 0) {
      failTask(taskId, "CSV headers do not match table columns");
      return;
    }

    try {
      await tableService.mutateTableRows(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        usableRows
      );
      finishTask(taskId, `${usableRows.length.toLocaleString()} rows imported`);
      await loadTablePage(activeTab.id, page);
    } catch (error) {
      failTask(taskId, error instanceof Error ? error.message : String(error));
      console.error("CSV import failed:", error);
    }
  };

  const handleCreateIndex = async (
    indexName: string,
    columns: string[],
    unique: boolean
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
        unique
      );
      setIsIndexDialogOpen(false);
      await refreshStructure();
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
      `Drop index "${index.name}" from "${activeTab.tableName}"?`
    );
    if (!confirmed) return;

    setMetadataError(null);
    try {
      await tableService.dropTableIndex(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        index.name
      );
      await refreshStructure();
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
        trimmedName
      );
      await refreshStructure();
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    }
  };

  const handleCreateUniqueConstraint = async (
    constraintName: string,
    columns: string[]
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
        columns
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure();
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleCreatePrimaryKey = async (
    constraintName: string,
    columns: string[]
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
        columns
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure();
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleCreateCheckConstraint = async (
    constraintName: string,
    expression: string
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
        expression
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure();
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
        request.onUpdate
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure();
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
      `Drop constraint "${constraint.name}" from "${activeTab.tableName}"?`
    );
    if (!confirmed) return;

    setMetadataError(null);
    try {
      await tableService.dropTableConstraint(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraint.name
      );
      await refreshStructure();
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    }
  };

  return (
    <div className="flex flex-col h-full wb-grid-surface">
      {/* Query Builder Filter Row */}
      {(result || fallbackColumns.length > 0) && (
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
        />
      )}

      <div className="shrink-0 border-b wb-data-toolbar px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void handleImportCsv(file);
              }
            }}
          />
          <div className="flex min-w-0 flex-1 items-center gap-3 text-xs text-[hsl(var(--wb-text-muted))]">
            <span className="flex min-w-0 items-center gap-1.5">
              <TableProperties size={13} className="shrink-0" />
              <span className="truncate">
                {metadataColumns.length.toLocaleString()} columns
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <KeyRound size={13} className="shrink-0" />
              <span className="truncate">
                {primaryKeyColumns.length > 0
                  ? primaryKeyColumns.join(", ")
                  : "No primary key"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <ListTree size={13} />
              {tableIndexes.length.toLocaleString()} indexes
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <Link2 size={13} />
              {foreignKeys.length.toLocaleString()} foreign keys
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
              onClick={() => importInputRef.current?.click()}
              disabled={activeTab.isExecuting || isReadOnlyRelation}
              title={
                isReadOnlyRelation
                  ? "Import is disabled for read-only objects"
                  : "Import CSV into this table"
              }
            >
              <Upload size={13} className="mr-1.5" />
              Import
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
              onClick={() => void handleExport("csv")}
              disabled={activeTab.isExecuting}
              title="Export table data as CSV"
            >
              <Download size={13} className="mr-1.5" />
              CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
              onClick={() => void handleExport("json")}
              disabled={activeTab.isExecuting}
              title="Export table data as JSON"
            >
              <FileJson size={13} className="mr-1.5" />
              JSON
            </Button>
            <div className="mx-1 h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
              onClick={() => setShowStructure((value) => !value)}
              title="Toggle table structure"
            >
              <ListTree size={13} className="mr-1.5" />
              Structure
            </Button>
          </div>
        </div>
        {metadataError && (
          <div className="mt-1 truncate text-xs text-destructive">
            {metadataError}
          </div>
        )}
        {isMetadataLoading && !metadataError && (
          <div className="mt-1 text-xs text-[hsl(var(--wb-text-muted))]">
            Loading structure...
          </div>
        )}
      </div>

      {showStructure && (
        <div className="grid max-h-44 shrink-0 grid-cols-3 gap-4 overflow-auto border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2 text-xs">
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
                    .join(", ")
                )
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
                  activeCapabilities.supportsTableIndexes
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
                  activeCapabilities.supportsTableConstraints
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
                    constraint.referenced_columns
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

      <div className="h-9 shrink-0 border-b wb-data-toolbar flex items-center justify-between px-3">
        <div className="text-xs text-[hsl(var(--wb-text-muted))]">
          {totalRows == null
            ? `${visibleRows.toLocaleString()} rows`
            : `${startRow.toLocaleString()}-${endRow.toLocaleString()} of ${totalRows.toLocaleString()}`}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-7 w-7"
            disabled={activeTab.isExecuting}
            onClick={() => void handleExport("csv")}
            title="Export CSV"
          >
            <Download size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-7 w-7"
            disabled={activeTab.isExecuting}
            onClick={() => void handleExport("json")}
            title="Export JSON"
          >
            <FileJson size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-7 w-7"
            disabled={activeTab.isExecuting}
            onClick={handleRefresh}
            title="Refresh page"
          >
            <RefreshCw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-7 w-7"
            disabled={!canPrevious}
            onClick={handlePrevious}
            title="Previous page"
          >
            <ChevronLeft size={14} />
          </Button>
          <span className="min-w-14 text-center text-xs text-[hsl(var(--wb-text-muted))]">
            {page + 1}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-7 w-7"
            disabled={!canNext}
            onClick={handleNext}
            title="Next page"
          >
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="flex-1 min-h-0 wb-grid-surface">
        <DataGrid
          overrideColumns={fallbackColumns}
          readOnly={isReadOnlyRelation}
        />
      </div>
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
