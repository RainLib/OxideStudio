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
}
