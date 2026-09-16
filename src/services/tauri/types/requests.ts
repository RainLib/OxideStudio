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
