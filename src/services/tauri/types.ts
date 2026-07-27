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
  "postgres" | "mysql" | "redis" | "elasticsearch" | "mongodb";
export type DatabaseDriver = KnownDatabaseDriver | (string & {});
export type DatabaseDataModel =
  "relational" | "document" | "keyValue" | "search";

export interface DatabaseCapabilities {
  driver: DatabaseDriver;
  displayName: string;
  dataModel: DatabaseDataModel;
  lspLanguageId: string;
  namespaceLabel: string;
  identifierQuote: string;
  defaultPort: number;
  supportsSqlQuery: boolean;
  supportsTableBrowsing: boolean;
  supportsCollectionBrowsing: boolean;
  supportsKeyValueBrowsing: boolean;
  supportsSchemas: boolean;
  supportsCreateDatabase: boolean;
  supportsCreateDatabaseCharset: boolean;
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

export type TableExportFormat = "csv" | "json" | "sql";

export interface TableExportResult {
  filePath: string;
  rowsExported: number;
}

export type TableImportFormat = "csv" | "json";

export interface TableImportResult {
  filePath: string;
  rowsImported: number;
  batches: number;
}

export interface SqlScriptImportResult {
  filePath: string;
  statementsExecuted: number;
  rowsAffected: number;
}

export interface SqlStatementSelection {
  sql: string;
  startOffset: number;
  endOffset: number;
  statementIndex: number;
  statementCount: number;
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

/**
 * 表信息
 */
export interface TableInfo {
  name: string;
  schema?: string;
  type?: string;
  comment?: string;
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
  | "constraintModify";
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
  warnings: string[];
}

export type SchemaMigrationStatus =
  | "running"
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
