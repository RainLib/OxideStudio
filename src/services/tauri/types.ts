/**
 * Tauri API 类型定义
 * 所有与 Rust 后端交互的类型定义
 */

/**
 * 通用响应类型
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorPayload;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  retryable?: boolean;
  category?: string;
  context?: Record<string, unknown>;
}

/**
 * 数据库驱动类型
 */
export type KnownDatabaseDriver =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "redis"
  | "elasticsearch"
  | "mongodb";
export type DatabaseDriver = KnownDatabaseDriver | (string & {});
export type DatabaseDataModel =
  | "relational"
  | "document"
  | "keyValue"
  | "search"
  | "graph"
  | "wideColumn"
  | "timeSeries"
  | "coordination"
  | "queue";
export type DatabaseConnectionMode = "network" | "file";

export interface DatabaseCapabilities {
  driver: DatabaseDriver;
  displayName: string;
  dataModel: DatabaseDataModel;
  connectionMode?: DatabaseConnectionMode;
  lspLanguageId: string;
  /**
   * Optional concrete parser baseline for a generic `sql` editor document.
   * This is supplied only by a signed driver capability contract.
   */
  lspServerDialect?: string | null;
  namespaceLabel: string;
  identifierQuote: string;
  defaultPort: number;
  supportsSqlQuery: boolean;
  supportsTableBrowsing: boolean;
  supportsTableRowMutation: boolean;
  /** Cross-connection table transfer is separately verified from Grid editing. */
  supportsTableDataTransfer?: boolean;
  supportsTableDdl: boolean;
  /** The bounded Table Editor implements ALTER COLUMN for this driver. */
  supportsColumnAlteration?: boolean;
  /** The bounded Table Editor can rename an existing index for this driver. */
  supportsIndexRename?: boolean;
  /** The bounded Table Editor can alter existing constraints for this driver. */
  supportsConstraintAlteration?: boolean;
  supportsCollectionBrowsing: boolean;
  supportsKeyValueBrowsing: boolean;
  supportsSchemas: boolean;
  /** The connection can expose more than one database/catalog in Explorer. */
  supportsDatabaseCatalogs?: boolean;
  /** Whether this connection's URL and form accept a database/catalog segment. */
  supportsConnectionDatabase?: boolean;
  supportsCreateDatabase: boolean;
  /** Creation can optionally set an owner / authorization principal. */
  supportsCreateDatabaseOwner?: boolean;
  supportsCreateDatabaseCharset: boolean;
  /** Creation can optionally set an explicit collation. */
  supportsCreateDatabaseCollation?: boolean;
  supportsColumnComments: boolean;
  supportsInlineColumnComments: boolean;
  supportsRenameDatabase: boolean;
  supportsViews: boolean;
  supportsReplaceView: boolean;
  supportsMaterializedViews: boolean;
  supportsTableIndexes: boolean;
  supportsTableConstraints: boolean;
  supportsForeignKeys: boolean;
  supportsCheckConstraints: boolean;
  supportsFunctions: boolean;
  supportsTransactions: boolean;
  supportsQueryCancellation: boolean;
  supportsExplainPlan: boolean;
  autoIncrementKeyword?: string | null;
  defaultPrimaryKeyType: string;
  commonDataTypes: string[];
}

export type SchemaMigrationCapabilityMode =
  | "transactional"
  | "nonTransactional"
  | "reviewOnly";

/**
 * Exact capability snapshot for one connected driver instance. This keeps the
 * package contract and negotiated server version together so editor and
 * migration consumers do not combine values from different reconnects.
 */
export interface ConnectionDatabaseCapabilityContext {
  connectionId: string;
  driver: DatabaseDriver;
  distribution: "bundled" | "external";
  packageVersion?: string | null;
  serverVersion?: string | null;
  schemaMigrationMode: SchemaMigrationCapabilityMode;
  capabilities: DatabaseCapabilities;
}

export interface DatabaseDriverInstallation {
  driver: string;
  displayName: string;
  clientLibrary: string;
  clientVersion: string;
  distribution: "bundled" | "external";
  updatePolicy: "application-update" | "independent";
  independentlyUpdatable: boolean;
  serverVersionPolicy: "detected-at-connection" | string;
  implementation: string;
  /** Package runtime shown by Driver Manager, for example Native or managed Java 21. */
  runtime?: string;
  /** JDBC packages are launchable only when their managed Java runtime is active and verified. */
  runtimeReady?: boolean | null;
  packageVersion?: string | null;
  protocolVersion?: string | null;
  active?: boolean;
  canRollback?: boolean;
  status?: "ready" | "incompatible" | "untrusted" | "invalid";
  statusMessage?: string | null;
  /** Signed package template for JDBC/vendor-specific connection URLs. */
  connectionUrlTemplate?: string | null;
  capabilities?: DatabaseCapabilities | null;
}

export interface DatabaseDriverActivationState {
  current: string;
  previous?: string | null;
}

export interface DatabaseDriverStoreInfo {
  activePath: string;
  /** True after a migration: the copied store becomes active on restart. */
  restartRequired: boolean;
}

/**
 * Aggregated, connection-owned external driver processes. Intentionally does
 * not include connection names, URLs, credentials, query text, or stderr.
 */
export interface DatabaseDriverRuntimeSummary {
  driver: string;
  packageVersion: string;
  connectionCount: number;
  processIds: number[];
  /** Connected entries whose sidecar PID is no longer observable. */
  unavailableProcessCount: number;
  /** Registered external connections whose owned sidecar has exited. */
  unhealthyConnectionCount: number;
  /** Launches observed since this desktop process started. */
  launchCount: number;
  /** Distinct connected sidecars observed exited since this desktop process started. */
  observedExitCount: number;
  lastStartedAtMillis?: number | null;
  lastExitObservedAtMillis?: number | null;
}

export interface ManagedJavaRuntimeInstallation {
  javaMajor: number;
  runtimeVersion: string;
  target: string;
  active: boolean;
  status: "ready" | "incompatible" | "untrusted" | "invalid";
  statusMessage?: string | null;
}

export interface DatabaseDriverProbeResult {
  driver: string;
  packageVersion: string;
  protocolVersion: string;
  supportsMetadata: boolean;
  supportsQuery: boolean;
  supportsCancellation: boolean;
  supportsTransactions: boolean;
  supportsDatabaseScopedQueries: boolean;
  supportsDatabaseCreation: boolean;
  /** Effective Grid editing after manifest + sidecar transaction verification. */
  supportsTableRowMutation: boolean;
  /** Effective cross-connection table transfer after package/runtime verification. */
  supportsTableDataTransfer: boolean;
  /** Required before Agent queries can be delegated to an external sidecar. */
  supportsAgentReadOnlyEnforcement: boolean;
  supportsReferencingForeignKeys: boolean;
}

export interface DatabaseDriverCatalogEntry {
  driverId: string;
  displayName: string;
  packageVersion: string;
  protocolVersion: string;
  downloadUrl: string;
  /** Enables verified in-app installation only when the signed catalog binds this archive digest. */
  archiveSha256?: string | null;
  supportedTargets: string[];
  serverVersionRange?: string | null;
  releaseNotesUrl?: string | null;
  /** Signed discovery metadata; package import remains required to execute. */
  capabilities?: DatabaseCapabilities | null;
  /** Signed release coverage only; it does not grant execution permission. */
  conformance?: DatabaseDriverConformance | null;
}

export interface DatabaseDriverConformance {
  connect: string[];
  metadata: string[];
  query: string[];
  cancellation: string[];
  mutations: string[];
  migration: string[];
  /** Versions that passed source paging, type mapping, and partial-commit transfer fixtures. */
  dataTransfer?: string[];
  /** Hash-bound reports from the official conformance runner. */
  evidence?: DatabaseDriverConformanceEvidence[];
}

export interface DatabaseDriverConformanceEvidence {
  schemaVersion: number;
  runnerVersion: string;
  driverId: string;
  packageVersion: string;
  entrypointSha256: string;
  target: string;
  serverVersion: string;
  fixtureId: string;
  fixtureSha256: string;
  reportUrl: string;
  reportSha256: string;
  operations: Array<
    | "connect"
    | "metadata"
    | "query"
    | "cancellation"
    | "mutations"
    | "migration"
    | "dataTransfer"
  >;
}

export interface DatabaseDriverCatalog {
  catalog: {
    schemaVersion: number;
    generatedAt?: string | null;
    packages: DatabaseDriverCatalogEntry[];
  };
  sourceUrl: string;
}

export interface DatabaseAdminSession {
  id: string;
  user?: string | null;
  host?: string | null;
  database?: string | null;
  state?: string | null;
  statement?: string | null;
  wait?: string | null;
  durationSeconds?: number | null;
}

export interface DatabaseAdminUser {
  name: string;
  host?: string | null;
  canLogin?: boolean | null;
  isSuperuser?: boolean | null;
  authenticationPlugin?: string | null;
}

export interface CreateDatabaseAdminUserRequest {
  name: string;
  password?: string;
  host?: string;
  canLogin?: boolean;
  confirmed: boolean;
}

export interface UpdateDatabaseAdminPasswordRequest {
  name: string;
  password: string;
  host?: string;
  confirmed: boolean;
}

export interface SetDatabaseAdminLoginRequest {
  name: string;
  host?: string;
  canLogin: boolean;
  confirmed: boolean;
}

export interface DeleteDatabaseAdminUserRequest {
  name: string;
  host?: string;
  confirmed: boolean;
}

/**
 * 列定义
 */
export interface ColumnDef {
  name: string;
  data_type: string;
}

/**
 * 查询结果
 */
export interface QueryResult {
  columns: ColumnDef[];
  rows: any[][];
  truncated?: boolean;
  rowLimit?: number;
  rowsAffected?: number;
  statementType?: string;
  message?: string;
  responseMeta?: QueryResponseMeta;
}

export interface QueryResponseMeta {
  requestMethod: string;
  requestPath: string;
  status: number;
  durationMs: number;
  rawResponse: unknown;
}

export interface ElasticsearchConsoleFileImportResult {
  filePath: string;
  fileName: string;
  content: string;
}

export interface ElasticsearchConsoleFileExportResult {
  exported: boolean;
  filePath?: string | null;
  byteCount: number;
}

export type ExplainPlanMode = "estimate" | "analyze";
export type ExplainPlanFormat = "json" | "text";

export interface ExplainPlanNode {
  id: string;
  nodeType: string;
  relation?: string | null;
  alias?: string | null;
  accessType?: string | null;
  joinType?: string | null;
  index?: string | null;
  condition?: string | null;
  startupCost?: number | null;
  totalCost?: number | null;
  estimatedRows?: number | null;
  actualStartupTimeMs?: number | null;
  actualTotalTimeMs?: number | null;
  actualRows?: number | null;
  loops?: number | null;
  children: ExplainPlanNode[];
}

export interface ExplainPlan {
  id: string;
  driver: DatabaseDriver;
  mode: ExplainPlanMode;
  format: ExplainPlanFormat;
  generatedInMs: number;
  planningTimeMs?: number | null;
  executionTimeMs?: number | null;
  totalCost?: number | null;
  estimatedRows?: number | null;
  root: ExplainPlanNode;
  rawPlan: unknown;
  warnings: string[];
}

export interface ExplainQueryRequest {
  connectionId: string;
  sql: string;
  schema?: string;
  database?: string;
  queryId: string;
  mode: ExplainPlanMode;
}

export interface TablePageResult {
  result: QueryResult;
  page: number;
  pageSize: number;
  totalRows?: number | null;
}

export type TableFilterOperator =
  "equals" | "contains" | "startsWith" | "endsWith" | ">" | "<" | ">=" | "<=";

export interface TableFilter {
  column: string;
  operator: TableFilterOperator;
  value: string;
  logic?: "AND" | "OR";
}

export interface TableSort {
  column: string;
  direction: "asc" | "desc";
}

export type TableExportFormat = "csv" | "json" | "jsonl" | "sql" | "tsv" | "xlsx";
export type TableExportEncoding = "utf8" | "utf8Bom" | "binary";

export interface TableExportResult {
  exportId: string;
  filePath: string;
  rowsExported: number;
  batches: number;
  /** Present only when a valid project ID was supplied and local audit storage succeeded. */
  reportId?: string | null;
}

export interface TableExportProgress {
  exportId: string;
  rowsExported: number;
  batches: number;
  terminal: boolean;
  status: "running" | "done" | "cancelled" | "error";
  message?: string | null;
}

export type TableExportReportStatus = "done" | "cancelled" | "error";

/** No file path, SQL, filters, parameters, row values, URLs, or credentials are stored. */
export interface TableExportReport {
  id: string;
  projectId: string;
  exportId: string;
  connectionId: string;
  driver: string;
  schema: string;
  table: string;
  format: TableExportFormat;
  encoding: TableExportEncoding;
  rowsExported: number;
  batches: number;
  status: TableExportReportStatus;
  startedAt: number;
  finishedAt: number;
  error?: string | null;
}

export type TableImportFormat = "csv" | "json" | "xlsx";

/**
 * A reviewed CSV import plan. The same shape is used by the browser preview
 * and the native streaming importer, so a mapped preview cannot silently be
 * written with a different header or empty-value interpretation.
 */
export interface TableCsvColumnMapping {
  sourceIndex: number;
  targetColumn: string | null;
}

export interface TableCsvImportOptions {
  delimiter?: string;
  firstRowHeader?: boolean;
  columnMapping?: TableCsvColumnMapping[];
  emptyFieldsAsNull?: boolean;
}

export interface TableImportResult {
  importId: string;
  filePath: string;
  rowsImported: number;
  batches: number;
  reportId?: string | null;
}

export type TableImportReportStatus = "done" | "error";

/** No source path/digest, SQL, row values, URL, credential, or raw error is stored. */
export interface TableImportReport {
  id: string;
  projectId: string;
  importId: string;
  connectionId: string;
  driver: string;
  schema: string;
  table: string;
  format: TableImportFormat;
  mappingDigest: string;
  rowsImported: number;
  batches: number;
  status: TableImportReportStatus;
  startedAt: number;
  finishedAt: number;
  error?: string | null;
}

export interface TableImportRowIssue { rowNumber: number; code: string; }
export interface TableCsvImportPreflight {
  mappingDigest: string; totalRows: number; acceptedRows: number; rejectedRows: number;
  issues: TableImportRowIssue[]; issuesTruncated: boolean;
}

/** A bounded, read-only prefix used to review a CSV selected by the desktop picker. */
export interface TableCsvImportPreview {
  fileName: string;
  bytes: number[];
  totalBytes: number;
  truncated: boolean;
  /** SHA-256 integrity token for the entire reviewed source file. */
  contentDigest: string;
}

/** A bounded, structured sample used to review a JSON/JSONL import before it writes. */
export interface TableJsonImportPreview {
  fileName: string;
  totalBytes: number;
  /** SHA-256 integrity token for the entire reviewed source file. */
  contentDigest: string;
  sourceColumns: string[];
  sampleRows: Array<Record<string, unknown>>;
  /** `null` for large streaming JSONL/NDJSON sources. */
  totalRows: number | null;
  truncated: boolean;
}

/** A bounded, structured preview of the first worksheet in an XLSX file. */
export interface TableXlsxImportPreview {
  fileName: string;
  totalBytes: number;
  /** SHA-256 integrity token for the entire reviewed source file. */
  contentDigest: string;
  sheetName: string;
  sourceColumns: string[];
  sampleRows: Array<Record<string, unknown>>;
  totalRows: number;
  truncated: boolean;
}

export interface TableDataTransferEndpoint {
  connectionId: string;
  driver: DatabaseDriver;
  schema: string;
  table: string;
  database?: string;
}

export type TableDataTransferMode = "append" | "overwrite" | "upsert";

export interface TableDataTransferRequest {
  /** Enables a durable, privacy-bounded terminal report for this project. */
  projectId?: string;
  transferId: string;
  source: TableDataTransferEndpoint;
  target: TableDataTransferEndpoint;
  mode?: TableDataTransferMode;
  maxRows?: number;
  batchSize?: number;
  reseedIdentity?: boolean;
}

/** A read-only role-to-member relationship returned by the connected server. */
export interface DatabaseAdminRoleMembership {
  role: string;
  member: string;
}

export interface DatabaseAdminTablePrivilege {
  grantee: string;
  schema: string;
  table: string;
  privilege: string;
}

export interface DatabaseAdminMetric {
  key: string;
  label: string;
  value?: string | null;
  unit: string;
  description?: string | null;
  available: boolean;
}

/** A read-only database blocking edge; intentionally contains no SQL text. */
export interface DatabaseAdminLockWait {
  waitingSessionId: string;
  blockingSessionId: string;
  waitingUser?: string | null;
  blockingUser?: string | null;
  database?: string | null;
  wait?: string | null;
  durationSeconds?: number | null;
}

/**
 * Read-only multi-table copy review. The returned confirmation token binds
 * FK order and per-table mappings before the native batch executor writes.
 */
export interface TableDataTransferBatchPlanRequest {
  sourceConnectionId: string;
  sourceDriver: DatabaseDriver;
  sourceDatabase?: string;
  sourceSchema: string;
  targetConnectionId: string;
  targetDriver: DatabaseDriver;
  targetDatabase?: string;
  targetSchema: string;
  tables: string[];
  mode?: TableDataTransferMode;
  maxRows?: number;
  batchSize?: number;
  reseedIdentity?: boolean;
}

export interface TableDataTransferDependency {
  prerequisiteTable: string;
  dependentTable: string;
  constraintName: string;
}

export interface TableDataTransferBatchTablePreflight {
  table: string;
  canExecute: boolean;
  mappedColumns: number;
  /** Digest of the reviewed mapping; no SQL or row data is exposed. */
  planDigest?: string | null;
  warnings: string[];
}

export interface TableDataTransferBatchPlan {
  orderedTables: string[];
  dependencies: TableDataTransferDependency[];
  cyclicTables: string[];
  tablePreflights: TableDataTransferBatchTablePreflight[];
  /**
   * True only when the FK graph and every table mapping are executable. The
   * native executor still rebuilds this plan before opening its transaction.
   */
  canExecute: boolean;
  confirmationToken: string;
  warnings: string[];
}

export interface TableDataTransferBatchExecuteRequest {
  /** Enables a privacy-bounded terminal report for every selected table. */
  projectId?: string;
  transferId: string;
  plan: TableDataTransferBatchPlanRequest;
}

export interface TableDataTransferBatchTableResult {
  table: string;
  rowsTransferred: number;
  batches: number;
  limitReached: boolean;
  reportId?: string | null;
}

export interface TableDataTransferBatchResult {
  rowsTransferred: number;
  batches: number;
  limitReached: boolean;
  tables: TableDataTransferBatchTableResult[];
}

export interface TableDataTransferColumnMapping {
  source: string;
  target: string;
  /** Retained for compatibility; this is the target parameter binding type. */
  dataType: string;
  sourceDataType: string;
  targetDataType: string;
  compatibility: "exact" | "safe" | "review" | "unsupported";
  conversion:
    | "none"
    | "targetBinding"
    | "stringifyJson"
    | "stringifyScalar";
  reason: string;
}

export interface TableDataTransferPreview {
  mode: TableDataTransferMode;
  mappedColumns: TableDataTransferColumnMapping[];
  skippedSourceColumns: string[];
  previewRows: number;
  maxRows: number;
  batchSize: number;
  targetRowsToDelete?: number | null;
  /** Target primary-key columns used as the conflict identity in upsert mode. */
  upsertKeyColumns: string[];
  identityReseedColumns: string[];
  canExecute: boolean;
  confirmationToken: string;
  warnings: string[];
}

export interface TableDataTransferTargetPlanRequest {
  source: TableDataTransferEndpoint;
  target: TableDataTransferEndpoint;
}

export interface TableDataTransferTargetColumn {
  name: string;
  sourceDataType: string;
  targetDataType: string;
  targetLength?: string | null;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  reason: string;
}

export interface TableDataTransferTargetPlan {
  columns: TableDataTransferTargetColumn[];
  statements: string[];
  confirmationToken: string;
  warnings: string[];
}

export interface TableDataTransferResult {
  rowsTransferred: number;
  batches: number;
  limitReached: boolean;
  mappedColumns: TableDataTransferColumnMapping[];
  /** Set when the terminal transfer report was stored successfully. */
  reportId?: string | null;
}

export type TableDataTransferProgressStatus =
  | "running"
  | "done"
  | "cancelled"
  | "error";

export type TableDataTransferVerificationStatus =
  | "verified"
  | "needsReview"
  | "notAvailable";

/** A read-only post-commit count observation; it never includes row values. */
export interface TableDataTransferVerification {
  status: TableDataTransferVerificationStatus;
  expectedRows?: number | null;
  observedRows?: number | null;
  message: string;
}

export interface TableDataTransferProgress {
  transferId: string;
  rowsTransferred: number;
  maxRows: number;
  batches: number;
  status: TableDataTransferProgressStatus;
  terminal: boolean;
  message?: string | null;
}

/** No connection URL, credentials, SQL, parameters, or row values are stored. */
export interface TableDataTransferReport {
  id: string;
  projectId: string;
  transferId: string;
  source: TableDataTransferEndpoint;
  target: TableDataTransferEndpoint;
  mode: TableDataTransferMode;
  planDigest: string;
  maxRows: number;
  rowsTransferred: number;
  batches: number;
  limitReached: boolean;
  status: Exclude<TableDataTransferProgressStatus, "running">;
  startedAt: number;
  finishedAt: number;
  error?: string | null;
  /** Missing for reports written before post-commit verification existed. */
  verification?: TableDataTransferVerification | null;
}

export interface SqlScriptImportResult {
  filePath: string;
  statementsExecuted: number;
  rowsAffected: number;
}

/**
 * Bounded script details returned by the native preflight. The digest binds a
 * user's review to the exact on-disk contents that will later be executed.
 */
export interface SqlScriptImportPreview {
  fileName: string;
  totalBytes: number;
  statementCount: number;
  statementPreview: string[];
  truncated: boolean;
  reviewDigest: string;
}

export interface SqlStatementSelection {
  sql: string;
  startOffset: number;
  endOffset: number;
  statementIndex: number;
  statementCount: number;
  statementRanges?: SqlStatementRange[];
}

export interface SqlStatementRange {
  startOffset: number;
  endOffset: number;
}

export interface SqlSyntaxDiagnostic {
  severity: "error";
  message: string;
  line?: number;
  column?: number;
}

export interface SqlSyntaxValidation {
  valid: boolean;
  driver: DatabaseDriver;
  statementCount: number;
  diagnostics: SqlSyntaxDiagnostic[];
}

export interface TableRowUpdate {
  key: Record<string, unknown>;
  values: Record<string, unknown>;
}

export interface TableRowDelete {
  key: Record<string, unknown>;
}

export interface TableMutationResult {
  inserted: number;
  updated: number;
  deleted: number;
  rowsAffected: number;
}

export interface CreateTableColumn {
  name: string;
  dataType: string;
  length?: string | null;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isAutoIncrement: boolean;
  comment?: string | null;
}

export type AlterColumnValueMode = "keep" | "set" | "drop";

export interface AlterTableColumn {
  name: string;
  dataType?: string | null;
  length?: string | null;
  isNotNull?: boolean | null;
  defaultMode?: AlterColumnValueMode | null;
  defaultValue?: string | null;
  commentMode?: AlterColumnValueMode | null;
  comment?: string | null;
}

export interface CreateTableResult {
  table: string;
  statements: string[];
}

export interface CreateViewResult {
  view: string;
  statement: string;
}

export interface CreateMaterializedViewResult {
  view: string;
  statement: string;
}

export interface TableColumnChangeResult {
  table: string;
  column: string;
  statements: string[];
}

export interface TableIndexChangeResult {
  table: string;
  index: string;
  statements: string[];
}

export interface TableConstraintChangeResult {
  table: string;
  constraint: string;
  statements: string[];
}

/**
 * 保存的连接配置
 */
export type SshAuthMethod = "password" | "privateKey";

export interface SshTunnelConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  strictHostKeyChecking: boolean;
}

export interface SavedConnection {
  id: string;
  projectId?: string;
  name: string;
  driver: DatabaseDriver;
  driverPackageVersion?: string;
  url: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionUrl?: string;
  sslMode?: string;
  sshTunnel?: SshTunnelConfig;
  tags?: string[];
  icon?: string;
  color?: string;
}

/** A desktop-picked external connection configuration, before it is parsed or saved. */
export interface ConnectionImportFile {
  fileName: string;
  content: string;
}

/**
 * 表信息
 */
export interface TableInfo {
  name: string;
  schema?: string;
  type?: string;
  comment?: string;
}

/** Read-only descriptor for a schema object that is not a relation. */
export interface SchemaObjectInfo {
  name: string;
  schema?: string | null;
  objectType: string;
  parentName?: string | null;
  comment?: string | null;
}

/**
 * 文档/搜索集合信息
 */
export interface CollectionInfo {
  name: string;
  namespace?: string | null;
  type?: string | null;
  documentCount?: number | null;
}

export interface CollectionPage {
  items: CollectionInfo[];
  nextCursor?: string | null;
  total?: number | null;
}

/**
 * 列信息
 */
export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  is_unique?: boolean;
  is_indexed?: boolean;
  is_auto_increment?: boolean;
  default_value?: string;
  comment?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  index_type?: string;
  definition?: string;
}

export interface ConstraintInfo {
  name: string;
  constraint_type: string;
  columns: string[];
  referenced_schema?: string;
  referenced_table?: string;
  referenced_columns: string[];
  definition?: string;
}

export interface ForeignKeyReferenceInfo {
  name: string;
  schema: string;
  table: string;
  columns: string[];
  referenced_schema: string;
  referenced_table: string;
  referenced_columns: string[];
}

export interface SchemaRelationSnapshot {
  name: string;
  objectType?: string | null;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
}

/**
 * Review-only routine metadata. Definitions are intentionally not captured,
 * because snapshot diffs must never synthesize dialect-specific routine DDL.
 */
export interface SchemaRoutineSnapshot {
  name: string;
  routineType?: string | null;
  parameters: FunctionParameterInfo[];
  returnType: string;
  description?: string | null;
}

/**
 * Descriptor-only schema metadata. It intentionally excludes source and DDL,
 * therefore its diff entries are always review-only.
 */
export interface SchemaObjectSnapshot {
  name: string;
  objectType: string;
  parentName?: string | null;
  description?: string | null;
}

export interface SchemaSnapshot {
  version: number;
  id: string;
  fingerprint: string;
  projectId: string;
  connectionId: string;
  connectionName: string;
  driver: DatabaseDriver;
  databaseName?: string | null;
  schemaName: string;
  capturedAt: number;
  relations: SchemaRelationSnapshot[];
  /** Absent on snapshots saved before routine signatures were introduced. */
  routines?: SchemaRoutineSnapshot[];
  /** Absent on snapshots captured before descriptor-only object coverage. */
  schemaObjects?: SchemaObjectSnapshot[];
  warnings: string[];
}

export type SchemaChangeRisk = "safe" | "review" | "destructive";
export type SchemaChangeKind =
  | "relationCreate"
  | "relationDrop"
  | "relationModify"
  | "columnAdd"
  | "columnDrop"
  | "columnModify"
  | "indexAdd"
  | "indexDrop"
  | "indexModify"
  | "constraintAdd"
  | "constraintDrop"
  | "constraintModify"
  | "routineCreate"
  | "routineDrop"
  | "routineModify"
  | "schemaObjectCreate"
  | "schemaObjectDrop"
  | "schemaObjectModify";
export type SchemaChangePhase =
  | "dropDependencies"
  | "dropRelations"
  | "createRelations"
  | "alterRelations"
  | "createDependencies"
  | "manualReview";

export interface SchemaChange {
  id: string;
  kind: SchemaChangeKind;
  risk: SchemaChangeRisk;
  schemaName: string;
  relationName: string;
  objectType?: string | null;
  childName?: string | null;
  summary: string;
  sql: string[];
  reversible: boolean;
  manualReview: boolean;
  phase: SchemaChangePhase;
  order: number;
  dependsOn: string[];
  blockedReason?: string | null;
}

export interface SchemaPreflightCheck {
  id: string;
  changeId: string;
  label: string;
  sql: string;
  expectation: string;
  assertion: "advisory" | "emptyRows" | "zeroValue";
  resultColumn?: string | null;
}

export interface SchemaDiffSummary {
  total: number;
  safe: number;
  review: number;
  destructive: number;
  blocked: number;
}

export type SchemaConversionCompatibility =
  | "safe"
  | "review"
  | "unsupported";

export type SchemaConversionFeatureKind =
  | "type"
  | "array"
  | "default"
  | "index"
  | "customType"
  | "schema";

export interface SchemaConversionIssue {
  /** Missing on persisted plans created before conversion issues were categorized. */
  featureKind?: SchemaConversionFeatureKind;
  relationName: string;
  columnName: string;
  sourceDataType: string;
  targetDataType?: string | null;
  compatibility: SchemaConversionCompatibility;
  reason: string;
  /** Empty on persisted plans created before remediation guidance was added. */
  remediation?: string;
  /** True when target-owned input is required before executable DDL can exist. */
  blocksAutomaticConversion?: boolean;
}

export interface SchemaDiffPlan {
  id: string;
  sourceSnapshotId: string;
  targetSnapshotId: string;
  driver: DatabaseDriver;
  targetConnectionId: string;
  targetDatabaseName?: string | null;
  targetSchemaName: string;
  generatedAt: number;
  transactional: boolean;
  summary: SchemaDiffSummary;
  changes: SchemaChange[];
  migrationSql: string;
  preflightChecks: SchemaPreflightCheck[];
  preflightSql: string;
  /** Missing only on persisted plans created before structured conversion review. */
  conversionIssues?: SchemaConversionIssue[];
  warnings: string[];
}

export type SchemaMigrationStatus =
  | "running"
  | "interrupted"
  | "blocked"
  | "failed"
  | "verificationFailed"
  | "succeeded";

export type SchemaMigrationPreflightStatus =
  | "passed"
  | "warning"
  | "blocked"
  | "error";

export interface SchemaMigrationPreflightResult {
  checkId: string;
  changeId: string;
  label: string;
  expectation: string;
  status: SchemaMigrationPreflightStatus;
  observed: string;
  blocksExecution: boolean;
  error?: string | null;
}

export interface SchemaRollbackArtifact {
  available: boolean;
  reason?: string | null;
  planId?: string | null;
  changeCount: number;
  requiresManualReview: boolean;
  sql?: string | null;
}

export interface SchemaMigrationVerification {
  matchesSource: boolean;
  targetFingerprintAfter: string;
  remainingPlanId: string;
  remainingSummary: SchemaDiffSummary;
  warnings: string[];
}

export interface SchemaMigrationJournalEntry {
  id: string;
  projectId: string;
  connectionId: string;
  connectionName: string;
  databaseName?: string | null;
  schemaName: string;
  planId: string;
  sourceFingerprint: string;
  targetFingerprintBefore: string;
  status: SchemaMigrationStatus;
  startedAt: number;
  finishedAt?: number | null;
  statementCount: number;
  committedStatements: number;
  preflightResults: SchemaMigrationPreflightResult[];
  rollback: SchemaRollbackArtifact;
  verification?: SchemaMigrationVerification | null;
  error?: string | null;
  warnings: string[];
}

export interface ExecuteSchemaMigrationRequest {
  source: SchemaSnapshot;
  expectedTarget: SchemaSnapshot;
  expectedPlanId: string;
  expectedTargetFingerprint: string;
  confirmationTarget: string;
  allowReview: boolean;
  allowDestructive: boolean;
  allowNonTransactional: boolean;
}

export interface FunctionParameterInfo {
  name: string;
  data_type: string;
  optional?: boolean;
}

export interface FunctionInfo {
  name: string;
  routine_type?: string | null;
  parameters: FunctionParameterInfo[];
  return_type: string;
  description?: string | null;
}

/**
 * SQL 自动完成上下文
 */
export type CompletionType = "table" | "column" | "keyword" | "none";

export interface CompletionContext {
  suggestionType: CompletionType;
  relevantTable?: string;
  candidates?: string[];
  matchString?: string;
}

/**
 * 连接请求参数
 */
export interface ConnectRequest {
  connectionId: string;
  driver: string;
  url: string;
}

/**
 * 查询请求参数
 */
export interface QueryRequest {
  connectionId: string;
  sql: string;
  schema?: string;
  transactionId?: string;
  queryId?: string;
}

/**
 * Schema 请求参数
 */
export interface SchemaRequest {
  connectionId: string;
}

/**
 * 表请求参数
 */
export interface TablesRequest {
  connectionId: string;
  schema: string;
}

/**
 * 列请求参数
 */
export interface ColumnsRequest {
  connectionId: string;
  schema: string;
  table: string;
}

/**
 * 设置当前 Schema 请求参数
 */
export interface SetSchemaRequest {
  connectionId: string;
  schema: string;
}

/**
 * SQL 自动完成请求参数
 */
export interface CompletionRequest {
  sql: string;
  cursor: number;
}

/**
 * API 错误类
 */
export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly category?: string;
  readonly context: Record<string, unknown>;
  readonly command?: string;

  constructor(
    message: string,
    code = "API_ERROR",
    public originalError?: unknown,
    details: {
      retryable?: boolean;
      category?: string;
      context?: Record<string, unknown>;
      command?: string;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = details.retryable ?? false;
    this.category = details.category;
    this.context = details.context || {};
    this.command = details.command;
  }
}
