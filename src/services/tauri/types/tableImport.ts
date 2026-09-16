import type { CreateTableColumn } from "./tableDdl";

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
  /** One-based source record containing column names; zero disables it. */
  titleRow?: number;
  /** One-based first source record included in the import. */
  dataStartRow?: number;
  /** One-based final source record; zero means unbounded. */
  lastDataRow?: number;
  columnMapping?: TableCsvColumnMapping[];
  emptyFieldsAsNull?: boolean;
  trimValues?: boolean;
  encoding?: "auto" | "utf-8" | "utf-16le" | "utf-16be" | "gb18030";
}

export interface TableImportResult {
  importId: string;
  filePath: string;
  rowsImported: number;
  batches: number;
  reportId?: string | null;
}

/** Column-only schema proposal derived from a reviewed native import file. */
export interface TableImportColumnInference {
  columns: CreateTableColumn[];
  totalRows: number;
  contentDigest: string;
  csvOptions?: TableCsvImportOptions | null;
}

export type TableImportMode = "append" | "truncate";

export type TableImportReportStatus = "done" | "cancelled" | "error";

export interface TableImportProgress {
  importId: string;
  rowsImported: number;
  batches: number;
  totalRows?: number | null;
  terminal: boolean;
  status: "preparing" | "running" | "done" | "cancelled" | "error";
  message?: string | null;
}

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
  mode: TableImportMode;
  mappingDigest: string;
  rowsImported: number;
  batches: number;
  status: TableImportReportStatus;
  startedAt: number;
  finishedAt: number;
  error?: string | null;
}

export interface TableImportRowIssue {
  rowNumber: number;
  code: string;
}

export interface TableCsvImportPreflight {
  mappingDigest: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  issues: TableImportRowIssue[];
  issuesTruncated: boolean;
}

/** Full-file JSON/JSONL validation performed before the import transaction starts. */
export interface TableJsonImportPreflight {
  mappingDigest: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  issues: TableImportRowIssue[];
  issuesTruncated: boolean;
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
