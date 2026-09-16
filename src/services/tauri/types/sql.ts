import type { DatabaseDriver } from "./database";

export interface SqlScriptImportResult {
  filePath: string;
  statementsExecuted: number;
  rowsAffected: number;
}

/**
 * Bounded script details returned by the native preflight. The digest binds a
 * user's review to the exact on-disk contents that will later be executed.
 */
export interface SqlScriptImportPreview {
  fileName: string;
  totalBytes: number;
  statementCount: number;
  statementPreview: string[];
  truncated: boolean;
  reviewDigest: string;
}

export interface SqlStatementSelection {
  sql: string;
  startOffset: number;
  endOffset: number;
  statementIndex: number;
  statementCount: number;
  statementRanges?: SqlStatementRange[];
}

export interface SqlStatementRange {
  startOffset: number;
  endOffset: number;
}

export interface DmlChangePreviewSqlOptions {
  sql: string;
  databaseType?: string;
  identifierQuote?: string;
  columns?: string[];
}

export interface DmlChangePreviewTableRef {
  catalog?: string | null;
  database?: string | null;
  schema?: string | null;
  table?: string | null;
}

export interface DmlChangePreviewSqlResult {
  sql: string;
  operation: "update" | "insert" | "delete";
  hasNewValueColumns: boolean;
  tables: DmlChangePreviewTableRef[];
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
