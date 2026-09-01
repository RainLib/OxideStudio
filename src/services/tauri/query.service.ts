import { invokeWithInterceptors } from "./client";
import type {
  QueryResult,
  CompletionContext,
  ExplainPlan,
  ExplainQueryRequest,
  ElasticsearchConsoleFileExportResult,
  ElasticsearchConsoleFileImportResult,
  SqlScriptImportPreview,
  SqlScriptImportResult,
  SqlStatementSelection,
  SqlSyntaxValidation,
  DmlChangePreviewSqlOptions,
  DmlChangePreviewSqlResult,
} from "./types";

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
  database?: string,
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

export async function resolveSqlStatementAtCursor(
  connectionId: string,
  sql: string,
  cursorOffset: number,
): Promise<SqlStatementSelection | null> {
  return invokeWithInterceptors<SqlStatementSelection | null>(
    "resolve_sql_statement_at_cursor",
    { connectionId, sql, cursorOffset },
  );
}

export async function validateSqlSyntax(
  driver: string,
  sql: string,
  lspLanguageId?: string,
  lspServerDialect?: string,
): Promise<SqlSyntaxValidation> {
  return invokeWithInterceptors<SqlSyntaxValidation>("validate_sql_syntax", {
    driver,
    sql,
    ...(lspLanguageId ? { lspLanguageId } : {}),
    ...(lspServerDialect ? { lspServerDialect } : {}),
  });
}

export async function buildDmlChangePreviewSql(
  options: DmlChangePreviewSqlOptions,
): Promise<DmlChangePreviewSqlResult> {
  return invokeWithInterceptors<DmlChangePreviewSqlResult>(
    "build_dml_change_preview_sql",
    { options },
  );
}

export async function importSqlScript(
  connectionId: string,
  filePath: string,
  reviewDigest: string,
  schema?: string,
  database?: string,
): Promise<SqlScriptImportResult> {
  return invokeWithInterceptors<SqlScriptImportResult>("import_sql_script", {
    connectionId,
    filePath,
    schema,
    database,
    reviewDigest,
  });
}

export async function previewSqlScriptImport(
  connectionId: string,
  filePath: string,
): Promise<SqlScriptImportPreview> {
  return invokeWithInterceptors<SqlScriptImportPreview>(
    "preview_sql_script_import",
    { connectionId, filePath },
  );
}

export async function importElasticsearchConsoleFile(): Promise<ElasticsearchConsoleFileImportResult | null> {
  return invokeWithInterceptors<ElasticsearchConsoleFileImportResult | null>(
    "import_elasticsearch_console_file",
  );
}

export async function exportElasticsearchConsoleFile(
  content: string,
): Promise<ElasticsearchConsoleFileExportResult> {
  return invokeWithInterceptors<ElasticsearchConsoleFileExportResult>(
    "export_elasticsearch_console_file",
    { content },
  );
}

export async function executeReadOnlyQuery(
  connectionId: string,
  sql: string,
  schema?: string,
  queryId?: string,
): Promise<QueryResult[]> {
  return invokeWithInterceptors<QueryResult[]>("execute_read_only_query", {
    connectionId,
    sql,
    schema,
    queryId,
  });
}

export async function explainQuery(
  request: ExplainQueryRequest,
): Promise<ExplainPlan> {
  return invokeWithInterceptors<ExplainPlan>("explain_query", { request });
}

/**
 * 获取 SQL 自动完成建议
 * @param sql - SQL 语句
 * @param cursor - 光标位置
 * @returns Promise<CompletionContext> - 自动完成上下文
 */
export async function getSqlCompletion(
  sql: string,
  cursor: number,
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
  previewSqlScriptImport,
  importSqlScript,
  importElasticsearchConsoleFile,
  exportElasticsearchConsoleFile,
  explainQuery,
  cancelQuery,
  resolveSqlStatementAtCursor,
  validateSqlSyntax,
  buildDmlChangePreviewSql,
  getSqlCompletion,
};
