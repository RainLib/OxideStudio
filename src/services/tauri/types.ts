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
export type DatabaseDriver = "postgres" | "mysql";

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
  column_default?: string;
  character_maximum_length?: number;
  numeric_precision?: number;
  numeric_scale?: number;
  comment?: string;
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
