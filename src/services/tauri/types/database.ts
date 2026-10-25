import type { TableExportFormat } from "./tableExport";

/**
 * 数据库驱动类型
 */
export type KnownDatabaseDriver =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "redis"
  | "etcd"
  | "consul"
  | "nacos"
  | "elasticsearch"
  | "mongodb"
  | "influxdb"
  | "influxdb3"
  | "victoriametrics"
  | "meilisearch";

export type DatabaseDriver = KnownDatabaseDriver | (string & {});

export type DatabaseDataModel =
  | "relational"
  | "document"
  | "keyValue"
  | "search"
  | "graph"
  | "wideColumn"
  | "timeSeries"
  | "coordination"
  | "queue";

export type DatabaseConnectionMode = "network" | "file";

export type DatabaseTableExportFormat =
  | "csv"
  | "json"
  | "jsonl"
  | "markdown"
  | "sql"
  | "tsv"
  | "xlsx"
  | "parquet"
  | "arrow";

export interface DatabaseInfo {
  name: string;
  sizeBytes?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  comment?: string | null;
  defaultCharset?: string | null;
  defaultCollation?: string | null;
}

export interface DatabaseCapabilities {
  driver: DatabaseDriver;
  displayName: string;
  dataModel: DatabaseDataModel;
  connectionMode?: DatabaseConnectionMode;
  lspLanguageId: string;
  /**
   * Optional concrete parser baseline for a generic `sql` editor document.
   * This is supplied only by a signed driver capability contract.
   */
  lspServerDialect?: string | null;
  namespaceLabel: string;
  identifierQuote: string;
  defaultPort: number;
  supportsSqlQuery: boolean;
  supportsTableBrowsing: boolean;
  /** Effective Host encoders enabled for this driver and application build. */
  tableExportFormats?: DatabaseTableExportFormat[];
  fileQueryFormats?: Array<"csv" | "json" | "jsonl" | "parquet">;
  supportsTableRowMutation: boolean;
  /** Cross-connection table transfer is separately verified from Grid editing. */
  supportsTableDataTransfer?: boolean;
  supportsTableDdl: boolean;
  /** The bounded Table Editor implements ALTER COLUMN for this driver. */
  supportsColumnAlteration?: boolean;
  /** The bounded Table Editor can rename an existing index for this driver. */
  supportsIndexRename?: boolean;
  /** The bounded Table Editor can alter existing constraints for this driver. */
  supportsConstraintAlteration?: boolean;
  supportsCollectionBrowsing: boolean;
  supportsKeyValueBrowsing: boolean;
  supportsSchemas: boolean;
  /** The connection can expose more than one database/catalog in Explorer. */
  supportsDatabaseCatalogs?: boolean;
  /** Whether this connection's URL and form accept a database/catalog segment. */
  supportsConnectionDatabase?: boolean;
  supportsCreateDatabase: boolean;
  /** Creation can optionally set an owner / authorization principal. */
  supportsCreateDatabaseOwner?: boolean;
  supportsCreateDatabaseCharset: boolean;
  /** Creation can optionally set an explicit collation. */
  supportsCreateDatabaseCollation?: boolean;
  supportsColumnComments: boolean;
  supportsInlineColumnComments: boolean;
  supportsRenameDatabase: boolean;
  supportsViews: boolean;
  supportsReplaceView: boolean;
  supportsMaterializedViews: boolean;
  supportsTableIndexes: boolean;
  supportsTableConstraints: boolean;
  supportsForeignKeys: boolean;
  supportsCheckConstraints: boolean;
  supportsFunctions: boolean;
  supportsTransactions: boolean;
  supportsQueryCancellation: boolean;
  supportsExplainPlan: boolean;
  autoIncrementKeyword?: string | null;
  defaultPrimaryKeyType: string;
  commonDataTypes: string[];
}

export type SchemaMigrationCapabilityMode =
  | "transactional"
  | "nonTransactional"
  | "reviewOnly";

/**
 * Exact capability snapshot for one connected driver instance. This keeps the
 * package contract and negotiated server version together so editor and
 * migration consumers do not combine values from different reconnects.
 */
export interface ConnectionDatabaseCapabilityContext {
  connectionId: string;
  driver: DatabaseDriver;
  distribution: "bundled" | "external" | "managed";
  packageVersion?: string | null;
  serverVersion?: string | null;
  schemaMigrationMode: SchemaMigrationCapabilityMode;
  capabilities: DatabaseCapabilities;
}

export interface DatabaseDriverInstallation {
  driver: string;
  displayName: string;
  clientLibrary: string;
  clientVersion: string;
  distribution: "bundled" | "external";
  updatePolicy: "application-update" | "independent";
  independentlyUpdatable: boolean;
  serverVersionPolicy: "detected-at-connection" | string;
  implementation: string;
  /** Package runtime shown by Driver Manager, for example Native or managed Java 21. */
  runtime?: string;
  /** JDBC packages are launchable only when their managed Java runtime is active and verified. */
  runtimeReady?: boolean | null;
  packageVersion?: string | null;
  protocolVersion?: string | null;
  active?: boolean;
  canRollback?: boolean;
  status?: "ready" | "incompatible" | "untrusted" | "invalid";
  statusMessage?: string | null;
  /** Signed package template for JDBC/vendor-specific connection URLs. */
  connectionUrlTemplate?: string | null;
  capabilities?: DatabaseCapabilities | null;
}

export interface DatabaseDriverActivationState {
  current: string;
  previous?: string | null;
}

export interface DatabaseDriverStoreInfo {
  activePath: string;
  /** True after a migration: the copied store becomes active on restart. */
  restartRequired: boolean;
}

export interface DatabaseDriverCachePruneResult {
  filesRemoved: number;
  partialFilesRemoved: number;
  bytesRemoved: number;
  versionsRemoved: number;
  retainedVersions: number;
  skippedEntries: number;
}

/**
 * Aggregated, connection-owned external driver processes. Intentionally does
 * not include connection names, URLs, credentials, query text, or stderr.
 */
export interface DatabaseDriverRuntimeSummary {
  driver: string;
  packageVersion: string;
  connectionCount: number;
  processIds: number[];
  /** Connected entries whose sidecar PID is no longer observable. */
  unavailableProcessCount: number;
  /** Registered external connections whose owned sidecar has exited. */
  unhealthyConnectionCount: number;
  /** Launches observed since this desktop process started. */
  launchCount: number;
  /** Distinct connected sidecars observed exited since this desktop process started. */
  observedExitCount: number;
  lastStartedAtMillis?: number | null;
  lastExitObservedAtMillis?: number | null;
  reconnectAttemptCount: number;
  reconnectSuccessCount: number;
  reconnectFailureCount: number;
  reconnectBudgetBlockCount: number;
  reconnectAvailable: boolean;
  reconnectBlockedConnectionCount: number;
  /** Stable host event code only; never raw sidecar output. */
  lastEventCode?:
    | "launched"
    | "exited"
    | "reconnect-attempted"
    | "reconnect-succeeded"
    | "reconnect-failed"
    | "reconnect-budget-blocked"
    | null;
  lastEventAtMillis?: number | null;
  lastReconnectAtMillis?: number | null;
}

export interface DatabaseDriverRuntimeReconnectResult {
  driver: string;
  packageVersion: string;
  reason: "process-exited";
  matchedConnectionCount: number;
  attemptedCount: number;
  reconnectedCount: number;
  failedCount: number;
  budgetBlockedCount: number;
}

export interface ManagedJavaRuntimeInstallation {
  javaMajor: number;
  runtimeVersion: string;
  target: string;
  active: boolean;
  status: "ready" | "incompatible" | "untrusted" | "invalid";
  statusMessage?: string | null;
}

export interface DatabaseDriverProbeResult {
  driver: string;
  packageVersion: string;
  protocolVersion: string;
  supportsMetadata: boolean;
  supportsQuery: boolean;
  supportsCancellation: boolean;
  supportsTransactions: boolean;
  supportsDatabaseScopedQueries: boolean;
  supportsDatabaseCreation: boolean;
  /** Effective Grid editing after manifest + sidecar transaction verification. */
  supportsTableRowMutation: boolean;
  /** Effective cross-connection table transfer after package/runtime verification. */
  supportsTableDataTransfer: boolean;
  /** Effective formats after the signed declaration is intersected with this build. */
  tableExportFormats: TableExportFormat[];
  /** Required before Agent queries can be delegated to an external sidecar. */
  supportsAgentReadOnlyEnforcement: boolean;
  supportsReferencingForeignKeys: boolean;
  /** Effective only after signed manifest + runtime handshake verification. */
  supportsSemanticSchemaMigration: boolean;
}

export interface DriverPackageSchemaMigrationContract {
  snapshotVersion: 1;
  mode: "transactional" | "nonTransactional";
}

export interface DatabaseDriverCatalogEntry {
  driverId: string;
  displayName: string;
  packageVersion: string;
  protocolVersion: string;
  downloadUrl: string;
  /** Enables verified in-app installation only when the signed catalog binds this archive digest. */
  archiveSha256?: string | null;
  supportedTargets: string[];
  serverVersionRange?: string | null;
  releaseNotesUrl?: string | null;
  /** Signed discovery metadata; package import remains required to execute. */
  capabilities?: DatabaseCapabilities | null;
  /** Discovery copy; the package manifest must match before installation. */
  schemaMigration?: DriverPackageSchemaMigrationContract | null;
  /** Signed release coverage only; it does not grant execution permission. */
  conformance?: DatabaseDriverConformance | null;
  /** Immutable, license-declared Java artifacts bound to the package classpath. */
  dependencies?: DatabaseDriverCatalogDependency[];
}

export interface DatabaseDriverCatalogDependency {
  coordinate: string;
  path: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  licenseSpdx: string;
  licenseUrl: string;
}

export interface DatabaseDriverConformance {
  connect: string[];
  metadata: string[];
  query: string[];
  cancellation: string[];
  mutations: string[];
  migration: string[];
  /** Versions that passed source paging, type mapping, and partial-commit transfer fixtures. */
  dataTransfer?: string[];
  /** Hash-bound reports from the official conformance runner. */
  evidence?: DatabaseDriverConformanceEvidence[];
}

export interface DatabaseDriverConformanceEvidence {
  schemaVersion: number;
  runnerVersion: string;
  driverId: string;
  packageVersion: string;
  entrypointSha256: string;
  target: string;
  serverVersion: string;
  fixtureId: string;
  fixtureSha256: string;
  reportUrl: string;
  reportSha256: string;
  operations: Array<
    | "connect"
    | "metadata"
    | "query"
    | "cancellation"
    | "mutations"
    | "migration"
    | "dataTransfer"
  >;
}

export interface DatabaseDriverCatalog {
  catalog: {
    schemaVersion: number;
    generatedAt?: string | null;
    packages: DatabaseDriverCatalogEntry[];
  };
  sourceUrl: string;
}
