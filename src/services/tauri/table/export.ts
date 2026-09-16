import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeWithInterceptors } from "../client";
import type {
  DatabaseDriver,
  DatabaseSqlExportResult,
  SqlInsertConflictPolicy,
  TableExportEncoding,
  TableExportFormat,
  TableExportProgress,
  TableExportReport,
  TableExportResult,
  TableFilter,
  TableSort,
} from "../types";

export const TABLE_EXPORT_PROGRESS_EVENT = "table-export://progress";

export interface TableExportOptions {
  exportId?: string;
  projectId?: string;
  encoding?: TableExportEncoding;
  /** SQL INSERT rows per statement. The host enforces 1..1,000 and a 512 KiB byte cap. */
  sqlInsertBatchSize?: number;
  /** Defaults to strict. Skip is accepted only for reviewed native SQL dialects. */
  sqlInsertConflictPolicy?: SqlInsertConflictPolicy;
  /** XLSX only. Defaults to true so exported headers remain immediately filterable. */
  xlsxAutoFilter?: boolean;
}

export interface DatabaseSqlExportOptions {
  exportId?: string;
  includeStructure?: boolean;
  includeData?: boolean;
  /** Exact base-table subset for a bounded data-only SQL export. */
  tableNames?: string[];
  pageSize?: number;
  sqlInsertBatchSize?: number;
}

export function createTableExportId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `table-export-${randomId}`
    : `table-export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function exportTableData(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  format: TableExportFormat = "csv",
  options: TableExportOptions = {},
  filterSql?: string,
  filters?: TableFilter[],
  sort?: TableSort,
  pageSize = 5000,
  maxRows?: number,
): Promise<TableExportResult> {
  const exportId = options.exportId || createTableExportId();
  return invokeWithInterceptors<TableExportResult>("export_table_data", {
    connectionId,
    exportId,
    projectId: options.projectId,
    encoding: options.encoding,
    driver,
    schema,
    table,
    format,
    filterSql,
    filters,
    sort,
    pageSize,
    maxRows,
    sqlInsertBatchSize: options.sqlInsertBatchSize,
    sqlInsertConflictPolicy: options.sqlInsertConflictPolicy,
    xlsxAutoFilter: options.xlsxAutoFilter,
  });
}

/**
 * Whole-schema SQL backup for the built-in PostgreSQL driver. The backend
 * refuses external packages and reports every object kind not yet covered.
 */
export async function exportDatabaseSql(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  options: DatabaseSqlExportOptions = {},
): Promise<DatabaseSqlExportResult> {
  const exportId = options.exportId || createTableExportId();
  return invokeWithInterceptors<DatabaseSqlExportResult>(
    "export_database_sql",
    {
      connectionId,
      exportId,
      driver,
      schema,
      includeStructure: options.includeStructure,
      includeData: options.includeData,
      tableNames: options.tableNames,
      pageSize: options.pageSize,
      sqlInsertBatchSize: options.sqlInsertBatchSize,
    },
  );
}

export async function cancelTableExport(exportId: string): Promise<string> {
  return invokeWithInterceptors<string>("cancel_table_export", { exportId });
}

export async function listenTableExportProgress(
  listener: (progress: TableExportProgress) => void,
): Promise<UnlistenFn> {
  return listen<TableExportProgress>(TABLE_EXPORT_PROGRESS_EVENT, (event) =>
    listener(event.payload),
  );
}

export async function listTableExportReports(
  projectId: string,
  connectionId: string,
  limit = 20,
): Promise<TableExportReport[]> {
  return invokeWithInterceptors<TableExportReport[]>(
    "list_table_export_reports",
    {
      projectId,
      connectionId,
      limit,
    },
  );
}

export const tableExportService = {
  createTableExportId,
  exportTableData,
  exportDatabaseSql,
  cancelTableExport,
  listenTableExportProgress,
  listTableExportReports,
};
