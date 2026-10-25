export type SqliteBackupOperation = "backup" | "restore";

export interface SqliteBackupPlanRequest {
  operation: SqliteBackupOperation;
  path: string;
}

export interface SqliteBackupPlan {
  operation: SqliteBackupOperation;
  path: string;
  fileName: string;
  summary: string;
  risk: "low" | "medium" | "high";
  destinationExists: boolean;
  byteLen?: number | null;
  sourceSha256?: string | null;
  createsRecoveryPoint: boolean;
  confirmationText: string;
  confirmationToken: string;
  connectedDriver: "sqlite";
  serverVersion?: string | null;
}

export interface ExecuteSqliteBackupPlanRequest {
  plan: SqliteBackupPlanRequest;
  confirmationToken: string;
  confirmationText: string;
}

export interface SqliteBackupExecutionReceipt {
  operation: SqliteBackupOperation;
  path: string;
  byteLen: number;
  integrityCheck: string;
  recoveryPath?: string | null;
  message: string;
}

export type SqliteBackupScheduleFrequency = "hourly" | "daily" | "weekly";

export type SqliteBackupCompression = "none" | "gzip";

export type SqliteBackupRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "interrupted";

export type SqliteBackupRunTrigger = "manual" | "scheduled";

export interface SaveSqliteBackupScheduleRequest {
  id?: string;
  name: string;
  projectId: string;
  connectionId: string;
  destinationDirectory: string;
  frequency: SqliteBackupScheduleFrequency;
  intervalHours: number;
  timeOfDay: string;
  /** IANA zone; "system" follows the machine. Omission preserves an existing zone. */
  timeZone?: string;
  /** Sunday = 0 through Saturday = 6. */
  weekday: number;
  retentionCount: number;
  /** Missing values from older renderer builds are treated as uncompressed. */
  compression?: SqliteBackupCompression;
  enabled: boolean;
}

export interface SqliteBackupSchedule {
  id: string;
  name: string;
  projectId: string;
  connectionId: string;
  destinationDirectory: string;
  frequency: SqliteBackupScheduleFrequency;
  intervalHours: number;
  timeOfDay: string;
  /** Missing legacy value follows the machine's current time zone. */
  timeZone?: string | null;
  schedulingError?: string | null;
  weekday: number;
  retentionCount: number;
  compression: SqliteBackupCompression;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  lastRunAt?: string | null;
  lastRunStatus?: SqliteBackupRunStatus | null;
}

export interface SqliteBackupRun {
  id: string;
  scheduleId: string;
  scheduleName: string;
  projectId: string;
  connectionId: string;
  destinationDirectory: string;
  compression: SqliteBackupCompression;
  trigger: SqliteBackupRunTrigger;
  status: SqliteBackupRunStatus;
  startedAt: string;
  completedAt?: string | null;
  filePath?: string | null;
  byteLen?: number | null;
  integrityCheck?: string | null;
  progressPercent: number;
  error?: string | null;
  cancelRequested?: boolean;
}

export interface SqliteBackupWorkerStatus {
  backgroundEnabled: boolean;
  running: boolean;
  upgrading?: boolean;
  message?: string | null;
}

export interface SqliteBackupArtifactQuery {
  projectId?: string;
  scheduleId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface SqliteBackupArtifactPage {
  items: SqliteBackupRun[];
  nextCursor: string | null;
}

export interface SqliteBackupDeletePreview {
  id: string;
  filePath: string | null;
  byteLen: number | null;
  reviewRequired: boolean;
  confirmationToken: string | null;
}
