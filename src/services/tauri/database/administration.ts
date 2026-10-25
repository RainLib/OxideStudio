import { invokeWithInterceptors } from "../client";
import type {
  CreateDatabaseAdminUserRequest,
  DatabaseAdminEventCatalog,
  DatabaseAdminEventMutation,
  DatabaseAdminEventPlan,
  DatabaseAdminLockWait,
  DatabaseAdminMetric,
  DatabaseAdminRoleMembership,
  DatabaseAdminServerIdentity,
  DatabaseAdminSession,
  DatabaseAdminTablePrivilege,
  DatabaseAdminUser,
  DatabaseDriver,
  DatabaseMaintenancePlan,
  DatabaseMaintenanceRequest,
  DeleteDatabaseAdminUserRequest,
  ExecuteDatabaseAdminEventMutation,
  ExecuteDatabaseMaintenanceRequest,
  ExecuteSqliteBackupPlanRequest,
  SaveSqliteBackupScheduleRequest,
  SetDatabaseAdminLoginRequest,
  SqliteBackupExecutionReceipt,
  SqliteBackupPlan,
  SqliteBackupPlanRequest,
  SqliteBackupRun,
  SqliteBackupRunTrigger,
  SqliteBackupSchedule,
  SqliteBackupWorkerStatus,
  SqliteBackupArtifactQuery,
  SqliteBackupArtifactPage,
  SqliteBackupDeletePreview,
  UpdateDatabaseAdminPasswordRequest,
} from "../types";

export async function listDatabaseAdminSessions(
  connectionId: string,
  driver: DatabaseDriver,
): Promise<DatabaseAdminSession[]> {
  return invokeWithInterceptors<DatabaseAdminSession[]>(
    "list_database_admin_sessions",
    { connectionId, driver },
  );
}

export async function getDatabaseAdminServerIdentity(
  connectionId: string,
  driver: DatabaseDriver,
): Promise<DatabaseAdminServerIdentity> {
  return invokeWithInterceptors<DatabaseAdminServerIdentity>(
    "get_database_admin_server_identity",
    { connectionId, driver },
  );
}

export async function previewDatabaseMaintenance(
  connectionId: string,
  driver: DatabaseDriver,
  request: DatabaseMaintenanceRequest,
): Promise<DatabaseMaintenancePlan> {
  return invokeWithInterceptors<DatabaseMaintenancePlan>(
    "preview_database_maintenance",
    { connectionId, driver, request },
  );
}

export async function executeDatabaseMaintenance(
  connectionId: string,
  driver: DatabaseDriver,
  request: ExecuteDatabaseMaintenanceRequest,
): Promise<string> {
  return invokeWithInterceptors<string>("execute_database_maintenance", {
    connectionId,
    driver,
    request,
  });
}

export async function listDatabaseAdminEvents(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
): Promise<DatabaseAdminEventCatalog> {
  return invokeWithInterceptors<DatabaseAdminEventCatalog>(
    "list_database_admin_events",
    { connectionId, driver, schema },
  );
}

export async function previewDatabaseAdminEventMutation(
  connectionId: string,
  driver: DatabaseDriver,
  mutation: DatabaseAdminEventMutation,
): Promise<DatabaseAdminEventPlan> {
  return invokeWithInterceptors<DatabaseAdminEventPlan>(
    "preview_database_admin_event_mutation",
    { connectionId, driver, mutation },
  );
}

export async function executeDatabaseAdminEventMutation(
  connectionId: string,
  driver: DatabaseDriver,
  request: ExecuteDatabaseAdminEventMutation,
): Promise<string> {
  return invokeWithInterceptors<string>(
    "execute_database_admin_event_mutation",
    { connectionId, driver, request },
  );
}

export async function previewSqliteBackupPlan(
  connectionId: string,
  request: SqliteBackupPlanRequest,
): Promise<SqliteBackupPlan> {
  return invokeWithInterceptors<SqliteBackupPlan>(
    "preview_sqlite_backup_plan",
    { connectionId, request },
  );
}

export async function executeSqliteBackupPlan(
  connectionId: string,
  request: ExecuteSqliteBackupPlanRequest,
): Promise<SqliteBackupExecutionReceipt> {
  return invokeWithInterceptors<SqliteBackupExecutionReceipt>(
    "execute_sqlite_backup_plan",
    { connectionId, request },
  );
}

export async function listSqliteBackupSchedules(): Promise<
  SqliteBackupSchedule[]
> {
  return invokeWithInterceptors<SqliteBackupSchedule[]>(
    "list_sqlite_backup_schedules",
  );
}

export async function getSqliteBackupWorkerStatus(): Promise<SqliteBackupWorkerStatus> {
  return invokeWithInterceptors<SqliteBackupWorkerStatus>("get_sqlite_backup_worker_status");
}

export async function listSqliteBackupArtifacts(request: SqliteBackupArtifactQuery): Promise<SqliteBackupArtifactPage> {
  return invokeWithInterceptors<SqliteBackupArtifactPage>("list_sqlite_backup_artifacts", { request });
}

export async function setSqliteBackupBackgroundEnabled(enabled: boolean): Promise<SqliteBackupWorkerStatus> {
  return invokeWithInterceptors<SqliteBackupWorkerStatus>("set_sqlite_backup_background_enabled", { enabled });
}

export async function saveSqliteBackupSchedule(
  request: SaveSqliteBackupScheduleRequest,
): Promise<SqliteBackupSchedule> {
  return invokeWithInterceptors<SqliteBackupSchedule>(
    "save_sqlite_backup_schedule",
    { request },
  );
}

export async function deleteSqliteBackupSchedule(id: string): Promise<boolean> {
  return invokeWithInterceptors<boolean>("delete_sqlite_backup_schedule", {
    request: { id },
  });
}

export async function listSqliteBackupRuns(): Promise<SqliteBackupRun[]> {
  return invokeWithInterceptors<SqliteBackupRun[]>("list_sqlite_backup_runs");
}

export async function runSqliteBackupSchedule(
  scheduleId: string,
  trigger: SqliteBackupRunTrigger = "manual",
): Promise<SqliteBackupRun> {
  return invokeWithInterceptors<SqliteBackupRun>("run_sqlite_backup_schedule", {
    request: { scheduleId, trigger },
  });
}

export async function runDueSqliteBackupSchedules(): Promise<
  SqliteBackupRun[]
> {
  return invokeWithInterceptors<SqliteBackupRun[]>(
    "run_due_sqlite_backup_schedules",
  );
}

export async function cancelSqliteBackupRun(id: string): Promise<boolean> {
  return invokeWithInterceptors<boolean>("cancel_sqlite_backup_run", {
    request: { id },
  });
}

export async function previewSqliteBackupFileDelete(id: string): Promise<SqliteBackupDeletePreview> {
  return invokeWithInterceptors<SqliteBackupDeletePreview>("preview_sqlite_backup_file_delete", { request: { id } });
}

export async function deleteSqliteBackupRun(id: string, confirmationToken?: string): Promise<boolean> {
  return invokeWithInterceptors<boolean>("delete_sqlite_backup_run", {
    request: { id, confirmationToken },
  });
}

export async function listDatabaseAdminMetrics(
  connectionId: string,
  driver: DatabaseDriver,
): Promise<DatabaseAdminMetric[]> {
  return invokeWithInterceptors<DatabaseAdminMetric[]>(
    "list_database_admin_metrics",
    { connectionId, driver },
  );
}

export async function listDatabaseAdminLockWaits(
  connectionId: string,
  driver: DatabaseDriver,
): Promise<DatabaseAdminLockWait[]> {
  return invokeWithInterceptors<DatabaseAdminLockWait[]>(
    "list_database_admin_lock_waits",
    { connectionId, driver },
  );
}

export async function terminateDatabaseAdminSession(
  connectionId: string,
  driver: DatabaseDriver,
  sessionId: string,
  confirmed: boolean,
): Promise<string> {
  return invokeWithInterceptors<string>("terminate_database_admin_session", {
    connectionId,
    driver,
    sessionId,
    confirmed,
  });
}

export async function listDatabaseAdminUsers(
  connectionId: string,
  driver: DatabaseDriver,
): Promise<DatabaseAdminUser[]> {
  return invokeWithInterceptors<DatabaseAdminUser[]>(
    "list_database_admin_users",
    { connectionId, driver },
  );
}

export async function listDatabaseAdminRoleMemberships(
  connectionId: string,
  driver: DatabaseDriver,
): Promise<DatabaseAdminRoleMembership[]> {
  return invokeWithInterceptors<DatabaseAdminRoleMembership[]>(
    "list_database_admin_role_memberships",
    { connectionId, driver },
  );
}

export async function listDatabaseAdminTablePrivileges(
  connectionId: string,
  driver: DatabaseDriver,
): Promise<DatabaseAdminTablePrivilege[]> {
  return invokeWithInterceptors<DatabaseAdminTablePrivilege[]>(
    "list_database_admin_table_privileges",
    { connectionId, driver },
  );
}

export async function createDatabaseAdminUser(
  connectionId: string,
  driver: DatabaseDriver,
  request: CreateDatabaseAdminUserRequest,
): Promise<string> {
  return invokeWithInterceptors<string>("create_database_admin_user", {
    connectionId,
    driver,
    request,
  });
}

export async function updateDatabaseAdminUserPassword(
  connectionId: string,
  driver: DatabaseDriver,
  request: UpdateDatabaseAdminPasswordRequest,
): Promise<string> {
  return invokeWithInterceptors<string>(
    "update_database_admin_user_password",
    { connectionId, driver, request },
  );
}

export async function setDatabaseAdminUserLogin(
  connectionId: string,
  driver: DatabaseDriver,
  request: SetDatabaseAdminLoginRequest,
): Promise<string> {
  return invokeWithInterceptors<string>("set_database_admin_user_login", {
    connectionId,
    driver,
    request,
  });
}

export async function deleteDatabaseAdminUser(
  connectionId: string,
  driver: DatabaseDriver,
  request: DeleteDatabaseAdminUserRequest,
): Promise<string> {
  return invokeWithInterceptors<string>("delete_database_admin_user", {
    connectionId,
    driver,
    request,
  });
}

export async function createDatabase(
  connectionId: string,
  driver: DatabaseDriver,
  database: string,
  charset?: string,
  collation?: string,
  owner?: string,
): Promise<string> {
  return invokeWithInterceptors<string>("create_database", {
    connectionId,
    driver,
    database,
    charset,
    collation,
    owner,
  });
}

export async function dropDatabase(
  connectionId: string,
  driver: DatabaseDriver,
  database: string,
  cascade = false,
): Promise<string> {
  return invokeWithInterceptors<string>("drop_database", {
    connectionId,
    driver,
    database,
    cascade,
  });
}

export async function renameDatabase(
  connectionId: string,
  driver: DatabaseDriver,
  oldName: string,
  newName: string,
): Promise<string> {
  return invokeWithInterceptors<string>("rename_database", {
    connectionId,
    driver,
    oldName,
    newName,
  });
}
