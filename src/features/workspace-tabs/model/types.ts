import type { FilterOperator } from "@/components/workspace/GridFilterRow";
import {
  type DataGridNewRowPasteCell,
  type PersistedGridLayout,
} from "@/features/data-grid";
import type { AgentFileDiffPreview } from "@/lib/agentFileReview";
import type { TableTabReuseMode } from "@/lib/appSettings";
import type { DataCompareSource } from "@/lib/dataCompare";
import type { NewGridRowPlacement } from "@/lib/dataGridRows";
import {
  type EditorPatchApplyResult,
  type EditorPatchPreview,
} from "@/lib/editorPatch";
import type { GitFileDiffPreview } from "@/lib/projectGitDiff";
import { type QueryExecutionErrorDetail } from "@/lib/queryErrorPresentation";
import type { SchemaDiagramAreaHistory } from "@/lib/schemaDiagramAreas";
import { type SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import type { Diagnostic } from "@/services/lsp/types";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import { type TableMetadataSnapshot } from "@/services/tableMetadataCache";
import { QueryResult } from "@/services/tauri";
import type {
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

export type TabType =
  | "query"
  | "table"
  | "create_table"
  | "schema_diff"
  | "schema_diagram"
  | "data_compare"
  | "database_browser"
  | "object_browser"
  | "rocketmq_workspace";

export type QueryLanguage = "elasticsearch-dsl" | "elasticsearch-eql";

export interface EditorSelectionState {
  text: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface EditorViewportState {
  scrollTop: number;
  scrollLeft: number;
}

export interface EditorViewSelectionState {
  anchor: number;
  head: number;
}

export interface ProjectFileImagePreview {
  kind: "image";
  mediaType: string;
  dataUrl: string;
  size: number;
}

/**
 * Presentation-only state for one query result set.  Query tabs may hold the
 * results of several statements, so this must not be shared implicitly by
 * every result in the tab.
 */
export interface QueryResultGridState {
  columnFilters: Record<string, { operator: string; value: string }>;
  sortColumn: string | null;
  sortDirection: "asc" | "desc" | null;
}

/**
 * A bounded, in-memory snapshot of one completed query execution. Result rows
 * are shared with the projected tab surface; switching runs never clones grid
 * payloads. Runs intentionally do not survive a closed tab or app restart.
 */
export interface QueryResultRun {
  id: string;
  completedAt: number;
  sql?: string;
  results: QueryResult[];
  activeResultIndex: number;
  gridState?: QueryResultGridState;
  resultGridStates?: Record<number, QueryResultGridState>;
  pinned?: boolean;
}

export interface TabData {
  /** Ephemeral file snapshot; never an editable project document/connection. */
  fileQuery?: import("@/features/file-query/model").FileQueryDocument;
  id: string;
  title: string;
  type: TabType;
  /** Stable session creation time used only for deterministic tab ordering. */
  createdAt?: number;
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
  /** SQL revision that produced the currently displayed query results. */
  resultSql?: string;
  /** Opaque continuation owned by the native IoTDB sidecar; never persisted. */
  nativeQueryCursor?: string | null;
  nativeQueryHasMore?: boolean;
  nativeQueryPageSize?: number;
  explainPlan?: ExplainPlan | null;
  queryOutputView?: "results" | "plan";
  isExecuting: boolean;
  runningQueryId?: string | null;
  error: string | null;
  queryError?: QueryExecutionErrorDetail | null;
  activeResultIndex?: number;
  /** Result selected when the current query execution began. */
  executingResultIndex?: number;
  /** Completed result run displayed when the current execution began. */
  executingResultRunId?: string;
  isPinned: boolean;
  /** State for the active result set, retained for table tabs and legacy tabs. */
  gridState?: QueryResultGridState;
  /** Query-local grid state keyed by result index; never contains row data. */
  resultGridStates?: Record<number, QueryResultGridState>;
  /** Recent completed query executions, bounded by MAX_QUERY_RESULT_RUNS. */
  resultRuns?: QueryResultRun[];
  activeResultRunId?: string;
  pendingEdits?: Map<string, any>; // key: "rowIndex:colIndex" or "new-N:colIndex", value: new value
  newRowsCount?: number;
  /** Parallel to pending new-row offsets; cloned rows carry a stable display anchor. */
  newRowPlacements?: Array<NewGridRowPlacement | null>;
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
  /** Opaque native document/search continuations indexed by destination page. */
  documentPageCursors?: Array<string | null>;
  documentHasNextCursor?: boolean;
  documentFilter?: string | null;
  documentSort?: string | null;
  editorSelection?: EditorSelectionState | null;
  editorViewport?: EditorViewportState;
  editorViewSelection?: EditorViewSelectionState;
  editorPatchPreview?: EditorPatchPreview | null;
  agentFileDiffPreview?: AgentFileDiffPreview | null;
  gitFileDiffPreview?: GitFileDiffPreview | null;
  lspDiagnostics?: Diagnostic[];
  fileProjectId?: string;
  savedSqlProjectId?: string;
  savedSqlFileId?: string;
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
  schemaDiagramCanvasHistory?: SchemaDiagramCanvasHistory;
  /** Legacy session fields retained while persisted tabs migrate to canvas history. */
  schemaDiagramAreaHistory?: SchemaDiagramAreaHistory;
  schemaDiagramNotes?: SchemaDiagramNote[];
  selectedDiagramAreaId?: string | null;
  selectedDiagramRelationNames?: string[];
  dataCompareLeft?: DataCompareSource;
  dataCompareRight?: DataCompareSource;
}

export interface TablePageLoadOptions {
  discardAction?: string;
  discardDraftsConfirmed?: boolean;
  sortOverride?: TableSort | null;
  /** Exact totals are opt-in: pagination must not run an expensive COUNT(*) by default. */
  includeTotal?: boolean;
}

export interface TabState {
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
        | "fileQuery"
        | "connectionId"
        | "databaseName"
        | "tableName"
        | "schemaName"
        | "objectType"
        | "queryLanguage"
        | "elasticsearchVariables"
        | "filters"
        | "fileProjectId"
        | "savedSqlProjectId"
        | "savedSqlFileId"
        | "fileRootPath"
        | "fileRelativePath"
        | "fileRevision"
        | "filePreview"
        | "isDirty"
        | "targetSchema"
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
    options?: { reuseMode?: TableTabReuseMode },
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
  openDatabaseBrowser: (connectionId: string, connectionName: string) => string;
  openObjectBrowser: (
    connectionId: string,
    connectionName: string,
    databaseName?: string,
    schemaName?: string,
  ) => string;
  openRocketMqWorkspace: (
    connectionId: string,
    connectionName: string,
  ) => string;
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
  setSchemaDiagramCanvasHistory: (
    tabId: string,
    history: SchemaDiagramCanvasHistory,
  ) => void;
  selectSchemaDiagramArea: (tabId: string, areaId: string | null) => void;
  selectSchemaDiagramRelations: (
    tabId: string,
    relationNames: string[],
  ) => void;
  openDataCompareTab: (leftTabId: string, rightTabId: string) => string | null;
  openDataCompareSourcesTab: (
    left: DataCompareSource,
    right: DataCompareSource,
  ) => string | null;
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
  discardProjectFileTabs: (
    projectId: string,
    relativePath: string,
    forgetTargets?: boolean,
  ) => void;
  closeTab: (id: string) => Promise<void>;
  forceCloseTab: (id: string) => Promise<void>;
  closeOtherTabs: (id: string) => Promise<void>;
  closeAllTabs: () => Promise<void>;
  closeTabsToLeft: (id: string) => Promise<void>;
  closeTabsToRight: (id: string) => Promise<void>;
  closeTabsByIds: (
    ids: readonly string[],
    fallbackTabId?: string | null,
  ) => Promise<void>;
  togglePinTab: (id: string) => void;
  reorderTab: (
    draggedId: string,
    targetId: string,
    position: "before" | "after",
  ) => boolean;
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
    viewSelection?: EditorViewSelectionState,
  ) => void;
  setEditorViewport: (id: string, viewport: EditorViewportState) => void;
  previewEditorPatch: (tabId: string, patch: EditorPatchPreview) => void;
  dismissEditorPatch: (tabId: string, patchId?: string) => void;
  applyEditorPatchPreview: (
    tabId: string,
    patchId: string,
  ) => EditorPatchApplyResult;
  setLspDiagnostics: (id: string, diagnostics: Diagnostic[]) => void;
  setActiveResultIndex: (id: string, index: number) => void;
  setActiveResultRun: (id: string, runId: string) => void;
  toggleResultRunPin: (id: string, runId: string) => void;
  closeResultRun: (id: string, runId: string) => void;
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
  applyNewRowPaste: (
    tabId: string,
    targetRowKey: number,
    reusableRowKeys: readonly number[],
    rows: readonly (readonly DataGridNewRowPasteCell[])[],
  ) => boolean;
  commitEdits: (tabId: string) => Promise<void>;
  deleteRows: (tabId: string, rowIndexes: number[]) => Promise<void>;
  cancelEdits: (tabId: string) => void;
  // Filter UI methods
  addNewRow: (tabId: string) => void;
  cloneRows: (tabId: string, rowIndexes: number[]) => void;
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
  loadDocumentPage: (
    tabId: string,
    page?: number,
    options?: {
      filter?: string | null;
      sort?: string | null;
      discardAction?: string;
      discardDraftsConfirmed?: boolean;
    },
  ) => Promise<boolean>;
  /** Appends one bounded page from a live native query cursor. */
  loadMoreNativeQueryPage: (tabId: string) => Promise<boolean>;
}
