import {
  buildCsvImportPlan, csvSourceColumns, decodeCsvBytes, inferCsvDelimiter,
  parseCsv, selectCsvDataRecords, validateCsvRowSelection,
  type CsvColumnMapping, type CsvEncoding, type CsvImportPlan, type CsvParseResult,
} from "@/lib/csvImport";
import type { ColumnInfo } from "@/services/tauri/types";

export const CSV_PREVIEW_ROWS = 50;
export const CSV_MAX_ROWS = 100_000;

export interface CsvAnalysisOptions {
  encoding: CsvEncoding;
  delimiter: string;
  titleRow: number;
  dataStartRow: number;
  lastDataRow: number;
  mapping: CsvColumnMapping[];
  columns: ColumnInfo[];
  emptyAsNull: boolean;
  trimValues: boolean;
}

/** Retains full rows in the worker; only the reviewed submission retrieves them. */
export class CsvImportSession {
  private decoded?: ReturnType<typeof decodeCsvBytes>;
  private encoding?: CsvEncoding;
  private parseKey = "";
  private parsed?: CsvParseResult;
  private plan?: CsvImportPlan;
  private revision = 0;

  constructor(private readonly bytes: Uint8Array) {}

  analyze(revision: number, options: CsvAnalysisOptions) {
    // Failed analyses must also revoke a previously valid submission.
    this.revision = revision;
    this.plan = undefined;
    if (!this.decoded || this.encoding !== options.encoding) {
      this.decoded = decodeCsvBytes(this.bytes, options.encoding);
      this.encoding = options.encoding;
      this.parseKey = "";
    }
    const delimiter = options.delimiter === "auto"
      ? inferCsvDelimiter(this.decoded.text) : options.delimiter;
    const rowSelection = { ...options, hasHeader: options.titleRow > 0 };
    const selectionError = validateCsvRowSelection(rowSelection);
    const recordLimit = CSV_MAX_ROWS + Math.max(options.titleRow, options.dataStartRow) + 2;
    const parseKey = JSON.stringify([delimiter, recordLimit]);
    if (!this.parsed || this.parseKey !== parseKey) {
      this.parsed = parseCsv(this.decoded.text, delimiter, recordLimit);
      this.parseKey = parseKey;
    }
    const records = selectCsvDataRecords(this.parsed.records, rowSelection);
    const error = selectionError || (records.length > CSV_MAX_ROWS
      ? "The selected range exceeds 100,000 rows. Use Import delimited text (streaming)… for larger sources."
      : null);
    this.plan = error ? { rows: [], issues: [], errorCount: 0 } : buildCsvImportPlan({
      ...rowSelection,
      records: this.parsed.records,
      parseIssues: this.parsed.issues,
    });
    return {
      encoding: this.decoded.encoding,
      delimiter,
      sourceColumns: csvSourceColumns(this.parsed.records, rowSelection.hasHeader,
        options.titleRow, options.dataStartRow, options.lastDataRow),
      previewRecords: records.slice(0, CSV_PREVIEW_ROWS),
      dataRowCount: records.length,
      rowCount: this.plan.rows.length,
      issues: this.plan.issues,
      errorCount: this.plan.errorCount,
      error,
    };
  }

  rows(revision: number) {
    if (revision !== this.revision || !this.plan || this.plan.errorCount || !this.plan.rows.length) {
      throw new Error("CSV review changed. Wait for validation before importing.");
    }
    return this.plan.rows;
  }
}

export type CsvAnalysis = ReturnType<CsvImportSession["analyze"]>;
export type CsvWorkerRequest =
  | { type: "init"; bytes: Uint8Array }
  | { type: "analyze"; id: number; options: CsvAnalysisOptions }
  | { type: "rows"; id: number; revision: number };
export type CsvWorkerResponse = {
  id: number;
  value?: CsvAnalysis | Array<Record<string, unknown>>;
  error?: string;
};
