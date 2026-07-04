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
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 数据库驱动类型
 */
export type KnownDatabaseDriver =
  | "postgres"
  | "mysql"
  | "redis"
  | "elasticsearch";
export type DatabaseDriver = KnownDatabaseDriver | (string & {});
export type DatabaseDataModel = "relational" | "document" | "keyValue" | "search";

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
  rowsAffected?: number;
  statementType?: string;
  message?: string;
}

export interface TablePageResult {
  result: QueryResult;
  page: number;
  pageSize: number;
  totalRows?: number | null;
}

export type TableFilterOperator =
  | "equals"
  | "contains"
  | "startsWith"
  | "endsWith"
  | ">"
  | "<"
  | ">="
  | "<=";

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

export type TableExportFormat = "csv" | "json";

export interface TableExportResult {
  filePath: string;
  rowsExported: number;
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
export interface SavedConnection {
  id: string;
  name: string;
  driver: DatabaseDriver;
  url: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
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
  constructor(
    message: string,
    public code?: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}
