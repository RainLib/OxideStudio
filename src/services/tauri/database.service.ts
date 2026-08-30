import { invokeWithInterceptors } from "./client";
import type {
  DatabaseCapabilities,
  DatabaseDriverActivationState,
  DatabaseAdminServerIdentity,
  DatabaseMaintenancePlan,
  DatabaseMaintenanceRequest,
  ExecuteDatabaseMaintenanceRequest,
  ExecuteSqliteBackupPlanRequest,
  SqliteBackupExecutionReceipt,
  SqliteBackupPlan,
  SqliteBackupPlanRequest,
  DatabaseAdminSession,
  DatabaseAdminMetric,
  DatabaseAdminLockWait,
  DatabaseAdminUser,
  DatabaseAdminRoleMembership,
  DatabaseAdminTablePrivilege,
  DatabaseAdminEventCatalog,
  DatabaseAdminEventMutation,
  DatabaseAdminEventPlan,
  ExecuteDatabaseAdminEventMutation,
  CreateDatabaseAdminUserRequest,
  ConnectionDatabaseCapabilityContext,
  DeleteDatabaseAdminUserRequest,
  DatabaseDriver,
  DatabaseDriverInstallation,
  DatabaseDriverRuntimeSummary,
  DatabaseDriverCachePruneResult,
  DatabaseDriverStoreInfo,
  DatabaseDriverCatalog,
  DatabaseDriverProbeResult,
  ManagedJavaRuntimeInstallation,
  SetDatabaseAdminLoginRequest,
  UpdateDatabaseAdminPasswordRequest,
} from "./types";
import {
  registerDatabaseCapabilities,
  registerRuntimeDatabaseCatalog,
} from "@/lib/databaseDialect";

const capabilitiesCache = new Map<string, Promise<DatabaseCapabilities>>();
let capabilityListCache: Promise<DatabaseCapabilities[]> | null = null;

function capabilityCacheDriverKey(driver: DatabaseDriver | string) {
  return String(driver).trim().toLowerCase();
}

/**
 * Activation changes the meaning of the unpinned `active` capability lookup.
 * Keep version-pinned entries intact, but make every new/default connection
 * resolve the newly activated sidecar contract immediately.
 */
function invalidateActiveDatabaseCapabilities(driver: DatabaseDriver | string) {
  capabilitiesCache.delete(`${capabilityCacheDriverKey(driver)}:active`);
  capabilityListCache = null;
}

function cloneCapabilities(
  capabilities: DatabaseCapabilities,
): DatabaseCapabilities {
  return {
    ...capabilities,
    commonDataTypes: [...capabilities.commonDataTypes],
  };
}

export async function getDatabaseCapabilities(
  driver: DatabaseDriver,
  packageVersion?: string,
): Promise<DatabaseCapabilities> {
  const normalizedPackageVersion = packageVersion?.trim() || undefined;
  const cacheKey = `${capabilityCacheDriverKey(driver)}:${normalizedPackageVersion || "active"}`;
  let cached = capabilitiesCache.get(cacheKey);
  if (!cached) {
    cached = invokeWithInterceptors<DatabaseCapabilities>(
      "get_database_capabilities",
      {
        driver,
        ...(normalizedPackageVersion
          ? { packageVersion: normalizedPackageVersion }
          : {}),
      },
    ).catch((error) => {
      capabilitiesCache.delete(cacheKey);
      throw error;
    });
    capabilitiesCache.set(cacheKey, cached);
  }

  const capabilities = cloneCapabilities(await cached);
  // Runtime catalog is the active package inventory shared by new
  // connections. A connection-pinned package is deliberately local to its
  // caller; publishing it here would leak one connection's older/newer
  // capability contract into every other tab using the same driver id.
  if (!normalizedPackageVersion) {
    registerDatabaseCapabilities(capabilities);
  }
  return capabilities;
}

/**
 * Resolve capabilities from the concrete live connection rather than the
 * active product catalogue. This is intentionally not cached: reconnecting
 * may change the pinned package or negotiated server version while retaining
 * the same connection id.
 */
export async function getConnectionDatabaseCapabilityContext(
  connectionId: string,
): Promise<ConnectionDatabaseCapabilityContext> {
  const context =
    await invokeWithInterceptors<ConnectionDatabaseCapabilityContext>(
      "get_connection_database_capability_context",
      { connectionId },
    );
  return {
    ...context,
    capabilities: cloneCapabilities(context.capabilities),
  };
}

export async function listDatabaseCapabilities(): Promise<
  DatabaseCapabilities[]
> {
  if (!capabilityListCache) {
    capabilityListCache = invokeWithInterceptors<DatabaseCapabilities[]>(
      "list_database_capabilities",
    ).catch((error) => {
      capabilityListCache = null;
      throw error;
    });
  }

  const capabilities = (await capabilityListCache).map(cloneCapabilities);
  if (capabilities.length > 0) {
    registerRuntimeDatabaseCatalog(capabilities);
  }
  return capabilities;
}

export async function listDatabaseDriverInstallations(): Promise<
  DatabaseDriverInstallation[]
> {
  return invokeWithInterceptors<DatabaseDriverInstallation[]>(
    "list_database_driver_installations",
  );
}

export async function listExternalDatabaseDriverRuntimes(): Promise<
  DatabaseDriverRuntimeSummary[]
> {
  return invokeWithInterceptors<DatabaseDriverRuntimeSummary[]>(
    "list_external_database_driver_runtimes",
  );
}

export async function getDatabaseDriverStoreInfo(): Promise<DatabaseDriverStoreInfo> {
  return invokeWithInterceptors<DatabaseDriverStoreInfo>(
    "get_database_driver_store_info",
  );
}

export async function pruneDatabaseDriverCache(): Promise<DatabaseDriverCachePruneResult> {
  return invokeWithInterceptors<DatabaseDriverCachePruneResult>(
    "prune_database_driver_cache",
  );
}

export async function migrateDatabaseDriverStore(
  destinationPath: string,
): Promise<DatabaseDriverStoreInfo> {
  return invokeWithInterceptors<DatabaseDriverStoreInfo>(
    "migrate_database_driver_store",
    { destinationPath },
  );
}

export async function listManagedJavaRuntimes(): Promise<
  ManagedJavaRuntimeInstallation[]
> {
  return invokeWithInterceptors<ManagedJavaRuntimeInstallation[]>(
    "list_managed_java_runtimes",
  );
}

export async function installManagedJavaRuntime(
  runtimeDirectory: string,
  activate = true,
): Promise<ManagedJavaRuntimeInstallation> {
  return invokeWithInterceptors<ManagedJavaRuntimeInstallation>(
    "install_managed_java_runtime",
    { runtimeDirectory, activate },
  );
}

export async function getExternalDatabaseDriverCatalog(
  catalogUrl: string,
): Promise<DatabaseDriverCatalog> {
  return invokeWithInterceptors<DatabaseDriverCatalog>(
    "get_external_database_driver_catalog",
    { catalogUrl },
  );
}

export async function probeExternalDatabaseDriver(
  driver: string,
): Promise<DatabaseDriverProbeResult> {
  return invokeWithInterceptors<DatabaseDriverProbeResult>(
    "probe_external_database_driver",
    { driver },
  );
}

export async function installExternalDatabaseDriver(
  packageDirectory: string,
  activate = true,
): Promise<DatabaseDriverInstallation> {
  const installation = await invokeWithInterceptors<DatabaseDriverInstallation>(
    "install_external_database_driver",
    { packageDirectory, activate },
  );
  if (activate) invalidateActiveDatabaseCapabilities(installation.driver);
  return installation;
}

export async function installExternalDatabaseDriverFromCatalog(
  catalogUrl: string,
  driver: string,
  packageVersion: string,
  activate = true,
): Promise<DatabaseDriverInstallation> {
  const installation = await invokeWithInterceptors<DatabaseDriverInstallation>(
    "install_external_database_driver_from_catalog",
    { catalogUrl, driver, packageVersion, activate },
  );
  if (activate) invalidateActiveDatabaseCapabilities(installation.driver);
  return installation;
}

export async function activateExternalDatabaseDriver(
  driver: string,
  packageVersion: string,
): Promise<DatabaseDriverActivationState> {
  const activation = await invokeWithInterceptors<DatabaseDriverActivationState>(
    "activate_external_database_driver",
    { driver, packageVersion },
  );
  invalidateActiveDatabaseCapabilities(driver);
  return activation;
}

export async function rollbackExternalDatabaseDriver(
  driver: string,
): Promise<DatabaseDriverActivationState> {
  const activation = await invokeWithInterceptors<DatabaseDriverActivationState>(
    "rollback_external_database_driver",
    { driver },
  );
  invalidateActiveDatabaseCapabilities(driver);
  return activation;
}

export function resetDatabaseCapabilityCachesForTests() {
  capabilitiesCache.clear();
  capabilityListCache = null;
}

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

export const databaseService = {
  getDatabaseCapabilities,
  getConnectionDatabaseCapabilityContext,
  listDatabaseCapabilities,
  listDatabaseDriverInstallations,
  listExternalDatabaseDriverRuntimes,
  getDatabaseDriverStoreInfo,
  pruneDatabaseDriverCache,
  migrateDatabaseDriverStore,
  listManagedJavaRuntimes,
  getExternalDatabaseDriverCatalog,
  probeExternalDatabaseDriver,
  installExternalDatabaseDriver,
  installExternalDatabaseDriverFromCatalog,
  installManagedJavaRuntime,
  activateExternalDatabaseDriver,
  rollbackExternalDatabaseDriver,
  getDatabaseAdminServerIdentity,
  previewDatabaseMaintenance,
  executeDatabaseMaintenance,
  listDatabaseAdminEvents,
  previewDatabaseAdminEventMutation,
  executeDatabaseAdminEventMutation,
  previewSqliteBackupPlan,
  executeSqliteBackupPlan,
  listDatabaseAdminSessions,
  listDatabaseAdminMetrics,
  listDatabaseAdminLockWaits,
  terminateDatabaseAdminSession,
  listDatabaseAdminUsers,
  listDatabaseAdminRoleMemberships,
  listDatabaseAdminTablePrivileges,
  createDatabaseAdminUser,
  updateDatabaseAdminUserPassword,
  setDatabaseAdminUserLogin,
  deleteDatabaseAdminUser,
  createDatabase,
  dropDatabase,
  renameDatabase,
};
