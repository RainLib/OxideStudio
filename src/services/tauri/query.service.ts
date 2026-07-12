import { invokeWithInterceptors } from "./client";
import type { QueryResult, CompletionContext } from "./types";

/**
 * 查询执行服务
 * 管理 SQL 查询执行和自动完成
 */

/**
 * 执行 SQL 查询
 * @param connectionId - 连接 ID
 * @param sql - SQL 语句
 * @param schema - 可选的 schema 名称
 * @returns Promise<QueryResult[]> - 查询结果数组
 */
export async function executeQuery(
  connectionId: string,
  sql: string,
  schema?: string,
  transactionId?: string,
  queryId?: string,
  database?: string
): Promise<QueryResult[]> {
  return invokeWithInterceptors<QueryResult[]>("execute_query", {
    connectionId,
    sql,
    schema,
    transactionId,
    queryId,
    database,
  });
}

export async function cancelQuery(queryId: string): Promise<string> {
  return invokeWithInterceptors<string>("cancel_query", {
    queryId,
  });
}

export async function executeReadOnlyQuery(
  connectionId: string,
  sql: string,
  schema?: string,
  queryId?: string
): Promise<QueryResult[]> {
  return invokeWithInterceptors<QueryResult[]>("execute_read_only_query", {
    connectionId,
    sql,
    schema,
    queryId,
  });
}

/**
 * 获取 SQL 自动完成建议
 * @param sql - SQL 语句
 * @param cursor - 光标位置
 * @returns Promise<CompletionContext> - 自动完成上下文
 */
export async function getSqlCompletion(
  sql: string,
  cursor: number
): Promise<CompletionContext> {
  return invokeWithInterceptors<CompletionContext>("get_sql_completion", {
    sql,
    cursor,
  });
}

/**
 * 查询服务对象
 */
export const queryService = {
  executeQuery,
  executeReadOnlyQuery,
  cancelQuery,
  getSqlCompletion,
};
