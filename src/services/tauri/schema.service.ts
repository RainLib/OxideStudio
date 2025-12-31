import { invokeWithInterceptors } from "./client";
import type { TableInfo, ColumnInfo } from "./types";

/**
 * Schema 和表结构服务
 * 管理数据库 schema、表和列的元数据
 */

/**
 * 获取所有 schema 列表
 * @param connectionId - 连接 ID
 * @returns Promise<string[]> - schema 名称列表
 */
export async function getSchemas(connectionId: string): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_schemas", {
    connectionId,
  });
}

/**
 * 获取指定 schema 下的表列表
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<TableInfo[]> - 表信息列表
 */
export async function getTables(
  connectionId: string,
  schema: string
): Promise<TableInfo[]> {
  return invokeWithInterceptors<TableInfo[]>("get_tables", {
    connectionId,
    schema,
  });
}

/**
 * 获取指定表的列信息
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @param table - 表名称
 * @returns Promise<ColumnInfo[]> - 列信息列表
 */
export async function getColumns(
  connectionId: string,
  schema: string,
  table: string
): Promise<ColumnInfo[]> {
  return invokeWithInterceptors<ColumnInfo[]>("get_columns", {
    connectionId,
    schema,
    table,
  });
}

/**
 * 设置当前 schema
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<string> - 设置成功消息
 */
export async function setCurrentSchema(
  connectionId: string,
  schema: string
): Promise<string> {
  return invokeWithInterceptors<string>("set_current_schema", {
    connectionId,
    schema,
  });
}

/**
 * 获取缓存的 schema 列表
 * @param connectionId - 连接 ID
 * @returns Promise<string[]> - 缓存的 schema 列表
 */
export async function getCachedSchemas(
  connectionId: string
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_cached_schemas", {
    connectionId,
  });
}

/**
 * 刷新 schema 列表
 * @param connectionId - 连接 ID
 * @returns Promise<string[]> - 刷新后的 schema 列表
 */
export async function refreshSchemas(connectionId: string): Promise<string[]> {
  return invokeWithInterceptors<string[]>("refresh_schemas", {
    connectionId,
  });
}

/**
 * 获取缓存的表列表
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<TableInfo[]> - 缓存的表列表
 */
export async function getCachedTables(
  connectionId: string,
  schema: string
): Promise<TableInfo[]> {
  return invokeWithInterceptors<TableInfo[]>("get_cached_tables", {
    connectionId,
    schema,
  });
}

/**
 * 刷新表列表
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<TableInfo[]> - 刷新后的表列表
 */
export async function refreshTables(
  connectionId: string,
  schema: string
): Promise<TableInfo[]> {
  return invokeWithInterceptors<TableInfo[]>("refresh_tables", {
    connectionId,
    schema,
  });
}

/**
 * Schema 服务对象
 */
export const schemaService = {
  getSchemas,
  getTables,
  getColumns,
  setCurrentSchema,
  getCachedSchemas,
  refreshSchemas,
  getCachedTables,
  refreshTables,
};
