import type {
  TableCsvImportOptions,
  TableImportFormat,
  TableImportMode,
} from "./tableImport";

export interface PrepareTableImportJobRequest {
  projectId: string;
  importId: string;
  connectionId: string;
  driver: "sqlite";
  schema: string;
  table: string;
  database?: string | null;
  filePath: string;
  format: TableImportFormat;
  mode: TableImportMode;
  firstRowHeader?: boolean | null;
  csvOptions?: TableCsvImportOptions | null;
  expectedFileDigest: string;
}

export interface FileImportPreparationSummary {
  id: string;
  importId: string;
  phase: "copying" | "inspecting" | "normalizing" | "ready";
  sourceBytes: number;
  normalizedRows: number;
  active: boolean;
  display?: {
    fileName: string;
    format: TableImportFormat;
    connectionId: string;
    schema: string;
    table: string;
    mode: TableImportMode;
  } | null;
}

export interface FileImportPreparationPage {
  preparations: FileImportPreparationSummary[];
  nextCursor?: string | null;
}

/** Reviewed source metadata. Paths, row values and credentials are excluded. */
export interface FileImportSnapshotPlan {
  fileName: string;
  format: TableImportFormat;
  sourceDigest: string;
  normalizedDigest: string;
  /** Host-owned presence bitmap column; not a user mapping. */
  presenceColumn?: string | null;
  columns: { source: string; target: string }[];
  options: {
    firstRowHeader?: boolean | null;
    csvOptions?: TableCsvImportOptions | null;
  };
}
