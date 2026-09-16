import type { DatabaseDriver } from "./database";

export interface TableDataCompareEndpoint {
  connectionId: string;
  driver: DatabaseDriver;
  database?: string;
  schema: string;
  table: string;
}

export interface TableDataCompareRequest {
  compareId: string;
  source: TableDataCompareEndpoint;
  target: TableDataCompareEndpoint;
  columns: string[];
  keyColumns: string[];
  batchSize?: number;
  maxRows?: number;
  degradationThreshold?: TableDataCompareDegradationThreshold;
  samplingStrategy?: TableDataCompareSamplingStrategy;
  enableChecksum?: boolean;
}

export type TableDataCompareProgressStatus =
  | "running"
  | "done"
  | "cancelled"
  | "error";

export type TableDataCompareProgressPhase =
  | "validating"
  | "counting"
  | "selecting_sample_keys"
  | "fetching_rows"
  | "comparing"
  | "completed";

export interface TableDataCompareProgress {
  compareId: string;
  phase: TableDataCompareProgressPhase;
  endpoint?: "source" | "target" | null;
  processedRows: number;
  sourceRowCount?: number | null;
  targetRowCount?: number | null;
  status: TableDataCompareProgressStatus;
  terminal: boolean;
  message?: string | null;
}

export type TableDataCompareDegradationLevel =
  | "full"
  | "sample"
  | "skip_with_risk";

export type TableDataCompareSamplingStrategy = "extremeValues";

export interface TableDataCompareDegradationThreshold {
  fullCompareMaxRows: number;
  sampleMaxRows: number;
  sampleSize: number;
}

export interface TableDataCompareRow {
  key: string;
  values: Record<string, unknown>;
}

export interface TableDataCompareModifiedRow {
  key: string;
  sourceValues: Record<string, unknown>;
  targetValues: Record<string, unknown>;
  changedColumns: string[];
}

export interface TableDataCompareResult {
  added: TableDataCompareRow[];
  removed: TableDataCompareRow[];
  modified: TableDataCompareModifiedRow[];
  /** Exact for full comparison, sample-local when countsExact is false. */
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  equalCount: number;
  sourceRowCount: number;
  targetRowCount: number;
  comparedKeyCount: number;
  batchSize: number;
  detailLimitPerStatus: number;
  detailsTruncated: boolean;
  degradationLevel: TableDataCompareDegradationLevel;
  samplingStrategy?: TableDataCompareSamplingStrategy;
  samplingRate: number;
  /** Omitted for deterministic extreme sampling, which has no statistical confidence claim. */
  confidenceScore?: number;
  verificationMethod:
    | "full_keyset"
    | "extreme_key_sample"
    | "skipped_size_limit";
  countsExact: boolean;
  sampledKeyCount: number;
  sourceChecksums?: Record<string, string>;
  targetChecksums?: Record<string, string>;
  checksumsMatch?: boolean;
}

export interface TableDataCompareSyncPreviewRequest {
  target: TableDataCompareEndpoint;
  columns: string[];
  keyColumns: string[];
  comparison: TableDataCompareResult;
}

export interface TableDataCompareSyncPreview {
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  statementCount: number;
  statements: string[];
  sql: string;
  planDigest: string;
  /** The displayed SQL remains a review artifact; execution uses the frozen parameterized plan. */
  reviewOnly: true;
  canExecute: boolean;
  planToken: string;
  expiresAt: number;
  confirmationText: string;
  warnings: string[];
}

export interface ExecuteTableDataCompareSyncRequest {
  planToken: string;
  planDigest: string;
  confirmationText: string;
}

export interface TableDataCompareSyncReceipt {
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  rowsAffected: number;
  planDigest: string;
}
