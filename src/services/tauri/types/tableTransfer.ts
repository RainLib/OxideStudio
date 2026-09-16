import type { DatabaseDriver } from "./database";

export interface TableDataTransferEndpoint {
  connectionId: string;
  driver: DatabaseDriver;
  schema: string;
  table: string;
  database?: string;
}

export type TableDataTransferMode = "append" | "overwrite" | "upsert";

export interface TableDataTransferRequest {
  /** Enables a durable, privacy-bounded terminal report for this project. */
  projectId?: string;
  transferId: string;
  source: TableDataTransferEndpoint;
  target: TableDataTransferEndpoint;
  mode?: TableDataTransferMode;
  maxRows?: number;
  batchSize?: number;
  reseedIdentity?: boolean;
  /** Defaults to true; false is Host-gated to reviewed GaussDB/openGauss packages. */
  quoteTargetColumnNames?: boolean;
  /** Restore reviewed same-product indexes and constraints after row writes. */
  restoreSourceSchemaObjects?: boolean;
}

/**
 * Read-only multi-table copy review. The returned confirmation token binds
 * FK order and per-table mappings before the native batch executor writes.
 */
export interface TableDataTransferBatchPlanRequest {
  sourceConnectionId: string;
  sourceDriver: DatabaseDriver;
  sourceDatabase?: string;
  sourceSchema: string;
  targetConnectionId: string;
  targetDriver: DatabaseDriver;
  targetDatabase?: string;
  targetSchema: string;
  tables: string[];
  /** Explicit non-table objects; tables remain in the separate ordered list. */
  objects?: TableDataTransferObjectSelection[];
  mode?: TableDataTransferMode;
  maxRows?: number;
  batchSize?: number;
  reseedIdentity?: boolean;
  /** Defaults to true; false is Host-gated to reviewed GaussDB/openGauss packages. */
  quoteTargetColumnNames?: boolean;
  restoreSourceSchemaObjects?: boolean;
}

export type TableDataTransferObjectKind =
  | "VIEW"
  | "MATERIALIZED_VIEW"
  | "FUNCTION"
  | "PROCEDURE"
  | "TRIGGER"
  | "SEQUENCE"
  | "EVENT";

export interface TableDataTransferObjectSelection {
  objectType: TableDataTransferObjectKind;
  name: string;
  parentName?: string | null;
}

export type TableDataTransferObjectAction =
  | "create"
  | "skipExisting"
  | "blocked";

export interface TableDataTransferObjectPreflight
  extends TableDataTransferObjectSelection {
  action: TableDataTransferObjectAction;
  canExecute: boolean;
  statements: string[];
  planDigest?: string | null;
  dependsOn: string[];
  warnings: string[];
}

export interface TableDataTransferDependency {
  prerequisiteTable: string;
  dependentTable: string;
  constraintName: string;
}

export interface TableDataTransferBatchTablePreflight {
  table: string;
  canExecute: boolean;
  mappedColumns: number;
  /** Digest of the reviewed mapping; no SQL or row data is exposed. */
  planDigest?: string | null;
  /** Preview-only target generator identities and current state. */
  identityReseedPlans?: TableDataTransferIdentityReseedPlan[];
  schemaRestoreStatements?: string[];
  warnings: string[];
}

export interface TableDataTransferBatchPlan {
  orderedTables: string[];
  dependencies: TableDataTransferDependency[];
  cyclicTables: string[];
  tablePreflights: TableDataTransferBatchTablePreflight[];
  objectPreflights?: TableDataTransferObjectPreflight[];
  /**
   * True only when the FK graph and every table mapping are executable. The
   * native executor still rebuilds this plan before opening its transaction.
   */
  canExecute: boolean;
  confirmationToken: string;
  warnings: string[];
}

export interface TableDataTransferBatchExecuteRequest {
  /** Enables a privacy-bounded terminal report for every selected table. */
  projectId?: string;
  transferId: string;
  plan: TableDataTransferBatchPlanRequest;
}

export interface TableDataTransferBatchTableResult {
  table: string;
  rowsTransferred: number;
  batches: number;
  limitReached: boolean;
  /** Reviewed target baseline used to verify append/overwrite results. */
  targetRowsBefore?: number | null;
  identityReseedColumns: string[];
  restoredSchemaObjects?: number;
  reportId?: string | null;
}

export type TableDataTransferPostCommitStatus =
  | "completed"
  | "needsManualReview";

export interface TableDataTransferPostCommitReceipt {
  status: TableDataTransferPostCommitStatus;
  statementsTotal: number;
  statementsSucceeded: number;
  message: string;
}

export interface TableDataTransferBatchResult {
  rowsTransferred: number;
  batches: number;
  limitReached: boolean;
  tables: TableDataTransferBatchTableResult[];
  objects?: Array<
    TableDataTransferObjectSelection & {
      action: TableDataTransferObjectAction;
      reportId?: string | null;
    }
  >;
  postCommitReceipt?: TableDataTransferPostCommitReceipt | null;
}

export type TableDataTransferCompatibility =
  | "exact"
  | "safe"
  | "review"
  | "unsupported";

export interface TableDataTransferColumnMapping {
  source: string;
  target: string;
  /** Retained for compatibility; this is the target parameter binding type. */
  dataType: string;
  sourceDataType: string;
  targetDataType: string;
  compatibility: TableDataTransferCompatibility;
  conversion: "none" | "targetBinding" | "stringifyJson" | "stringifyScalar";
  reason: string;
}

/**
 * Exact PostgreSQL generator ownership captured during preview. Numeric state
 * is bound to the one-time confirmation but is not stored in transfer reports.
 */
export interface TableDataTransferIdentityReseedPlan {
  column: string;
  sequenceSchema: string;
  sequenceName: string;
  ownerSchema: string;
  ownerTable: string;
  ownerColumn: string;
  currentValue?: string | null;
  targetMaxValue?: string | null;
}

export interface TableDataTransferPreview {
  mode: TableDataTransferMode;
  mappedColumns: TableDataTransferColumnMapping[];
  skippedSourceColumns: string[];
  previewRows: number;
  maxRows: number;
  batchSize: number;
  /** Read-only target row-count baseline bound to append/overwrite preview. */
  targetRowsBefore?: number | null;
  targetRowsToDelete?: number | null;
  /** Target primary-key columns used as the conflict identity in upsert mode. */
  upsertKeyColumns: string[];
  identityReseedColumns: string[];
  identityReseedPlans?: TableDataTransferIdentityReseedPlan[];
  schemaRestoreStatements?: string[];
  canExecute: boolean;
  confirmationToken: string;
  warnings: string[];
}

export interface TableDataTransferTargetPlanRequest {
  source: TableDataTransferEndpoint;
  target: TableDataTransferEndpoint;
}

export interface TableDataTransferTargetColumn {
  name: string;
  sourceDataType: string;
  targetDataType: string;
  targetLength?: string | null;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  sourceAutoIncrement: boolean;
  sourceIdentityGeneration?: "always" | "byDefault" | null;
  identityRetained: boolean;
  targetIdentityGeneration?: "always" | "byDefault" | null;
  hasSourceDefault: boolean;
  defaultRetained: boolean;
  compatibility: TableDataTransferCompatibility;
  reason: string;
}

export interface TableDataTransferTargetPlan {
  mappingProfile: string;
  columns: TableDataTransferTargetColumn[];
  statements: string[];
  canExecute: boolean;
  confirmationToken: string;
  warnings: string[];
}

export interface TableDataTransferResult {
  rowsTransferred: number;
  batches: number;
  limitReached: boolean;
  /** Reviewed target baseline used to verify append/overwrite results. */
  targetRowsBefore?: number | null;
  mappedColumns: TableDataTransferColumnMapping[];
  identityReseedColumns: string[];
  restoredSchemaObjects?: number;
  postCommitReceipt?: TableDataTransferPostCommitReceipt | null;
  /** Set when the terminal transfer report was stored successfully. */
  reportId?: string | null;
}

export type TableDataTransferProgressStatus =
  | "running"
  | "done"
  | "cancelled"
  | "error";

export type TableDataTransferVerificationStatus =
  | "verified"
  | "needsReview"
  | "notAvailable";

/** A read-only post-commit count observation; it never includes row values. */
export interface TableDataTransferVerification {
  status: TableDataTransferVerificationStatus;
  expectedRows?: number | null;
  observedRows?: number | null;
  identityReseedColumns?: string[];
  identityReseedVerified?: boolean | null;
  message: string;
}

export interface TableDataTransferProgress {
  transferId: string;
  rowsTransferred: number;
  maxRows: number;
  batches: number;
  status: TableDataTransferProgressStatus;
  terminal: boolean;
  message?: string | null;
}

/** No connection URL, credentials, SQL, parameters, or row values are stored. */
export interface TableDataTransferReport {
  id: string;
  projectId: string;
  transferId: string;
  source: TableDataTransferEndpoint;
  target: TableDataTransferEndpoint;
  mode: TableDataTransferMode;
  planDigest: string;
  maxRows: number;
  rowsTransferred: number;
  batches: number;
  limitReached: boolean;
  /** Missing for reports written before baseline auditing existed. */
  targetRowsBefore?: number | null;
  status: Exclude<TableDataTransferProgressStatus, "running">;
  startedAt: number;
  finishedAt: number;
  error?: string | null;
  /** Missing for reports written before post-commit verification existed. */
  verification?: TableDataTransferVerification | null;
  retryPolicy?: "freshPreview" | "manualReviewRequired";
  postCommitReceipt?: TableDataTransferPostCommitReceipt | null;
}
