import type {
  ColumnInfo,
  ConstraintInfo,
  FunctionParameterInfo,
  IndexInfo,
} from "./schemaCatalog";
import type { DatabaseDriver } from "./database";

export interface SchemaRelationSnapshot {
  name: string;
  objectType?: string | null;
  comment?: string | null;
  /**
   * Read-only SELECT source captured for native views. It is absent for
   * tables, older snapshots, and drivers without a safe catalog contract.
   */
  definition?: string | null;
  /** PostgreSQL materialized-view population state; unknown restores with no data. */
  materializedViewPopulated?: boolean | null;
  /** Direct same-schema view prerequisites used only to order reviewed DDL. */
  dependencies?: string[];
  /** Qualified PostgreSQL view dependencies outside the captured schema. */
  externalDependencies?: string[];
  /** PostgreSQL sequences referenced by catalog-captured column defaults. */
  sequenceDependencies?: string[];
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
}

/**
 * Review-gated routine metadata. Native PostgreSQL snapshots can include a
 * catalog-provided CREATE OR REPLACE definition; other drivers remain
 * descriptor-only.
 */
export interface SchemaRoutineSnapshot {
  name: string;
  routineType?: string | null;
  parameters: FunctionParameterInfo[];
  returnType: string;
  description?: string | null;
  definition?: string | null;
}

/**
 * Schema-object metadata. A native PostgreSQL trigger may include exact
 * catalog DDL; applying it still requires review approval.
 */
export interface SchemaObjectSnapshot {
  name: string;
  objectType: string;
  parentName?: string | null;
  description?: string | null;
  definition?: string | null;
  /** PostgreSQL sequence ownership, restored only after the owning relation exists. */
  sequenceOwner?: {
    tableName: string;
    columnName: string;
  } | null;
  /** Last readable PostgreSQL sequence value; absent when catalog access is restricted. */
  sequenceLastValue?: string | null;
  /** Whether nextval() has returned a value; absent in legacy/restricted snapshots. */
  sequenceIsCalled?: boolean | null;
  /** Native prerequisite names, currently PostgreSQL trigger callback routines. */
  dependencies?: string[];
}

export interface SchemaSnapshot {
  version: number;
  id: string;
  fingerprint: string;
  projectId: string;
  connectionId: string;
  connectionName: string;
  driver: DatabaseDriver;
  databaseName?: string | null;
  schemaName: string;
  capturedAt: number;
  relations: SchemaRelationSnapshot[];
  /** Absent on snapshots saved before routine signatures were introduced. */
  routines?: SchemaRoutineSnapshot[];
  /** Absent on snapshots captured before descriptor-only object coverage. */
  schemaObjects?: SchemaObjectSnapshot[];
  warnings: string[];
}

export type SchemaChangeRisk = "safe" | "review" | "destructive";

export type SchemaChangeKind =
  | "relationCreate"
  | "relationDrop"
  | "relationModify"
  | "columnAdd"
  | "columnDrop"
  | "columnModify"
  | "indexAdd"
  | "indexDrop"
  | "indexModify"
  | "constraintAdd"
  | "constraintDrop"
  | "constraintModify"
  | "routineCreate"
  | "routineDrop"
  | "routineModify"
  | "schemaObjectCreate"
  | "schemaObjectDrop"
  | "schemaObjectModify";

export type SchemaChangePhase =
  | "dropDependencies"
  | "dropRelations"
  | "createRelations"
  | "alterRelations"
  | "createDependencies"
  | "manualReview";

export interface SchemaChange {
  id: string;
  kind: SchemaChangeKind;
  risk: SchemaChangeRisk;
  schemaName: string;
  relationName: string;
  objectType?: string | null;
  childName?: string | null;
  summary: string;
  sql: string[];
  reversible: boolean;
  manualReview: boolean;
  phase: SchemaChangePhase;
  order: number;
  dependsOn: string[];
  blockedReason?: string | null;
}

export interface SchemaPreflightCheck {
  id: string;
  changeId: string;
  label: string;
  sql: string;
  expectation: string;
  assertion: "advisory" | "emptyRows" | "zeroValue";
  resultColumn?: string | null;
}

export interface SchemaDiffSummary {
  total: number;
  safe: number;
  review: number;
  destructive: number;
  blocked: number;
}

export type SchemaConversionCompatibility = "safe" | "review" | "unsupported";

export type SchemaConversionFeatureKind =
  | "type"
  | "array"
  | "default"
  | "index"
  | "customType"
  | "schema";

export interface SchemaConversionIssue {
  /** Missing on persisted plans created before conversion issues were categorized. */
  featureKind?: SchemaConversionFeatureKind;
  relationName: string;
  columnName: string;
  sourceDataType: string;
  targetDataType?: string | null;
  compatibility: SchemaConversionCompatibility;
  reason: string;
  /** Empty on persisted plans created before remediation guidance was added. */
  remediation?: string;
  /** True when target-owned input is required before executable DDL can exist. */
  blocksAutomaticConversion?: boolean;
}

export interface SchemaDiffPlan {
  id: string;
  sourceSnapshotId: string;
  targetSnapshotId: string;
  driver: DatabaseDriver;
  targetConnectionId: string;
  targetDatabaseName?: string | null;
  targetSchemaName: string;
  generatedAt: number;
  transactional: boolean;
  /** Host SQL, target-owned sidecar session, or an explicitly review-only plan. */
  executionOwner?: "hostSql" | "externalDriver" | "reviewOnly";
  requiresReviewApproval?: boolean;
  requiresDestructiveApproval?: boolean;
  summary: SchemaDiffSummary;
  changes: SchemaChange[];
  migrationSql: string;
  preflightChecks: SchemaPreflightCheck[];
  preflightSql: string;
  /** Missing only on persisted plans created before structured conversion review. */
  conversionIssues?: SchemaConversionIssue[];
  warnings: string[];
}

export type SchemaMigrationStatus =
  | "running"
  | "interrupted"
  | "blocked"
  | "failed"
  | "verificationFailed"
  | "succeeded";

export type SchemaMigrationPreflightStatus =
  | "passed"
  | "warning"
  | "blocked"
  | "error";

export interface SchemaMigrationPreflightResult {
  checkId: string;
  changeId: string;
  label: string;
  expectation: string;
  status: SchemaMigrationPreflightStatus;
  observed: string;
  blocksExecution: boolean;
  error?: string | null;
}

export interface SchemaRollbackArtifact {
  available: boolean;
  reason?: string | null;
  planId?: string | null;
  changeCount: number;
  requiresManualReview: boolean;
  sql?: string | null;
  backupPath?: string | null;
  backupByteLen?: number | null;
  backupIntegrityCheck?: string | null;
}

export interface SchemaMigrationVerification {
  matchesSource: boolean;
  targetFingerprintAfter: string;
  remainingPlanId: string;
  remainingSummary: SchemaDiffSummary;
  warnings: string[];
}

export interface SchemaMigrationJournalEntry {
  id: string;
  projectId: string;
  connectionId: string;
  connectionName: string;
  databaseName?: string | null;
  schemaName: string;
  planId: string;
  sourceFingerprint: string;
  targetFingerprintBefore: string;
  status: SchemaMigrationStatus;
  startedAt: number;
  finishedAt?: number | null;
  statementCount: number;
  committedStatements: number;
  preflightResults: SchemaMigrationPreflightResult[];
  rollback: SchemaRollbackArtifact;
  verification?: SchemaMigrationVerification | null;
  error?: string | null;
  warnings: string[];
}

export interface ExecuteSchemaMigrationRequest {
  source: SchemaSnapshot;
  expectedTarget: SchemaSnapshot;
  expectedPlanId: string;
  expectedTargetFingerprint: string;
  confirmationTarget: string;
  allowReview: boolean;
  allowDestructive: boolean;
  allowNonTransactional: boolean;
}
