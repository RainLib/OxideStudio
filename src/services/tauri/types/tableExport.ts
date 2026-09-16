import type { DatabaseTableExportFormat } from "./database";

export type TableExportFormat = DatabaseTableExportFormat;

export type TableExportEncoding = "utf8" | "utf8Bom" | "binary";

export type SqlInsertConflictPolicy = "strict" | "skip" | "update";

export interface TableExportTypeCoercion {
  column: string;
  sourceType: string;
  outputType: string;
  reason: string;
}

export interface TableExportResult {
  exportId: string;
  filePath: string;
  rowsExported: number;
  batches: number;
  /** Undefined means every row matching the current filters was exported. */
  maxRows?: number | null;
  /** Present only when a valid project ID was supplied and local audit storage succeeded. */
  reportId?: string | null;
  /** Schema-only notices for analytical columns represented losslessly as UTF-8. */
  typeCoercions: TableExportTypeCoercion[];
}

/**
 * Conservative whole-schema backup result. `omittedObjectKinds` is always
 * explicit so callers do not treat the initial relation backup as a complete
 * logical database dump.
 */
export interface DatabaseSqlExportResult {
  exportId: string;
  filePath: string;
  tablesExported: number;
  rowsExported: number;
  batches: number;
  omittedObjectKinds: string[];
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
  /** Undefined for reports produced before scoped exports were introduced. */
  maxRows?: number | null;
  status: TableExportReportStatus;
  startedAt: number;
  finishedAt: number;
  error?: string | null;
}
