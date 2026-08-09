import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  databaseService,
  queryService,
  QueryResult,
  tableService,
} from "@/services/tauri";
import type {
  ColumnDef,
  ColumnInfo,
  ConstraintInfo,
  ExplainPlan,
  ExplainPlanMode,
  IndexInfo,
  SchemaDiffPlan,
  SchemaSnapshot,
  TableFilter,
  TableSort,
} from "@/services/tauri/types";
import {
  loadTableMetadata,
  type TableMetadataSnapshot,
} from "@/services/tableMetadataCache";
import { useHistoryStore } from "./useHistoryStore";
import {
  queryHistoryRowCount,
  queryHistoryStatusFromError,
} from "@/lib/queryHistory";
import {
  ensureConnectionReady,
  restoreConnectionSession,
  useConnectionStore,
} from "./useConnectionStore";
import { useSchemaStore } from "./useSchemaStore";
import { useTaskStore } from "./useTaskStore";
import type { FilterOperator } from "@/components/workspace/GridFilterRow";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import {
  classifyAiQuerySafety,
  redisSelectedDatabase,
} from "@/lib/querySafety";
import type { Diagnostic } from "@/services/lsp/types";
import type { SchemaDiagramAreaHistory } from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import {
  extractQueryExecutionError,
  isMissingConnectionSession,
  type QueryExecutionErrorDetail,
} from "@/lib/queryErrorPresentation";
import {
  extractSchemaContextChange,
  metadataRefreshNamespaces,
  queryMayChangeMetadata,
} from "@/lib/sqlAnalysis";
import {
  applyEditorTextPatch,
  type EditorPatchApplyResult,
  type EditorPatchPreview,
} from "@/lib/editorPatch";
import { documentTextRevision } from "@/lib/documentRevision";
import { compileElasticsearchConsoleExecution } from "@/lib/elasticsearchConsole";
import type { DataCompareSource } from "@/lib/dataCompare";
import type { AgentFileDiffPreview } from "@/lib/agentFileReview";
import type { GitFileDiffPreview } from "@/lib/projectGitDiff";
import {
  removeGridLayout,
  saveGridLayout,
  type GridLayoutScope,
  type PersistedGridLayout,
} from "@/features/data-grid";

function gridLayoutScopeForTab(tab: TabData): GridLayoutScope {
  return {
    type: tab.type,
    connectionId: tab.connectionId,
    databaseName: tab.databaseName,
    schemaName: tab.schemaName,
    tableName: tab.tableName,
    queryLanguage: tab.queryLanguage,
    sql: tab.sql,
  };
}

function saveTabGridLayout(tab: TabData) {
  saveGridLayout(gridLayoutScopeForTab(tab), {
    columnWidths: tab.columnWidths || {},
    columnOrder: tab.columnOrder || [],
    hiddenColumns: tab.hiddenColumns || [],
    frozenColumnCount: tab.frozenColumnCount || 0,
  });
}

async function refreshMetadataAfterQuery(
  connectionId: string,
  schemaContext: string | undefined,
  sql: string,
  results: QueryResult[] | null | undefined,
) {
  const schemaStore = useSchemaStore.getState();
  const connection = useConnectionStore
    .getState()
    .connections.find((item) => item.id === connectionId);
  const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
  const fallbackCapabilities = defaultDatabaseCapabilities(driver);
  const capabilities = await databaseService
    .getDatabaseCapabilities(driver, connection?.driverPackageVersion)
    .catch(() => fallbackCapabilities);
  const canBrowseTables = supportsTableWorkspace(capabilities);
  const canBrowseCollections =
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing;
  const safety = classifyAiQuerySafety(sql, driver);
  const shouldRefreshObjects =
    queryMayChangeMetadata(sql, results) ||
    (capabilities.dataModel !== "relational" && safety !== "read");

  const refreshNamespaceObjects = async (namespace: string | undefined) => {
    if (!namespace) return;

    const tasks: Promise<void>[] = [];
    if (canBrowseTables) {
      tasks.push(schemaStore.loadTables(connectionId, namespace, true));
      if (capabilities.supportsFunctions) {
        tasks.push(schemaStore.loadFunctions(connectionId, namespace, true));
      }
    }
    if (canBrowseCollections) {
      tasks.push(schemaStore.loadCollections(connectionId, namespace, true));
    }
    await Promise.all(tasks);
  };

  const selectedSchema =
    capabilities.dataModel === "keyValue"
      ? redisSelectedDatabase(sql)
      : extractSchemaContextChange(sql);

  if (selectedSchema) {
    await schemaStore.setCurrentSchema(selectedSchema);
    await refreshNamespaceObjects(selectedSchema);
    schemaStore.bumpMetadataVersion();
    return;
  }

  if (!shouldRefreshObjects) return;

  await schemaStore.loadSchemas(connectionId, true);
  const fallbackSchema =
    useSchemaStore.getState().currentSchema || schemaContext || undefined;
  const namespacesToRefresh = metadataRefreshNamespaces(
    sql,
    fallbackSchema,
    driver,
  );
  await Promise.all(namespacesToRefresh.map(refreshNamespaceObjects));
  schemaStore.bumpMetadataVersion();
}

export type TabType =
  | "query"
  | "table"
  | "create_table"
  | "schema_diff"
  | "schema_diagram"
  | "data_compare";
export type QueryLanguage = "elasticsearch-dsl" | "elasticsearch-eql";

const ELASTICSEARCH_REQUEST_LINE =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+/i;

export function queryTextForLanguage(
  query: string,
  driver: string,
  language?: QueryLanguage,
  elasticsearchVariables?: Record<string, string>,
) {
  const trimmed = query.trim();
  const isElasticsearch = ["elasticsearch", "elastic"].includes(
    driver.trim().toLowerCase(),
  );
  if (!isElasticsearch) {
    return query;
  }
  if (language !== "elasticsearch-eql") {
    return compileElasticsearchConsoleExecution(
      query,
      elasticsearchVariables,
    );
  }
  if (ELASTICSEARCH_REQUEST_LINE.test(trimmed)) return query;

  const body = trimmed.startsWith("{")
    ? trimmed
    : JSON.stringify({ query: trimmed }, null, 2);
  return `POST /_eql/search\n${body}`;
}

export interface EditorSelectionState {
  text: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface ProjectFileImagePreview {
  kind: "image";
  mediaType: string;
  dataUrl: string;
  size: number;
}

export interface TabData {
  id: string;
  title: string;
  type: TabType;
  sql: string;
  connectionId?: string;
  /**
   * An explicitly selected database on the same server connection.
   *
   * PostgreSQL query and table tabs use this when targeting a database that
   * differs from the one configured on the saved connection.
   */
  databaseName?: string;
  tableName?: string;
  schemaName?: string;
  objectType?: string | null;
  queryLanguage?: QueryLanguage;
  elasticsearchVariables?: Record<string, string>;
  filters?: any[];
  results: QueryResult[] | null;
  explainPlan?: ExplainPlan | null;
  queryOutputView?: "results" | "plan";
  isExecuting: boolean;
  runningQueryId?: string | null;
  error: string | null;
  queryError?: QueryExecutionErrorDetail | null;
  activeResultIndex?: number;
  isPinned: boolean;
  gridState?: {
    columnFilters: Record<string, { operator: string; value: string }>;
    sortColumn: string | null;
    sortDirection: "asc" | "desc" | null;
  };
  pendingEdits?: Map<string, any>; // key: "rowIndex:colIndex" or "new-N:colIndex", value: new value
  newRowsCount?: number;
  // Filter UI state (per-tab)
  filterMode?: "visual" | "sql";
  visualFilters?: Array<{
    column: string;
    operator: FilterOperator;
    value: string;
    logic?: "AND" | "OR";
  }>;
  sqlFilter?: string;
  // Column layout state (per-tab)
  columnWidths?: Record<string, number>;
  columnOrder?: string[];
  hiddenColumns?: string[];
  frozenColumnCount?: number;
  // Target schema for query execution
  targetSchema?: string | null;
  tableColumns?: ColumnInfo[];
  tableIndexes?: IndexInfo[];
  tableConstraints?: ConstraintInfo[];
  tableMetadataSource?: "cache" | "remote";
  tableMetadataUpdatedAt?: number;
  isFetchingColumns?: boolean;
  tablePage?: number;
  tablePageSize?: number;
  tableTotalRows?: number | null;
  tableFilterSql?: string | null;
  tableFilters?: TableFilter[] | null;
  editorSelection?: EditorSelectionState | null;
  editorPatchPreview?: EditorPatchPreview | null;
  agentFileDiffPreview?: AgentFileDiffPreview | null;
  gitFileDiffPreview?: GitFileDiffPreview | null;
  lspDiagnostics?: Diagnostic[];
  fileProjectId?: string;
  fileRootPath?: string;
  fileRelativePath?: string;
  fileRevision?: string;
  filePreview?: ProjectFileImagePreview;
  isDirty?: boolean;
  fileError?: string | null;
  schemaDiffPlan?: SchemaDiffPlan;
  schemaDiffSource?: SchemaSnapshot;
  schemaDiffTarget?: SchemaSnapshot;
  selectedSchemaChangeId?: string | null;
  schemaDiagramSnapshot?: SchemaSnapshot;
  selectedDiagramRelationName?: string | null;
  schemaDiagramAreaHistory?: SchemaDiagramAreaHistory;
  schemaDiagramNotes?: SchemaDiagramNote[];
  selectedDiagramAreaId?: string | null;
  selectedDiagramRelationNames?: string[];
  dataCompareLeft?: DataCompareSource;
  dataCompareRight?: DataCompareSource;
}

function fileNameFromPath(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);
  return segments[segments.length - 1] || relativePath;
}

export function hasPendingTableChanges(
  tab: Pick<TabData, "type" | "pendingEdits" | "newRowsCount">,
) {
  return (
    tab.type === "table" &&
    ((tab.pendingEdits?.size || 0) > 0 || (tab.newRowsCount || 0) > 0)
  );
}

export function hasUnsavedTabChanges(
  tab: Pick<
    TabData,
    "type" | "fileRelativePath" | "isDirty" | "pendingEdits" | "newRowsCount"
  >,
) {
  return (
    Boolean(tab.fileRelativePath && tab.isDirty) || hasPendingTableChanges(tab)
  );
}

function confirmDiscardTabChanges(tabs: TabData[], action: string) {
  const dirtyFiles = tabs.filter((tab) => tab.fileRelativePath && tab.isDirty);
  const dirtyTables = tabs.filter(hasPendingTableChanges);
  if (dirtyFiles.length === 0 && dirtyTables.length === 0) return true;
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }

  const details: string[] = [];
  if (dirtyFiles.length > 0) {
    const names = dirtyFiles
      .slice(0, 3)
      .map((tab) => tab.fileRelativePath)
      .join(", ");
    const remaining = dirtyFiles.length - Math.min(3, dirtyFiles.length);
    details.push(
      `${dirtyFiles.length} project file${dirtyFiles.length === 1 ? "" : "s"}: ${names}${
        remaining > 0 ? ` and ${remaining} more` : ""
      }`,
    );
  }
  if (dirtyTables.length > 0) {
    const editedCells = dirtyTables.reduce(
      (total, tab) => total + (tab.pendingEdits?.size || 0),
      0,
    );
    const newRows = dirtyTables.reduce(
      (total, tab) => total + (tab.newRowsCount || 0),
      0,
    );
    details.push(
      `${dirtyTables.length} table tab${dirtyTables.length === 1 ? "" : "s"} (${editedCells} edited cell${
        editedCells === 1 ? "" : "s"
      }, ${newRows} new row${newRows === 1 ? "" : "s"})`,
    );
  }

  return window.confirm(
    `Unsaved changes will be discarded when you ${action}.\n\n${details.join(
      "\n",
    )}\n\nUse Submit Changes or save the file first to keep them. Select OK to discard, or Cancel to stay.`,
  );
}

function tableTabAfterDiscardingDrafts(tab: TabData) {
  return hasPendingTableChanges(tab)
    ? { ...tab, pendingEdits: new Map<string, any>(), newRowsCount: 0 }
    : tab;
}

export function confirmDiscardTableChanges(tabId: string, action: string) {
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId);
  return !tab || confirmDiscardTabChanges([tab], action);
}

function normalizedDatabaseName(databaseName: string | null | undefined) {
  return databaseName === "" || databaseName == null ? undefined : databaseName;
}

export function dataCompareSourceFromTab(
  tab: TabData,
  capturedAt = Date.now(),
): DataCompareSource | null {
  if (!canCreateDataCompareSource(tab)) return null;
  const resultIndex = tab.type === "table" ? 0 : tab.activeResultIndex || 0;
  const result = tab.results![resultIndex]!;
  const primaryKeys = (tab.tableColumns || [])
    .filter((column) => column.is_primary_key)
    .map((column) => column.name)
    .filter((column) => result.columns.some((candidate) => candidate.name === column));
  return {
    id: `${tab.id}:${resultIndex}:${capturedAt}`,
    tabId: tab.id,
    label: tab.title,
    sourceKind: tab.type === "table" ? "table" : "query",
    resultIndex,
    page: tab.type === "table" ? tab.tablePage || 1 : undefined,
    connectionId: tab.connectionId,
    databaseName: tab.databaseName,
    schemaName: tab.schemaName,
    objectName: tab.tableName,
    columns: result.columns.map((column) => ({
      name: column.name,
      dataType: column.data_type,
    })),
    rows: result.rows.map((row) => row.map(cloneDataCompareValue)),
    suggestedKeyColumns: primaryKeys,
    truncated: Boolean(result.truncated),
    rowLimit: result.rowLimit,
    capturedAt,
  };
}

export function canCreateDataCompareSource(tab: TabData) {
  if (tab.type !== "query" && tab.type !== "table") return false;
  if (tab.isExecuting || hasPendingTableChanges(tab)) return false;
  const resultIndex = tab.type === "table" ? 0 : tab.activeResultIndex || 0;
  return Boolean(tab.results?.[resultIndex]?.columns.length);
}

function cloneDataCompareValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneDataCompareValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cloneDataCompareValue(item),
      ]),
    );
  }
  return value;
}

function tabMatchesDatabase(
  tab: Pick<TabData, "databaseName">,
  databaseName: string | null | undefined,
) {
  return (
    normalizedDatabaseName(tab.databaseName) ===
    normalizedDatabaseName(databaseName)
  );
}

export function querySchemaContextForTab(
  tab: Pick<
    TabData,
    "targetSchema" | "schemaName" | "tableName" | "objectType"
  >,
  currentSchema: string | null | undefined,
  driver: string = DEFAULT_DATABASE_DRIVER,
) {
  const capabilities = defaultDatabaseCapabilities(driver);
  if (
    capabilities.dataModel === "search" &&
    tab.tableName &&
    !tab.targetSchema &&
    (tab.objectType === "index" ||
      !tab.schemaName ||
      tab.schemaName === "default")
  ) {
    return tab.tableName;
  }

  return tab.targetSchema || tab.schemaName || currentSchema || undefined;
}

function mutationKeyColumns(
  columns: ColumnInfo[] | undefined,
  indexes: IndexInfo[] | undefined,
  resultColumns: ColumnDef[],
) {
  const tableColumns = columns || [];
  const resultColumnNames = new Set(resultColumns.map((column) => column.name));
  const byName = new Map(tableColumns.map((column) => [column.name, column]));
  const primaryKeyColumns = tableColumns.filter(
    (column) => column.is_primary_key && resultColumnNames.has(column.name),
  );

  if (primaryKeyColumns.length > 0) {
    return primaryKeyColumns;
  }

  const usableUniqueIndexes = (indexes || [])
    .filter((index) => index.is_unique && index.columns.length > 0)
    .map((index) => ({
      index,
      columns: index.columns
        .map((columnName) => byName.get(columnName))
        .filter((column): column is ColumnInfo => Boolean(column)),
    }))
    .filter(
      ({ index, columns }) =>
        columns.length === index.columns.length &&
        columns.every((column) => resultColumnNames.has(column.name)),
    )
    .map(({ columns }) => columns)
    .sort((left, right) => left.length - right.length);

  if (usableUniqueIndexes[0]) {
    return usableUniqueIndexes[0];
  }

  const uniqueColumns = tableColumns.filter(
    (column) =>
      !column.is_primary_key &&
      column.is_unique &&
      resultColumnNames.has(column.name),
  );

  // Column-level uniqueness is ambiguous for composite unique constraints.
  return uniqueColumns.length === 1 ? uniqueColumns : [];
}

function rowMutationKey(
  row: unknown[],
  resultColumns: ColumnDef[],
  keyColumns: ColumnInfo[],
) {
  const key: Record<string, unknown> = {};

  for (const keyColumn of keyColumns) {
    const keyIndex = resultColumns.findIndex(
      (column) => column.name === keyColumn.name,
    );
    if (keyIndex === -1) return null;

    const value = row[keyIndex];
    if (value === null || value === undefined) return null;
    key[keyColumn.name] = value;
  }

  return Object.keys(key).length === keyColumns.length ? key : null;
}

function missingMutationKeyMessage(action: "update" | "delete", table: string) {
  const operation = action === "update" ? "update rows in" : "delete rows from";
  return `Cannot ${operation} "${table}" because no primary key or usable unique index is available.`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function mutationRefreshError(
  operation: "save" | "delete",
  details?: string | null,
) {
  const completedAction =
    operation === "save" ? "Changes were saved" : "Rows were deleted";
  const detailSuffix = details ? ` Details: ${details}` : "";
  return `${completedAction}, but the table could not be refreshed. Click Refresh to load the latest data.${detailSuffix}`;
}

function mutationPreservedDraftsMessage(operation: "save" | "delete") {
  const completedAction =
    operation === "save" ? "Changes were saved" : "Rows were deleted";
  return `${completedAction}. Other unsaved table changes were preserved; submit or revert them before refreshing.`;
}

function resultsAfterSubmittedEdits(
  results: QueryResult[] | null,
  submittedEdits: Map<string, any>,
) {
  if (!results?.[0] || submittedEdits.size === 0) return results;

  const rows = results[0].rows.map((row) => [...row]);
  for (const [key, value] of submittedEdits) {
    const separatorIndex = key.indexOf(":");
    const rowIndex = Number.parseInt(key.slice(0, separatorIndex), 10);
    const columnIndex = Number.parseInt(key.slice(separatorIndex + 1), 10);
    if (
      separatorIndex === -1 ||
      Number.isNaN(rowIndex) ||
      Number.isNaN(columnIndex) ||
      rowIndex < 0 ||
      !rows[rowIndex]
    ) {
      continue;
    }
    rows[rowIndex]![columnIndex] = value;
  }

  return results.map((result, index) =>
    index === 0 ? { ...result, rows } : result,
  );
}

function pendingEditsAfterRowDeletion(
  pendingEdits: Map<string, any> | undefined,
  deletedRowIndexes: number[],
) {
  const nextEdits = new Map<string, any>();
  const deletedRows = new Set(deletedRowIndexes);

  for (const [key, value] of pendingEdits || []) {
    const separatorIndex = key.indexOf(":");
    const rowIndex = Number.parseInt(key.slice(0, separatorIndex), 10);
    const columnIndex = key.slice(separatorIndex + 1);

    if (separatorIndex === -1 || Number.isNaN(rowIndex) || rowIndex < 0) {
      nextEdits.set(key, value);
      continue;
    }
    if (deletedRows.has(rowIndex)) continue;

    const precedingDeletedRows = deletedRowIndexes.filter(
      (deletedRowIndex) => deletedRowIndex < rowIndex,
    ).length;
    nextEdits.set(`${rowIndex - precedingDeletedRows}:${columnIndex}`, value);
  }

  return nextEdits;
}

function tableDraftsAfterSuccessfulSave(
  pendingEdits: Map<string, any> | undefined,
  newRowsCount: number | undefined,
  submittedEdits: Map<string, any>,
  insertedRowIndexes: Set<number>,
) {
  const insertedOffsets = Array.from(insertedRowIndexes)
    .map((rowIndex) => -rowIndex - 1)
    .filter((offset) => offset >= 0 && offset < (newRowsCount || 0))
    .sort((left, right) => left - right);
  const insertedOffsetSet = new Set(insertedOffsets);
  const nextEdits = new Map<string, any>();

  for (const [key, value] of pendingEdits || []) {
    const separatorIndex = key.indexOf(":");
    const rowIndex = Number.parseInt(key.slice(0, separatorIndex), 10);
    const columnIndex = key.slice(separatorIndex + 1);

    if (separatorIndex === -1 || Number.isNaN(rowIndex)) {
      nextEdits.set(key, value);
      continue;
    }

    if (rowIndex >= 0) {
      if (
        submittedEdits.has(key) &&
        Object.is(submittedEdits.get(key), value)
      ) {
        continue;
      }
      nextEdits.set(key, value);
      continue;
    }

    const rowOffset = -rowIndex - 1;
    if (insertedOffsetSet.has(rowOffset)) continue;

    const precedingInsertedRows = insertedOffsets.filter(
      (insertedOffset) => insertedOffset < rowOffset,
    ).length;
    nextEdits.set(
      `${-1 - (rowOffset - precedingInsertedRows)}:${columnIndex}`,
      value,
    );
  }

  return {
    pendingEdits: nextEdits,
    newRowsCount: Math.max(0, (newRowsCount || 0) - insertedOffsets.length),
  };
}

interface TablePageLoadOptions {
  discardAction?: string;
  discardDraftsConfirmed?: boolean;
  sortOverride?: TableSort | null;
}

interface TabState {
  tabs: TabData[];
  activeTabId: string | null;
  closedTabsStack: TabData[];

  createTab: (
    type?: TabType,
    title?: string,
    initialSql?: string,
    metadata?: Partial<
      Pick<
        TabData,
        | "connectionId"
        | "databaseName"
        | "tableName"
        | "schemaName"
        | "objectType"
        | "queryLanguage"
        | "elasticsearchVariables"
        | "filters"
        | "fileProjectId"
        | "fileRootPath"
        | "fileRelativePath"
        | "fileRevision"
        | "filePreview"
        | "isDirty"
        | "agentFileDiffPreview"
        | "gitFileDiffPreview"
      >
    >,
  ) => string;
  findOrCreateTableTab: (
    connectionId: string,
    schemaName: string,
    tableName: string,
    objectType?: string | null,
    databaseName?: string,
  ) => string;
  findOrCreateObjectQueryTab: (
    connectionId: string,
    schemaName: string | null | undefined,
    objectName: string,
    objectType: string | null | undefined,
    initialSql: string,
    title?: string,
  ) => string;
  findOrCreateObjectDataTab: (
    connectionId: string,
    schemaName: string | null | undefined,
    objectName: string,
    objectType: string | null | undefined,
    previewCommand: string,
    title?: string,
  ) => string;
  createTableTab: (connectionId: string, schemaName: string) => string;
  openSchemaDiffTab: (
    plan: SchemaDiffPlan,
    source: SchemaSnapshot,
    target: SchemaSnapshot,
  ) => string;
  selectSchemaDiffChange: (tabId: string, changeId: string | null) => void;
  openSchemaDiagramTab: (snapshot: SchemaSnapshot) => string;
  selectSchemaDiagramRelation: (
    tabId: string,
    relationName: string | null,
  ) => void;
  setSchemaDiagramAreaHistory: (
    tabId: string,
    history: SchemaDiagramAreaHistory,
  ) => void;
  setSchemaDiagramNotes: (tabId: string, notes: SchemaDiagramNote[]) => void;
  selectSchemaDiagramArea: (tabId: string, areaId: string | null) => void;
  selectSchemaDiagramRelations: (tabId: string, relationNames: string[]) => void;
  openDataCompareTab: (leftTabId: string, rightTabId: string) => string | null;
  retargetTableTabs: (
    connectionId: string,
    schemaName: string,
    oldTableName: string,
    newTableName: string,
    objectType?: string | null,
    databaseName?: string,
  ) => void;
  updateTabTitle: (id: string, title: string) => void;
  openProjectFileTab: (
    projectId: string,
    relativePath: string,
    content: string,
    revision: string,
    rootPath?: string | null,
  ) => string;
  openProjectFilePreviewTab: (
    projectId: string,
    relativePath: string,
    mediaType: string,
    dataBase64: string,
    revision: string,
    size: number,
    rootPath?: string | null,
  ) => string;
  openAgentFileDiffTab: (preview: AgentFileDiffPreview) => string;
  openGitFileDiffTab: (preview: GitFileDiffPreview) => string;
  syncAgentFileDiffPreview: (preview: AgentFileDiffPreview) => void;
  dismissAgentFileDiffPreview: (turnId: string, callId: string) => void;
  markProjectFileSaved: (
    id: string,
    revision: string,
    savedContent?: string,
  ) => void;
  renameProjectFileTabs: (
    projectId: string,
    oldRelativePath: string,
    newRelativePath: string,
  ) => void;
  discardProjectFileTabs: (projectId: string, relativePath: string) => void;
  closeTab: (id: string) => void;
  forceCloseTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsToLeft: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  togglePinTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  reopenTab: () => void;
  updateTabSql: (id: string, sql: string) => void;
  setQueryLanguage: (id: string, language: QueryLanguage) => void;
  setElasticsearchVariables: (
    id: string,
    variables: Record<string, string>,
  ) => void;
  setEditorSelection: (
    id: string,
    selection: EditorSelectionState | null,
  ) => void;
  previewEditorPatch: (tabId: string, patch: EditorPatchPreview) => void;
  dismissEditorPatch: (tabId: string, patchId?: string) => void;
  applyEditorPatchPreview: (
    tabId: string,
    patchId: string,
  ) => EditorPatchApplyResult;
  setLspDiagnostics: (id: string, diagnostics: Diagnostic[]) => void;
  setActiveResultIndex: (id: string, index: number) => void;
  setQueryOutputView: (id: string, view: "results" | "plan") => void;
  closeResultAt: (id: string, index: number) => void;
  runTabQuery: (
    id: string,
    connectionId: string,
    sqlOverride?: string,
    transactionId?: string,
    sourceStartOffset?: number,
  ) => Promise<void>;
  runExplainPlan: (
    id: string,
    connectionId: string,
    sql: string,
    mode?: ExplainPlanMode,
  ) => Promise<void>;
  cancelTabQuery: (id: string) => Promise<void>;
  setGridFilter: (
    tabId: string,
    column: string,
    filter: { operator: string; value: string } | undefined,
  ) => void;
  setGridSort: (
    tabId: string,
    column: string | null,
    direction: "asc" | "desc" | null,
  ) => Promise<boolean>;
  setCellEdit: (
    tabId: string,
    rowIndex: number,
    colIndex: number,
    value: any,
  ) => void;
  setBulkCellEdit: (
    tabId: string,
    edits: Array<{ rowIndex: number; colIndex: number; value: any }>,
  ) => void;
  commitEdits: (tabId: string) => Promise<void>;
  deleteRows: (tabId: string, rowIndexes: number[]) => Promise<void>;
  cancelEdits: (tabId: string) => void;
  // Filter UI methods
  addNewRow: (tabId: string) => void;
  setFilterMode: (tabId: string, mode: "visual" | "sql") => void;
  setVisualFilters: (
    tabId: string,
    filters: Array<{
      column: string;
      operator: FilterOperator;
      value: string;
      logic?: "AND" | "OR";
    }>,
  ) => void;
  setSqlFilter: (tabId: string, sqlFilter: string) => void;
  // Column layout methods
  setColumnWidth: (tabId: string, columnId: string, width: number) => void;
  setColumnOrder: (tabId: string, columnOrder: string[]) => void;
  setColumnHidden: (tabId: string, columnId: string, hidden: boolean) => void;
  setFrozenColumnCount: (tabId: string, count: number) => void;
  restoreColumnLayout: (tabId: string, layout: PersistedGridLayout) => void;
  showAllColumns: (tabId: string) => void;
  resetColumnLayout: (tabId: string) => void;
  // Schema selection method
  setTargetSchema: (tabId: string, schema: string | null) => void;
  setTargetDatabase: (tabId: string, database: string | null) => void;
  setTableMetadata: (tabId: string, metadata: TableMetadataSnapshot) => void;
  fetchTableColumns: (tabId: string, force?: boolean) => Promise<void>;
  refreshTableTabs: (
    connectionId: string,
    schemaName: string,
    tableName: string,
    refreshMetadata?: boolean,
    databaseName?: string,
  ) => Promise<void>;
  loadTablePage: (
    tabId: string,
    page?: number,
    filterSql?: string | null,
    filters?: TableFilter[] | null,
    options?: TablePageLoadOptions,
  ) => Promise<boolean>;
}

function normalizeDiagramAreaHistory(
  history: SchemaDiagramAreaHistory | undefined,
  snapshot: SchemaSnapshot,
): SchemaDiagramAreaHistory {
  const relationNames = new Set(snapshot.relations.map((relation) => relation.name));
  const normalize = (areas: SchemaDiagramAreaHistory["present"]) =>
    areas.map((area) => ({
      ...area,
      relationNames: area.relationNames.filter((name) => relationNames.has(name)),
    }));
  return history
    ? {
        past: history.past.map(normalize),
        present: normalize(history.present),
        future: history.future.map(normalize),
      }
    : { past: [], present: [], future: [] };
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  closedTabsStack: [],

  createTab: (
    type = "query",
    title = "New Query",
    initialSql = "",
    metadata = {},
  ) => {
    const newTab: TabData = {
      id: uuidv4(),
      title,
      type,
      sql: initialSql,
      results: null,
      explainPlan: null,
      queryOutputView: "results",
      activeResultIndex: 0,
      isExecuting: false,
      error: null,
      isPinned: false,
      newRowsCount: 0,
      ...metadata,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
    return newTab.id;
  },

  findOrCreateTableTab: (
    connectionId: string,
    schemaName: string,
    tableName: string,
    objectType?: string | null,
    databaseName?: string,
  ) => {
    const { tabs } = get();
    const normalizedDatabase = normalizedDatabaseName(databaseName);

    // Find existing tab with same schema+table
    const existingTab = tabs.find(
      (tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        tab.tableName === tableName &&
        tab.schemaName === schemaName &&
        tabMatchesDatabase(tab, normalizedDatabase),
    );

    if (existingTab) {
      // Reuse existing tab
      set((state) => ({
        activeTabId: existingTab.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id && objectType
            ? { ...tab, objectType }
            : tab,
        ),
      }));
      return existingTab.id;
    }

    // Include the remote database in the title so same-named tables remain
    // distinguishable when several PostgreSQL databases are open at once.
    const title = normalizedDatabase
      ? `${tableName} · ${normalizedDatabase}`
      : tableName;

    // Create new tab if no match found
    return get().createTab("table", title, "", {
      connectionId,
      databaseName: normalizedDatabase,
      tableName,
      schemaName,
      objectType: objectType || null,
    });
  },

  findOrCreateObjectQueryTab: (
    connectionId: string,
    schemaName: string | null | undefined,
    objectName: string,
    objectType: string | null | undefined,
    initialSql: string,
    title = objectName,
  ) => {
    const normalizedSchema = schemaName || "";
    const normalizedObjectType = objectType || null;
    const existingTab = get().tabs.find(
      (tab) =>
        tab.type === "query" &&
        tab.connectionId === connectionId &&
        (tab.schemaName || "") === normalizedSchema &&
        tab.tableName === objectName,
    );

    if (existingTab) {
      set((state) => ({
        activeTabId: existingTab.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id
            ? {
                ...tab,
                title,
                sql: initialSql,
                schemaName: normalizedSchema,
                objectType: normalizedObjectType,
              }
            : tab,
        ),
      }));
      return existingTab.id;
    }

    return get().createTab("query", title, initialSql, {
      connectionId,
      schemaName: normalizedSchema,
      tableName: objectName,
      objectType: normalizedObjectType,
    });
  },

  findOrCreateObjectDataTab: (
    connectionId: string,
    schemaName: string | null | undefined,
    objectName: string,
    objectType: string | null | undefined,
    previewCommand: string,
    title = objectName,
  ) => {
    const normalizedSchema = schemaName || "";
    const normalizedObjectType = objectType || null;
    const existingTab = get().tabs.find(
      (tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        (tab.schemaName || "") === normalizedSchema &&
        tab.tableName === objectName,
    );

    if (existingTab) {
      set((state) => ({
        activeTabId: existingTab.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id
            ? {
                ...tab,
                title,
                sql: previewCommand,
                schemaName: normalizedSchema,
                objectType: normalizedObjectType,
              }
            : tab,
        ),
      }));
      return existingTab.id;
    }

    return get().createTab("table", title, previewCommand, {
      connectionId,
      schemaName: normalizedSchema,
      tableName: objectName,
      objectType: normalizedObjectType,
    });
  },

  createTableTab: (connectionId: string, schemaName: string) => {
    const newTab: TabData = {
      id: uuidv4(),
      title: "New Table",
      type: "create_table",
      sql: "",
      connectionId,
      schemaName,
      tableName: undefined,
      results: null,
      activeResultIndex: 0,
      isExecuting: false,
      error: null,
      isPinned: false,
      newRowsCount: 0,
      targetSchema: schemaName,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
    return newTab.id;
  },

  openSchemaDiffTab: (plan, source, target) => {
    const existing = get().tabs.find(
      (tab) => tab.type === "schema_diff" && tab.schemaDiffPlan?.id === plan.id,
    );
    const title = `Schema Diff · ${plan.targetSchemaName}`;
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                title,
                schemaDiffPlan: plan,
                schemaDiffSource: source,
                schemaDiffTarget: target,
                selectedSchemaChangeId: plan.changes[0]?.id || null,
              }
            : tab,
        ),
      }));
      return existing.id;
    }

    const tab: TabData = {
      id: uuidv4(),
      title,
      type: "schema_diff",
      sql: "",
      connectionId: plan.targetConnectionId,
      databaseName: plan.targetDatabaseName || undefined,
      schemaName: plan.targetSchemaName,
      results: null,
      isExecuting: false,
      error: null,
      isPinned: false,
      schemaDiffPlan: plan,
      schemaDiffSource: source,
      schemaDiffTarget: target,
      selectedSchemaChangeId: plan.changes[0]?.id || null,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  selectSchemaDiffChange: (tabId, changeId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, selectedSchemaChangeId: changeId } : tab,
      ),
    }));
  },

  openSchemaDiagramTab: (snapshot) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.type === "schema_diagram" &&
        tab.connectionId === snapshot.connectionId &&
        tab.databaseName === (snapshot.databaseName || undefined) &&
        tab.schemaName === snapshot.schemaName,
    );
    const title = `Diagram · ${snapshot.schemaName}`;
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                title,
                schemaDiagramSnapshot: snapshot,
                selectedDiagramRelationName:
                  tab.selectedDiagramRelationName &&
                  snapshot.relations.some(
                    (relation) =>
                      relation.name === tab.selectedDiagramRelationName,
                  )
                    ? tab.selectedDiagramRelationName
                    : snapshot.relations[0]?.name || null,
                schemaDiagramAreaHistory: normalizeDiagramAreaHistory(
                  tab.schemaDiagramAreaHistory,
                  snapshot,
                ),
                schemaDiagramNotes: tab.schemaDiagramNotes || [],
                selectedDiagramRelationNames: (
                  tab.selectedDiagramRelationNames || []
                ).filter((name) =>
                  snapshot.relations.some((relation) => relation.name === name),
                ),
              }
            : tab,
        ),
      }));
      return existing.id;
    }

    const tab: TabData = {
      id: uuidv4(),
      title,
      type: "schema_diagram",
      sql: "",
      connectionId: snapshot.connectionId,
      databaseName: snapshot.databaseName || undefined,
      schemaName: snapshot.schemaName,
      results: null,
      isExecuting: false,
      error: null,
      isPinned: false,
      schemaDiagramSnapshot: snapshot,
      selectedDiagramRelationName: snapshot.relations[0]?.name || null,
      schemaDiagramAreaHistory: { past: [], present: [], future: [] },
      schemaDiagramNotes: [],
      selectedDiagramAreaId: null,
      selectedDiagramRelationNames: snapshot.relations[0]?.name
        ? [snapshot.relations[0].name]
        : [],
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  selectSchemaDiagramRelation: (tabId, relationName) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, selectedDiagramRelationName: relationName }
          : tab,
      ),
    }));
  },

  setSchemaDiagramAreaHistory: (tabId, history) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, schemaDiagramAreaHistory: history } : tab,
      ),
    }));
  },

  setSchemaDiagramNotes: (tabId, notes) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, schemaDiagramNotes: notes } : tab,
      ),
    }));
  },

  selectSchemaDiagramArea: (tabId, areaId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, selectedDiagramAreaId: areaId } : tab,
      ),
    }));
  },

  selectSchemaDiagramRelations: (tabId, relationNames) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, selectedDiagramRelationNames: [...new Set(relationNames)] }
          : tab,
      ),
    }));
  },

  openDataCompareTab: (leftTabId, rightTabId) => {
    if (leftTabId === rightTabId) return null;
    const leftTab = get().tabs.find((tab) => tab.id === leftTabId);
    const rightTab = get().tabs.find((tab) => tab.id === rightTabId);
    if (!leftTab || !rightTab) return null;
    const capturedAt = Date.now();
    const left = dataCompareSourceFromTab(leftTab, capturedAt);
    const right = dataCompareSourceFromTab(rightTab, capturedAt);
    if (!left || !right) return null;

    const title = `Compare · ${left.label} ↔ ${right.label}`;
    const existing = get().tabs.find(
      (tab) =>
        tab.type === "data_compare" &&
        tab.dataCompareLeft?.tabId === leftTabId &&
        tab.dataCompareRight?.tabId === rightTabId,
    );
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? { ...tab, title, dataCompareLeft: left, dataCompareRight: right }
            : tab,
        ),
      }));
      return existing.id;
    }

    const tab: TabData = {
      id: uuidv4(),
      title,
      type: "data_compare",
      sql: "",
      results: null,
      isExecuting: false,
      error: null,
      isPinned: false,
      dataCompareLeft: left,
      dataCompareRight: right,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  retargetTableTabs: (
    connectionId: string,
    schemaName: string,
    oldTableName: string,
    newTableName: string,
    objectType?: string | null,
    databaseName?: string,
  ) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        tab.schemaName === schemaName &&
        tab.tableName === oldTableName &&
        tabMatchesDatabase(tab, databaseName)
          ? {
              ...tab,
              title: newTableName,
              tableName: newTableName,
              objectType: objectType ?? tab.objectType ?? null,
              results: null,
              activeResultIndex: 0,
              error: null,
              pendingEdits: new Map(),
              newRowsCount: 0,
              tablePage: 0,
              tableTotalRows: null,
            }
          : tab,
      ),
    }));
  },

  updateTabTitle: (id: string, title: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },

  openProjectFileTab: (
    projectId,
    relativePath,
    content,
    revision,
    rootPath,
  ) => {
    const existing = get().tabs.find(
      (tab) =>
        !tab.agentFileDiffPreview &&
        !tab.gitFileDiffPreview &&
        tab.fileProjectId === projectId &&
        tab.fileRelativePath === relativePath &&
        (!rootPath || !tab.fileRootPath || tab.fileRootPath === rootPath),
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    return get().createTab("query", fileNameFromPath(relativePath), content, {
      fileProjectId: projectId,
      fileRootPath: rootPath || undefined,
      fileRelativePath: relativePath,
      fileRevision: revision,
      isDirty: false,
    });
  },

  openProjectFilePreviewTab: (
    projectId,
    relativePath,
    mediaType,
    dataBase64,
    revision,
    size,
    rootPath,
  ) => {
    const existing = get().tabs.find(
      (tab) =>
        !tab.agentFileDiffPreview &&
        !tab.gitFileDiffPreview &&
        tab.fileProjectId === projectId &&
        tab.fileRelativePath === relativePath &&
        (!rootPath || !tab.fileRootPath || tab.fileRootPath === rootPath),
    );
    const filePreview: ProjectFileImagePreview = {
      kind: "image",
      mediaType,
      dataUrl: `data:${mediaType};base64,${dataBase64}`,
      size,
    };

    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                sql: "",
                fileRevision: revision,
                filePreview,
                isDirty: false,
                fileError: null,
              }
            : tab,
        ),
      }));
      return existing.id;
    }

    return get().createTab("query", fileNameFromPath(relativePath), "", {
      fileProjectId: projectId,
      fileRootPath: rootPath || undefined,
      fileRelativePath: relativePath,
      fileRevision: revision,
      filePreview,
      isDirty: false,
    });
  },

  openAgentFileDiffTab: (preview) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.agentFileDiffPreview?.turnId === preview.turnId &&
        tab.agentFileDiffPreview.callId === preview.callId,
    );
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                sql: preview.originalContent,
                fileRevision: preview.baseRevision || undefined,
                agentFileDiffPreview: preview,
                fileError: null,
              }
            : tab,
        ),
      }));
      return existing.id;
    }
    return get().createTab(
      "query",
      `${fileNameFromPath(preview.relativePath)} (Diff)`,
      preview.originalContent,
      {
        fileProjectId: preview.projectId,
        fileRootPath: preview.expectedRoot || undefined,
        fileRelativePath: preview.relativePath,
        fileRevision: preview.baseRevision || undefined,
        isDirty: false,
        agentFileDiffPreview: preview,
      },
    );
  },

  openGitFileDiffTab: (preview) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.gitFileDiffPreview?.projectId === preview.projectId &&
        tab.gitFileDiffPreview.relativePath === preview.relativePath &&
        tab.gitFileDiffPreview.scope === preview.scope,
    );
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                sql: preview.originalContent,
                gitFileDiffPreview: preview,
                fileError: null,
              }
            : tab,
        ),
      }));
      return existing.id;
    }
    return get().createTab(
      "query",
      `${fileNameFromPath(preview.relativePath)} (Git Diff)`,
      preview.originalContent,
      {
        fileProjectId: preview.projectId,
        fileRootPath: preview.expectedRoot || undefined,
        fileRelativePath: preview.relativePath,
        isDirty: false,
        gitFileDiffPreview: preview,
      },
    );
  },

  syncAgentFileDiffPreview: (preview) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.agentFileDiffPreview?.turnId === preview.turnId &&
        tab.agentFileDiffPreview.callId === preview.callId
          ? {
              ...tab,
              sql: preview.originalContent,
              fileRevision: preview.baseRevision || undefined,
              agentFileDiffPreview: preview,
              fileError: preview.error || null,
            }
          : tab,
      ),
    }));
  },

  dismissAgentFileDiffPreview: (turnId, callId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.agentFileDiffPreview?.turnId === turnId &&
        tab.agentFileDiffPreview.callId === callId
          ? { ...tab, agentFileDiffPreview: null }
          : tab,
      ),
    }));
  },

  markProjectFileSaved: (id, revision, savedContent) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              fileRevision: revision,
              isDirty:
                savedContent === undefined ? false : tab.sql !== savedContent,
              fileError: null,
            }
          : tab,
      ),
    }));
  },

  renameProjectFileTabs: (projectId, oldRelativePath, newRelativePath) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (
          tab.fileProjectId !== projectId ||
          !tab.fileRelativePath ||
          (tab.fileRelativePath !== oldRelativePath &&
            !tab.fileRelativePath.startsWith(`${oldRelativePath}/`))
        ) {
          return tab;
        }
        const nextPath = `${newRelativePath}${tab.fileRelativePath.slice(oldRelativePath.length)}`;
        return {
          ...tab,
          fileRelativePath: nextPath,
          title: fileNameFromPath(nextPath),
        };
      }),
    }));
  },

  discardProjectFileTabs: (projectId, relativePath) => {
    set((state) => {
      const shouldDiscard = (tab: TabData) =>
        tab.fileProjectId === projectId &&
        Boolean(tab.fileRelativePath) &&
        (!relativePath ||
          tab.fileRelativePath === relativePath ||
          tab.fileRelativePath!.startsWith(`${relativePath}/`));
      const discardedIds = new Set(
        state.tabs.filter(shouldDiscard).map((tab) => tab.id),
      );
      if (discardedIds.size === 0) return state;

      const tabs = state.tabs.filter((tab) => !discardedIds.has(tab.id));
      const activeTabId =
        state.activeTabId && discardedIds.has(state.activeTabId)
          ? tabs[tabs.length - 1]?.id || null
          : state.activeTabId;
      return {
        tabs,
        activeTabId,
        closedTabsStack: state.closedTabsStack.filter(
          (tab) => !shouldDiscard(tab),
        ),
      };
    });
  },

  closeTab: (id: string) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      // Don't close pinned tabs with regular close
      if (tab.isPinned) return state;
      if (!confirmDiscardTabChanges([tab], "close the tab")) return state;

      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1]!.id
            : null;
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveId,
        closedTabsStack: [
          tableTabAfterDiscardingDrafts(tab),
          ...state.closedTabsStack,
        ].slice(0, 20), // Keep last 20
      };
    });
  },

  forceCloseTab: (id: string) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      if (!confirmDiscardTabChanges([tab], "close the tab")) return state;

      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1]!.id
            : null;
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveId,
        closedTabsStack: [
          tableTabAfterDiscardingDrafts(tab),
          ...state.closedTabsStack,
        ].slice(0, 20),
      };
    });
  },

  closeOtherTabs: (id: string) => {
    set((state) => {
      const closing = state.tabs.filter(
        (tab) => tab.id !== id && !tab.isPinned,
      );
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;
      return {
        tabs: state.tabs.filter((tab) => tab.id === id || tab.isPinned),
        activeTabId: id,
      };
    });
  },

  closeAllTabs: () => {
    set((state) => {
      const pinnedTabs = state.tabs.filter((t) => t.isPinned);
      const closing = state.tabs.filter((tab) => !tab.isPinned);
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;
      return {
        tabs: pinnedTabs,
        activeTabId: pinnedTabs.length > 0 ? pinnedTabs[0]!.id : null,
      };
    });
  },

  closeTabsToLeft: (id: string) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;
      const closing = state.tabs.slice(0, index).filter((tab) => !tab.isPinned);
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;

      const newTabs = [
        ...state.tabs.slice(0, index).filter((t) => t.isPinned),
        ...state.tabs.slice(index),
      ];

      return { tabs: newTabs };
    });
  },

  closeTabsToRight: (id: string) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;
      const closing = state.tabs
        .slice(index + 1)
        .filter((tab) => !tab.isPinned);
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;

      const newTabs = [
        ...state.tabs.slice(0, index + 1),
        ...state.tabs.slice(index + 1).filter((t) => t.isPinned),
      ];

      return { tabs: newTabs };
    });
  },

  togglePinTab: (id: string) => {
    set((state) => {
      const tabs = state.tabs.map((t) =>
        t.id === id ? { ...t, isPinned: !t.isPinned } : t,
      );

      // Sort tabs: pinned first, then unpinned
      const pinnedTabs = tabs.filter((t) => t.isPinned);
      const unpinnedTabs = tabs.filter((t) => !t.isPinned);

      return { tabs: [...pinnedTabs, ...unpinnedTabs] };
    });
  },

  setActiveTab: (id: string) => {
    set({ activeTabId: id });
  },

  reopenTab: () => {
    const { closedTabsStack, tabs } = get();
    if (closedTabsStack.length === 0) return;

    const [tabToReopen, ...newStack] = closedTabsStack;

    // Check if tab already exists (though it shouldn't be in stack if it does)
    if (tabs.find((t) => t.id === tabToReopen!.id)) {
      set({ closedTabsStack: newStack });
      return;
    }

    set({
      tabs: [...tabs, tabToReopen!],
      activeTabId: tabToReopen!.id,
      closedTabsStack: newStack,
    });
  },

  updateTabSql: (id: string, sql: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id && !tab.filePreview
          ? {
              ...tab,
              sql,
              explainPlan: tab.sql === sql ? tab.explainPlan : null,
              queryError: tab.sql === sql ? tab.queryError : null,
              queryOutputView:
                tab.sql === sql || !tab.explainPlan
                  ? tab.queryOutputView
                  : "results",
              isDirty: tab.fileRelativePath
                ? tab.isDirty || tab.sql !== sql
                : tab.isDirty,
              fileError: tab.fileRelativePath ? null : tab.fileError,
            }
          : tab,
      ),
    }));
  },

  setQueryLanguage: (id, queryLanguage) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, queryLanguage } : tab,
      ),
    }));
  },

  setElasticsearchVariables: (id, elasticsearchVariables) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, elasticsearchVariables } : tab,
      ),
    }));
  },

  setEditorSelection: (id: string, selection: EditorSelectionState | null) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, editorSelection: selection } : t,
      ),
    }));
  },

  previewEditorPatch: (tabId, patch) => {
    set((state) => {
      const acceptsPatch = state.tabs.some(
        (tab) => tab.id === tabId && tab.type === "query" && !tab.filePreview,
      );
      if (!acceptsPatch) return {};
      return {
        activeTabId: tabId,
        tabs: state.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, editorPatchPreview: patch } : tab,
        ),
      };
    });
  },

  dismissEditorPatch: (tabId, patchId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && (!patchId || tab.editorPatchPreview?.id === patchId)
          ? { ...tab, editorPatchPreview: null }
          : tab,
      ),
    }));
  },

  applyEditorPatchPreview: (tabId, patchId) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (
      !tab ||
      !tab.editorPatchPreview ||
      tab.editorPatchPreview.id !== patchId
    ) {
      return {
        status: "notFound",
        message: "Patch preview is no longer available.",
      };
    }
    const patch = tab.editorPatchPreview;
    if (
      documentTextRevision(tab.fileRevision, tab.sql) !== patch.expectedRevision
    ) {
      return {
        status: "stale",
        message: "The editor document changed after this patch was proposed.",
      };
    }
    const result = applyEditorTextPatch(
      tab.sql,
      patch.range,
      patch.originalText,
      patch.replacement,
    );
    if (result.status !== "success") return result;
    get().updateTabSql(tabId, result.text);
    get().dismissEditorPatch(tabId, patchId);
    return result;
  },

  setLspDiagnostics: (id: string, diagnostics: Diagnostic[]) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, lspDiagnostics: diagnostics } : t,
      ),
    }));
  },

  setActiveResultIndex: (id: string, index: number) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id) return t;
        const maxIndex = Math.max(0, (t.results?.length ?? 1) - 1);
        return {
          ...t,
          activeResultIndex: Math.max(0, Math.min(index, maxIndex)),
        };
      }),
    }));
  },

  setQueryOutputView: (id, queryOutputView) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, queryOutputView } : tab,
      ),
    }));
  },

  closeResultAt: (id: string, index: number) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id || !t.results) return t;
        const nextResults = t.results.filter(
          (_, resultIndex) => resultIndex !== index,
        );
        const currentIndex = t.activeResultIndex ?? 0;
        const nextActiveIndex =
          nextResults.length === 0
            ? 0
            : index < currentIndex
              ? currentIndex - 1
              : index === currentIndex
                ? Math.min(currentIndex, nextResults.length - 1)
                : currentIndex;

        return {
          ...t,
          results: nextResults.length > 0 ? nextResults : null,
          activeResultIndex: nextActiveIndex,
        };
      }),
    }));
  },

  runTabQuery: async (
    id: string,
    connectionId: string,
    sqlOverride?: string,
    transactionId?: string,
    sourceStartOffset?: number,
  ) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;

    const editorQuery = sqlOverride || tab.sql;
    if (!editorQuery.trim()) return;
    const startedAt = Date.now();
    const { currentSchema } = useSchemaStore.getState();
    const connection = useConnectionStore
      .getState()
      .connections.find((item) => item.id === connectionId);
    const sqlToRun = queryTextForLanguage(
      editorQuery,
      connection?.driver || DEFAULT_DATABASE_DRIVER,
      tab.queryLanguage,
      tab.elasticsearchVariables,
    );
    const isNativeObjectDataLoad =
      tab.type === "table" &&
      !supportsTableWorkspace(
        defaultDatabaseCapabilities(
          connection?.driver || DEFAULT_DATABASE_DRIVER,
        ),
      );
    const schemaContext = querySchemaContextForTab(
      tab,
      currentSchema,
      connection?.driver || DEFAULT_DATABASE_DRIVER,
    );
    const historyContext = {
      projectId: connection?.projectId || "sqls",
      connectionId,
      connectionName: connection?.name || null,
      driver: connection?.driver || null,
      databaseName: tab.databaseName || connection?.database || null,
      schemaName: schemaContext || null,
      sql: sqlToRun,
      executionMode:
        sqlOverride === undefined
          ? ("console" as const)
          : ("statement" as const),
      startedAt,
    };
    const queryId = `${id}:${uuidv4()}`;
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "query",
      title: `${isNativeObjectDataLoad ? "Load" : "Run"} ${tab.title}`,
      detail: isNativeObjectDataLoad
        ? "Fetching object data"
        : connection?.driver === "elasticsearch"
          ? `Executing ${tab.queryLanguage === "elasticsearch-eql" ? "EQL" : "Query DSL"}`
          : defaultDatabaseCapabilities(
                connection?.driver || DEFAULT_DATABASE_DRIVER,
              ).supportsSqlQuery
            ? "Executing SQL"
            : "Executing query",
    });

    // Update state to executing
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              isExecuting: true,
              runningQueryId: queryId,
              error: null,
              queryError: null,
              explainPlan: null,
              queryOutputView: "results",
              activeResultIndex: t.activeResultIndex ?? 0,
            }
          : t,
      ),
    }));

    try {
      console.log(
        "TabStore: Running query with schema context:",
        schemaContext,
      );

      const readiness = await ensureConnectionReady(connectionId);
      const currentTab = get().tabs.find((candidate) => candidate.id === id);
      const tabContextIsCurrent = Boolean(
        currentTab &&
        currentTab.connectionId === tab.connectionId &&
        currentTab.databaseName === tab.databaseName,
      );
      if (!tabContextIsCurrent || readiness.status === "cancelled") {
        taskStore.cancelTask(taskId, "Workspace changed before the query began");
        set((state) => ({
          tabs: state.tabs.map((candidate) =>
            candidate.id === id && candidate.runningQueryId === queryId
              ? {
                  ...candidate,
                  isExecuting: false,
                  runningQueryId: null,
                }
              : candidate,
          ),
        }));
        return;
      }
      if (readiness.status === "error") {
        throw new Error(readiness.message);
      }

      const execute = () =>
        queryService.executeQuery(
          connectionId,
          sqlToRun,
          tab.databaseName ? undefined : schemaContext || undefined,
          transactionId,
          queryId,
          tab.databaseName,
        );

      let results: QueryResult[];
      try {
        results = await execute();
      } catch (error) {
        if (!isMissingConnectionSession(error)) throw error;
        if (transactionId) {
          throw new Error(
            "The connection session for this transaction expired. Start a new transaction before running the query again; OxideStudio will not replay transactional statements automatically.",
          );
        }

        taskStore.updateTask(taskId, {
          detail: `Restoring ${readiness.connection.name} before retrying`,
        });
        const restored = await restoreConnectionSession(connectionId);
        const latestTab = get().tabs.find((candidate) => candidate.id === id);
        const contextIsStillCurrent = Boolean(
          latestTab &&
          latestTab.runningQueryId === queryId &&
          latestTab.connectionId === tab.connectionId &&
          latestTab.databaseName === tab.databaseName,
        );
        if (!contextIsStillCurrent || restored.status === "cancelled") {
          taskStore.cancelTask(
            taskId,
            "Workspace changed while reconnecting the data source",
          );
          set((state) => ({
            tabs: state.tabs.map((candidate) =>
              candidate.id === id && candidate.runningQueryId === queryId
                ? {
                    ...candidate,
                    isExecuting: false,
                    runningQueryId: null,
                  }
                : candidate,
            ),
          }));
          return;
        }
        if (restored.status === "error") {
          throw new Error(restored.message);
        }

        try {
          results = await execute();
        } catch (retryError) {
          if (isMissingConnectionSession(retryError)) {
            throw new Error(
              `Could not reconnect to “${restored.connection.name}”: the backend session closed again immediately. Test this data source in Connection Settings, then retry the query.`,
            );
          }
          throw retryError;
        }
      }

      console.log("[TabStore] Query successfully finished", results);
      const rowCount = queryHistoryRowCount(results);
      const finishedAt = Date.now();
      useHistoryStore.getState().recordExecution({
        ...historyContext,
        status: "success",
        durationMs: finishedAt - startedAt,
        rowCount,
        errorMessage: null,
        finishedAt,
      });
      taskStore.finishTask(
        taskId,
        `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}`,
      );

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id && t.runningQueryId === queryId
            ? {
                ...t,
                isExecuting: false,
                runningQueryId: null,
                results: results || null,
                activeResultIndex: 0,
                queryError: null,
              }
            : t,
        ),
      }));

      if (!transactionId) {
        void refreshMetadataAfterQuery(
          connectionId,
          schemaContext || undefined,
          sqlToRun,
          results,
        ).catch((error) => {
          console.warn("[TabStore] Metadata refresh after query failed", error);
        });
      }
    } catch (e: unknown) {
      const queryError = extractQueryExecutionError(
        e,
        sqlToRun,
        tab.sql,
        sourceStartOffset ?? (sqlOverride === undefined ? 0 : undefined),
      );
      const message = queryError.message;
      const finishedAt = Date.now();
      useHistoryStore.getState().recordExecution({
        ...historyContext,
        status: queryHistoryStatusFromError(message),
        durationMs: finishedAt - startedAt,
        rowCount: null,
        errorMessage: message,
        finishedAt,
      });
      taskStore.failTask(taskId, message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id && t.runningQueryId === queryId
            ? {
                ...t,
                isExecuting: false,
                runningQueryId: null,
                error: message,
                queryError,
              }
            : t,
        ),
      }));
    }
  },

  runExplainPlan: async (id, connectionId, sql, mode = "estimate") => {
    const tab = get().tabs.find((candidate) => candidate.id === id);
    if (!tab || !sql.trim()) return;

    const { currentSchema } = useSchemaStore.getState();
    const connection = useConnectionStore
      .getState()
      .connections.find((item) => item.id === connectionId);
    const schemaContext = querySchemaContextForTab(
      tab,
      currentSchema,
      connection?.driver || DEFAULT_DATABASE_DRIVER,
    );
    const queryId = `${id}:plan:${uuidv4()}`;
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "query",
      title: `${mode === "analyze" ? "Analyze" : "Explain"} ${tab.title}`,
      detail:
        mode === "analyze"
          ? "Executing a read-only analyzed plan"
          : "Generating an estimated plan",
    });

    set((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              isExecuting: true,
              runningQueryId: queryId,
              error: null,
              explainPlan: null,
              queryOutputView: "plan",
            }
          : candidate,
      ),
    }));

    try {
      const plan = await queryService.explainQuery({
        connectionId,
        sql,
        schema: tab.databaseName ? undefined : schemaContext || undefined,
        database: tab.databaseName || undefined,
        queryId,
        mode,
      });
      taskStore.finishTask(
        taskId,
        `${plan.mode === "analyze" ? "Analyzed" : "Estimated"} in ${plan.generatedInMs.toFixed(1)} ms`,
      );
      set((state) => ({
        tabs: state.tabs.map((candidate) =>
          candidate.id === id && candidate.runningQueryId === queryId
            ? {
                ...candidate,
                isExecuting: false,
                runningQueryId: null,
                explainPlan: plan,
                queryOutputView: "plan",
              }
            : candidate,
        ),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      taskStore.failTask(taskId, message);
      set((state) => ({
        tabs: state.tabs.map((candidate) =>
          candidate.id === id && candidate.runningQueryId === queryId
            ? {
                ...candidate,
                isExecuting: false,
                runningQueryId: null,
                error: message,
                queryOutputView: "plan",
              }
            : candidate,
        ),
      }));
    }
  },

  cancelTabQuery: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab?.runningQueryId) return;
    const queryId = tab.runningQueryId;

    try {
      await queryService.cancelQuery(queryId);
    } catch (e: any) {
      const message = e?.message || String(e);
      console.error("Failed to cancel query:", e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id && t.runningQueryId === queryId
            ? {
                ...t,
                error: `Failed to cancel query: ${message}`,
              }
            : t,
        ),
      }));
    }
  },

  setGridFilter: (tabId, column, filter) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const gridState = t.gridState || {
          columnFilters: {},
          sortColumn: null,
          sortDirection: null,
        };
        const columnFilters = { ...gridState.columnFilters };
        if (filter) {
          columnFilters[column] = filter;
        } else {
          delete columnFilters[column];
        }
        return { ...t, gridState: { ...gridState, columnFilters } };
      }),
    }));
  },

  setGridSort: async (tabId, column, direction) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return false;

    if (tab.type === "table") {
      return get().loadTablePage(tabId, 0, undefined, undefined, {
        discardAction: "sort the table",
        sortOverride: column && direction ? { column, direction } : null,
      });
    }

    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const gridState = t.gridState || {
          columnFilters: {},
          sortColumn: null,
          sortDirection: null,
        };
        return {
          ...t,
          gridState: {
            ...gridState,
            sortColumn: column,
            sortDirection: direction,
          },
        };
      }),
    }));
    return true;
  },

  setCellEdit: (tabId, rowIndex, colIndex, value) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        if (t.isExecuting) return t;
        const pendingEdits = new Map(t.pendingEdits || new Map());
        const key = `${rowIndex}:${colIndex}`;
        pendingEdits.set(key, value);
        return { ...t, pendingEdits };
      }),
    }));
  },

  setBulkCellEdit: (tabId, edits) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        if (t.isExecuting) return t;
        const pendingEdits = new Map(t.pendingEdits || new Map());

        edits.forEach(({ rowIndex, colIndex, value }) => {
          const key = `${rowIndex}:${colIndex}`;
          pendingEdits.set(key, value);
        });

        return { ...t, pendingEdits };
      }),
    }));
  },

  commitEdits: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (
      !tab ||
      tab.isExecuting ||
      ((!tab.pendingEdits || tab.pendingEdits.size === 0) &&
        (tab.newRowsCount || 0) === 0)
    ) {
      return;
    }

    const schema = tab.schemaName;
    const table = tab.tableName;
    if (!schema || !table) return;

    // Use metadata if available, otherwise we can't save safely
    const columnsMetadata = tab.tableColumns;
    const indexesMetadata = tab.tableIndexes;
    if (!columnsMetadata || !indexesMetadata) {
      console.error("Missing table metadata for table:", table);
      // Try to fetch it?
      await state.fetchTableColumns(tabId);
      // Re-get state
      const refreshedTab = get().tabs.find((t) => t.id === tabId);
      if (!refreshedTab?.tableColumns) {
        // Still missing
        console.error("Failed to fetch metadata, cannot save.");
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  error:
                    "Cannot save edits because column metadata is unavailable.",
                }
              : t,
          ),
        }));
        // Clear edits to avoid stuck state? No, let user retry.
        return;
      }
    }

    // Check row identity columns (using refreshed state)
    const currentTab = get().tabs.find((t) => t.id === tabId);
    if (
      !currentTab ||
      currentTab.isExecuting ||
      ((!currentTab.pendingEdits || currentTab.pendingEdits.size === 0) &&
        (currentTab.newRowsCount || 0) === 0)
    ) {
      return;
    }
    const resultColumns = currentTab.results?.[0]?.columns || [];
    const keyColumns = mutationKeyColumns(
      currentTab.tableColumns,
      currentTab.tableIndexes,
      resultColumns,
    );

    const editsByRow = new Map<number, Record<number, any>>();
    for (const [key, value] of currentTab.pendingEdits || []) {
      const [rStr, cStr] = key.split(":");
      const r = parseInt(rStr!);
      const c = parseInt(cStr!);
      if (!editsByRow.has(r)) editsByRow.set(r, {});
      editsByRow.get(r)![c] = value;
    }
    for (let offset = 0; offset < (currentTab.newRowsCount || 0); offset += 1) {
      const rowIndex = -1 - offset;
      if (!editsByRow.has(rowIndex)) editsByRow.set(rowIndex, {});
    }

    const hasExistingRowEdits = Array.from(editsByRow.keys()).some(
      (rowIndex) => rowIndex >= 0,
    );
    if (hasExistingRowEdits && keyColumns.length === 0) {
      const message = missingMutationKeyMessage("update", table);
      console.warn(message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    const connId =
      tab.connectionId || useConnectionStore.getState().activeConnectionId;
    const connection = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connId);
    const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
    const metadataColumns =
      currentTab.tableColumns?.map((column) => ({
        name: column.name,
        data_type: column.data_type,
      })) || [];
    const colDefs = resultColumns.length > 0 ? resultColumns : metadataColumns;
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{
      key: Record<string, unknown>;
      values: Record<string, unknown>;
    }> = [];
    const submittedEdits = new Map<string, any>();
    const insertedRowIndexes = new Set<number>();

    for (const [rowIndex, rowEdits] of editsByRow.entries()) {
      if (rowIndex < 0) {
        const values: Record<string, unknown> = {};
        const saveableEdits: Array<[string, any]> = [];

        for (const [cIdx, val] of Object.entries(rowEdits)) {
          const colName = colDefs[parseInt(cIdx)]?.name;
          if (colName) {
            values[colName] = val;
            saveableEdits.push([`${rowIndex}:${cIdx}`, val]);
          }
        }

        inserts.push(values);
        insertedRowIndexes.add(rowIndex);
        saveableEdits.forEach(([key, value]) => submittedEdits.set(key, value));
      } else {
        if (colDefs.length === 0) continue;
        if (keyColumns.length === 0) {
          console.warn("No row mutation key found for table:", table);
          continue;
        }

        const originalRow = currentTab.results?.[0]?.rows[rowIndex];
        if (!originalRow || resultColumns.length === 0) continue;

        const values: Record<string, unknown> = {};
        const saveableEdits: Array<[string, any]> = [];
        for (const [cIdx, val] of Object.entries(rowEdits)) {
          const colName = colDefs[parseInt(cIdx)]?.name;
          if (colName) {
            values[colName] = val;
            saveableEdits.push([`${rowIndex}:${cIdx}`, val]);
          }
        }

        const key = rowMutationKey(originalRow, resultColumns, keyColumns);

        if (Object.keys(values).length > 0 && key) {
          updates.push({ key, values });
          saveableEdits.forEach(([editKey, value]) =>
            submittedEdits.set(editKey, value),
          );
        }
      }
    }

    if (inserts.length === 0 && updates.length === 0) {
      // Nothing to do or failed to generate
      const message = "No saveable table mutations were generated.";
      console.log(message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    if (!connId) {
      const message = "No connection ID found for table mutation.";
      console.error(message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId ? { ...item, isExecuting: true, error: null } : item,
      ),
    }));

    try {
      await tableService.mutateTableRows(
        connId,
        driver,
        schema,
        table,
        inserts,
        updates,
        [],
        ...(currentTab.databaseName ? [currentTab.databaseName] : []),
      );
    } catch (e) {
      console.error("Save failed:", e);
      const message = errorMessage(e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, isExecuting: false, error: `Save failed: ${message}` }
            : t,
        ),
      }));
      return;
    }

    // The mutation is durable at this point. Consume its drafts before the
    // independent, best-effort refresh so retrying cannot submit them again.
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const remainingDrafts = tableDraftsAfterSuccessfulSave(
          t.pendingEdits,
          t.newRowsCount,
          submittedEdits,
          insertedRowIndexes,
        );
        return {
          ...t,
          ...remainingDrafts,
          results: resultsAfterSubmittedEdits(t.results, submittedEdits),
          tableTotalRows:
            typeof t.tableTotalRows === "number"
              ? t.tableTotalRows + insertedRowIndexes.size
              : t.tableTotalRows,
          isExecuting: false,
          error: null,
        };
      }),
    }));

    const tabAfterSave = get().tabs.find((item) => item.id === tabId);
    if (tabAfterSave && hasPendingTableChanges(tabAfterSave)) {
      const message = mutationPreservedDraftsMessage("save");
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId ? { ...item, error: message } : item,
        ),
      }));
      return;
    }

    let refreshSucceeded = false;
    let refreshFailure: string | null = null;
    try {
      if (tab.type === "table") {
        refreshSucceeded = await state.loadTablePage(
          tabId,
          tab.tablePage ?? 0,
          tab.tableFilterSql ?? null,
          tab.tableFilters ?? null,
          { discardDraftsConfirmed: true },
        );
      } else {
        await state.runTabQuery(tabId, connId);
        const refreshedTab = get().tabs.find((item) => item.id === tabId);
        refreshSucceeded = !refreshedTab?.error;
      }
    } catch (e) {
      refreshFailure = errorMessage(e);
    }

    if (!refreshSucceeded) {
      const refreshedTab = get().tabs.find((item) => item.id === tabId);
      const message = mutationRefreshError(
        "save",
        refreshFailure || refreshedTab?.error,
      );
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
    }
  },

  deleteRows: async (tabId, rowIndexes) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (
      !tab ||
      tab.type !== "table" ||
      tab.isExecuting ||
      rowIndexes.length === 0
    ) {
      return;
    }

    const schema = tab.schemaName;
    const table = tab.tableName;
    const result = tab.results?.[0];
    if (!schema || !table || !result || result.columns.length === 0) return;

    if (!tab.tableColumns || !tab.tableIndexes) {
      await state.fetchTableColumns(tabId);
    }

    const currentTab = get().tabs.find((t) => t.id === tabId);
    if (!currentTab || currentTab.isExecuting) return;

    const keyColumns = mutationKeyColumns(
      currentTab.tableColumns,
      currentTab.tableIndexes,
      result.columns,
    );
    if (keyColumns.length === 0) {
      const message = missingMutationKeyMessage("delete", table);
      console.warn(message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    const connId =
      currentTab.connectionId ||
      useConnectionStore.getState().activeConnectionId;
    if (!connId) {
      console.error("No connection ID found");
      return;
    }

    const connection = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connId);
    const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
    const uniqueRowIndexes = Array.from(new Set(rowIndexes)).sort(
      (a, b) => a - b,
    );
    const deletes: Array<{ key: Record<string, unknown> }> = [];
    const deletedRowIndexes: number[] = [];

    for (const rowIndex of uniqueRowIndexes) {
      const row = result.rows[rowIndex];
      if (!row) continue;

      const key = rowMutationKey(row, result.columns, keyColumns);

      if (key) {
        deletes.push({ key });
        deletedRowIndexes.push(rowIndex);
      }
    }

    if (deletes.length === 0) {
      const message = "No deleteable rows were generated from the selection.";
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId ? { ...item, isExecuting: true, error: null } : item,
      ),
    }));

    try {
      await tableService.mutateTableRows(
        connId,
        driver,
        schema,
        table,
        [],
        [],
        deletes,
        ...(currentTab.databaseName ? [currentTab.databaseName] : []),
      );
    } catch (e) {
      console.error("Delete rows failed:", e);
      const message = errorMessage(e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isExecuting: false,
                error: `Delete rows failed: ${message}`,
              }
            : t,
        ),
      }));
      return;
    }

    // Remove the successfully deleted rows immediately. If refreshing fails,
    // the same row identities are no longer available for a duplicate delete.
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;

        const nextResults = t.results?.map((queryResult, resultIndex) =>
          resultIndex === 0
            ? {
                ...queryResult,
                rows: queryResult.rows.filter(
                  (_row, rowIndex) => !deletedRowIndexes.includes(rowIndex),
                ),
              }
            : queryResult,
        );
        return {
          ...t,
          results: nextResults ?? t.results,
          pendingEdits: pendingEditsAfterRowDeletion(
            t.pendingEdits,
            deletedRowIndexes,
          ),
          tableTotalRows:
            typeof t.tableTotalRows === "number"
              ? Math.max(0, t.tableTotalRows - deletes.length)
              : t.tableTotalRows,
          isExecuting: false,
          error: null,
        };
      }),
    }));

    const tabAfterDelete = get().tabs.find((item) => item.id === tabId);
    if (tabAfterDelete && hasPendingTableChanges(tabAfterDelete)) {
      const message = mutationPreservedDraftsMessage("delete");
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId ? { ...item, error: message } : item,
        ),
      }));
      return;
    }

    let refreshSucceeded = false;
    let refreshFailure: string | null = null;
    try {
      refreshSucceeded = await state.loadTablePage(
        tabId,
        currentTab.tablePage ?? 0,
        currentTab.tableFilterSql ?? null,
        currentTab.tableFilters ?? null,
        { discardDraftsConfirmed: true },
      );
    } catch (e) {
      refreshFailure = errorMessage(e);
    }

    if (!refreshSucceeded) {
      const refreshedTab = get().tabs.find((item) => item.id === tabId);
      const message = mutationRefreshError(
        "delete",
        refreshFailure || refreshedTab?.error,
      );
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
    }
  },

  setTableMetadata: (tabId, metadata) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              tableColumns: metadata.columns,
              tableIndexes: metadata.indexes,
              tableConstraints: metadata.constraints,
              tableMetadataSource: metadata.source,
              tableMetadataUpdatedAt: metadata.updatedAt,
              isFetchingColumns: false,
            }
          : tab,
      ),
    }));
  },

  fetchTableColumns: async (tabId, force = false) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    console.log("[fetchTableColumns]", {
      tabId,
      table: tab?.tableName,
      schema: tab?.schemaName,
      isFetching: tab?.isFetchingColumns,
    });

    if (!tab || !tab.tableName || !tab.schemaName) return;
    if (tab.isFetchingColumns) return;

    const connId =
      tab.connectionId || useConnectionStore.getState().activeConnectionId;

    if (!connId) {
      console.warn("[fetchTableColumns] No connection ID found.");
      return;
    }

    // Set fetching flag immediately
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isFetchingColumns: true } : t,
      ),
    }));

    try {
      const connection = useConnectionStore
        .getState()
        .connections.find((item) => item.id === connId);
      const metadata = await loadTableMetadata({
        connectionId: connId,
        driver: connection?.driver || DEFAULT_DATABASE_DRIVER,
        databaseName: tab.databaseName,
        schema: tab.schemaName,
        table: tab.tableName,
        includeIndexes: true,
        includeConstraints: false,
        force,
      });
      console.log(
        `[fetchTableColumns] Loaded metadata from ${metadata.source}:`,
        metadata.columns,
        metadata.indexes,
      );

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                tableColumns: metadata.columns,
                tableIndexes: metadata.indexes,
                tableConstraints: metadata.constraints,
                tableMetadataSource: metadata.source,
                tableMetadataUpdatedAt: metadata.updatedAt,
                isFetchingColumns: false,
              }
            : t,
        ),
      }));
    } catch (e) {
      console.error("Failed to fetch columns:", e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, isFetchingColumns: false } : t,
        ),
      }));
    }
  },

  refreshTableTabs: async (
    connectionId,
    schemaName,
    tableName,
    refreshMetadata = true,
    databaseName,
  ) => {
    const matchingTableTabs = get().tabs.filter(
      (tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        tab.schemaName === schemaName &&
        tab.tableName === tableName &&
        tabMatchesDatabase(tab, databaseName),
    );
    const matchingTabs = matchingTableTabs.map((tab) => ({
      id: tab.id,
      page: tab.tablePage ?? 0,
      filterSql: tab.tableFilterSql ?? null,
      filters: tab.tableFilters ?? null,
    }));

    if (matchingTabs.length === 0) return;
    if (
      !confirmDiscardTabChanges(
        matchingTableTabs,
        `refresh ${schemaName}.${tableName}`,
      )
    ) {
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((tab) =>
        matchingTabs.some((match) => match.id === tab.id)
          ? {
              ...tab,
              ...(refreshMetadata
                ? {
                    tableColumns: undefined,
                    tableIndexes: undefined,
                    tableConstraints: undefined,
                    tableMetadataSource: undefined,
                    tableMetadataUpdatedAt: undefined,
                  }
                : {}),
              isFetchingColumns: false,
              isExecuting: true,
              error: null,
            }
          : tab,
      ),
    }));

    await Promise.all(
      matchingTabs.map(async (tab) => {
        if (refreshMetadata) {
          await get().fetchTableColumns(tab.id, true);
        }
        await get().loadTablePage(
          tab.id,
          tab.page,
          tab.filterSql,
          tab.filters,
          {
            discardDraftsConfirmed: true,
          },
        );
      }),
    );
  },

  loadTablePage: async (tabId, page, filterSql, filters, options) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (
      !tab ||
      tab.type !== "table" ||
      !tab.connectionId ||
      !tab.schemaName ||
      !tab.tableName
    ) {
      return false;
    }

    if (
      !options?.discardDraftsConfirmed &&
      !confirmDiscardTabChanges(
        [tab],
        options?.discardAction || "reload the table data",
      )
    ) {
      return false;
    }

    const nextPage = Math.max(0, page ?? tab.tablePage ?? 0);
    const pageSize = tab.tablePageSize || 500;
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "table",
      title: `Load ${tab.tableName}`,
      detail: `Page ${nextPage + 1}`,
    });
    const nextFilterSql =
      filterSql === undefined ? tab.tableFilterSql : filterSql;
    const nextFilters = filters === undefined ? tab.tableFilters : filters;
    const hasSortOverride = options?.sortOverride !== undefined;
    const requestedTableSort: TableSort | undefined = hasSortOverride
      ? options.sortOverride || undefined
      : tab.gridState?.sortColumn && tab.gridState?.sortDirection
        ? {
            column: tab.gridState.sortColumn,
            direction: tab.gridState.sortDirection,
          }
        : undefined;
    const primaryKeySort = tab.tableColumns?.find(
      (column) => column.is_primary_key,
    );
    const tableSort: TableSort | undefined =
      requestedTableSort ||
      (primaryKeySort
        ? { column: primaryKeySort.name, direction: "asc" }
        : undefined);

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isExecuting: true, error: null } : t,
      ),
    }));

    try {
      const readiness = await ensureConnectionReady(tab.connectionId);
      const currentTab = get().tabs.find((candidate) => candidate.id === tabId);
      const tabContextIsCurrent = Boolean(
        currentTab?.type === "table" &&
        currentTab.connectionId === tab.connectionId &&
        currentTab.databaseName === tab.databaseName &&
        currentTab.schemaName === tab.schemaName &&
        currentTab.tableName === tab.tableName,
      );

      if (!tabContextIsCurrent || readiness.status === "cancelled") {
        taskStore.cancelTask(taskId, "Workspace changed before loading began");
        set((state) => ({
          tabs: state.tabs.map((candidate) =>
            candidate.id === tabId
              ? { ...candidate, isExecuting: false }
              : candidate,
          ),
        }));
        return false;
      }

      if (readiness.status === "error") {
        throw new Error(readiness.message);
      }

      const driver = readiness.connection.driver || DEFAULT_DATABASE_DRIVER;
      const pageResult = tab.databaseName
        ? await tableService.previewTablePage(
            tab.connectionId,
            driver,
            tab.schemaName,
            tab.tableName,
            nextPage,
            pageSize,
            nextFilterSql || undefined,
            nextFilters || undefined,
            tableSort,
            tab.databaseName,
          )
        : await tableService.previewTablePage(
            tab.connectionId,
            driver,
            tab.schemaName,
            tab.tableName,
            nextPage,
            pageSize,
            nextFilterSql || undefined,
            nextFilters || undefined,
            tableSort,
          );

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isExecuting: false,
                results: [pageResult.result],
                tablePage: pageResult.page,
                tablePageSize: pageResult.pageSize,
                tableTotalRows: pageResult.totalRows ?? null,
                tableFilterSql: nextFilterSql || null,
                tableFilters: nextFilters || null,
                pendingEdits: new Map(),
                newRowsCount: 0,
                ...(hasSortOverride
                  ? {
                      gridState: {
                        ...(t.gridState || {
                          columnFilters: {},
                          sortColumn: null,
                          sortDirection: null,
                        }),
                        sortColumn: options?.sortOverride?.column || null,
                        sortDirection: options?.sortOverride?.direction || null,
                      },
                    }
                  : {}),
              }
            : t,
        ),
      }));
      taskStore.finishTask(
        taskId,
        `${pageResult.result.rows.length.toLocaleString()} row${
          pageResult.result.rows.length === 1 ? "" : "s"
        }`,
      );
      return true;
    } catch (e: any) {
      taskStore.failTask(taskId, e.message || String(e));
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, isExecuting: false, error: e.message || String(e) }
            : t,
        ),
      }));
      return false;
    }
  },

  cancelEdits: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, pendingEdits: new Map(), newRowsCount: 0 } : t,
      ),
    }));
  },

  addNewRow: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && !t.isExecuting
          ? { ...t, newRowsCount: (t.newRowsCount || 0) + 1 }
          : t,
      ),
    }));
  },

  setFilterMode: (tabId, mode) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, filterMode: mode } : t,
      ),
    }));
  },

  setVisualFilters: (tabId, filters) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, visualFilters: filters } : t,
      ),
    }));
  },

  setSqlFilter: (tabId, sqlFilter) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, sqlFilter } : t)),
    }));
  },

  setColumnWidth: (tabId, columnId, width) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTab = {
      ...tab,
      columnWidths: { ...(tab.columnWidths || {}), [columnId]: width },
    };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return nextTab;
      }),
    }));
  },

  setColumnOrder: (tabId, columnOrder) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTab = { ...tab, columnOrder };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? nextTab : t)),
    }));
  },

  setColumnHidden: (tabId, columnId, hidden) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const hiddenColumns = new Set(tab.hiddenColumns || []);
    if (hidden) hiddenColumns.add(columnId);
    else hiddenColumns.delete(columnId);
    const nextTab = { ...tab, hiddenColumns: [...hiddenColumns] };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return nextTab;
      }),
    }));
  },

  setFrozenColumnCount: (tabId, count) => {
    const frozenColumnCount = Math.max(0, Math.floor(count));
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTab = { ...tab, frozenColumnCount };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? nextTab : tab,
      ),
    }));
  },

  restoreColumnLayout: (tabId, layout) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              columnWidths: layout.columnWidths,
              columnOrder: layout.columnOrder,
              hiddenColumns: layout.hiddenColumns,
              frozenColumnCount: layout.frozenColumnCount,
            }
          : tab,
      ),
    }));
  },

  showAllColumns: (tabId) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTab = { ...tab, hiddenColumns: [] };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? nextTab : tab,
      ),
    }));
  },

  resetColumnLayout: (tabId) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    removeGridLayout(gridLayoutScopeForTab(tab));
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              columnWidths: {},
              columnOrder: [],
              hiddenColumns: [],
              frozenColumnCount: 0,
            }
          : tab,
      ),
    }));
  },

  setTargetSchema: (tabId, schema) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, targetSchema: schema } : t,
      ),
    }));
  },

  setTargetDatabase: (tabId, database) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, databaseName: normalizedDatabaseName(database) }
          : tab,
      ),
    }));
  },
}));

export function confirmDiscardAllTabChanges(action: string) {
  return confirmDiscardTabChanges(useTabStore.getState().tabs, action);
}

export function confirmDiscardProjectFileChanges(
  projectId: string,
  action: string,
) {
  return confirmDiscardTabChanges(
    useTabStore
      .getState()
      .tabs.filter((tab) => tab.fileProjectId === projectId),
    action,
  );
}
