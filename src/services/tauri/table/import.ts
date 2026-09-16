import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeWithInterceptors } from "../client";
import type {
  DatabaseDriver,
  TableCsvImportOptions,
  TableCsvImportPreflight,
  TableCsvImportPreview,
  TableImportColumnInference,
  TableImportFormat,
  TableImportMode,
  TableImportProgress,
  TableImportReport,
  TableImportResult,
  TableJsonImportPreflight,
  TableJsonImportPreview,
  TableXlsxImportPreview,
} from "../types";

export const TABLE_IMPORT_PROGRESS_EVENT = "table-import://progress";

export interface TableImportOptions {
  importId?: string;
  projectId?: string;
  mode?: TableImportMode;
}

export function createTableImportId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `table-import-${randomId}`
    : `table-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function importTableData(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  filePath: string,
  format: TableImportFormat,
  firstRowHeader = true,
  databaseName?: string,
  csvOptions?: TableCsvImportOptions,
  expectedFileDigest?: string,
  options: TableImportOptions = {},
): Promise<TableImportResult> {
  const importId = options.importId || createTableImportId();
  return invokeWithInterceptors<TableImportResult>("import_table_data", {
    connectionId,
    importId,
    projectId: options.projectId,
    driver,
    schema,
    table,
    filePath,
    format,
    mode: options.mode ?? "append",
    firstRowHeader,
    database: databaseName,
    csvOptions,
    expectedFileDigest,
  });
}

export async function preflightTableCsvImport(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  filePath: string,
  firstRowHeader = true,
  databaseName?: string,
  csvOptions?: TableCsvImportOptions,
  expectedFileDigest?: string,
  mode: TableImportMode = "append",
): Promise<TableCsvImportPreflight> {
  return invokeWithInterceptors<TableCsvImportPreflight>(
    "preflight_table_csv_import",
    {
      connectionId,
      driver,
      schema,
      table,
      filePath,
      firstRowHeader,
      mode,
      database: databaseName,
      csvOptions,
      expectedFileDigest,
    },
  );
}

export async function preflightTableJsonImport(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  filePath: string,
  databaseName?: string,
  expectedFileDigest?: string,
  mode: TableImportMode = "append",
): Promise<TableJsonImportPreflight> {
  return invokeWithInterceptors<TableJsonImportPreflight>(
    "preflight_table_json_import",
    {
      connectionId,
      driver,
      schema,
      table,
      filePath,
      mode,
      database: databaseName,
      expectedFileDigest,
    },
  );
}

export async function inferTableImportColumns(
  driver: DatabaseDriver,
  filePath: string,
  format: TableImportFormat,
  firstRowHeader = true,
  csvOptions?: TableCsvImportOptions,
  expectedFileDigest?: string,
): Promise<TableImportColumnInference> {
  return invokeWithInterceptors<TableImportColumnInference>(
    "infer_table_import_columns",
    {
      driver,
      filePath,
      format,
      firstRowHeader,
      csvOptions,
      expectedFileDigest,
    },
  );
}

export async function listTableImportReports(
  projectId: string,
  connectionId: string,
  limit = 20,
): Promise<TableImportReport[]> {
  return invokeWithInterceptors<TableImportReport[]>(
    "list_table_import_reports",
    {
      projectId,
      connectionId,
      limit,
    },
  );
}

export async function cancelTableImport(importId: string): Promise<string> {
  return invokeWithInterceptors<string>("cancel_table_import", { importId });
}

export async function listenTableImportProgress(
  listener: (progress: TableImportProgress) => void,
): Promise<UnlistenFn> {
  return listen<TableImportProgress>(TABLE_IMPORT_PROGRESS_EVENT, (event) =>
    listener(event.payload),
  );
}

export async function previewTableCsvImport(
  filePath: string,
): Promise<TableCsvImportPreview> {
  return invokeWithInterceptors<TableCsvImportPreview>(
    "preview_table_csv_import",
    { filePath },
  );
}

export async function previewTableJsonImport(
  filePath: string,
): Promise<TableJsonImportPreview> {
  return invokeWithInterceptors<TableJsonImportPreview>(
    "preview_table_json_import",
    { filePath },
  );
}

export async function previewTableXlsxImport(
  filePath: string,
): Promise<TableXlsxImportPreview> {
  return invokeWithInterceptors<TableXlsxImportPreview>(
    "preview_table_xlsx_import",
    { filePath },
  );
}

export const tableImportService = {
  createTableImportId,
  importTableData,
  preflightTableCsvImport,
  preflightTableJsonImport,
  inferTableImportColumns,
  listTableImportReports,
  cancelTableImport,
  listenTableImportProgress,
  previewTableCsvImport,
  previewTableJsonImport,
  previewTableXlsxImport,
};
