import { invokeWithInterceptors } from "../client";
import type {
  ConnectionDatabaseCapabilityContext,
  DatabaseCapabilities,
  DatabaseDriver,
  DatabaseDriverActivationState,
  DatabaseDriverCachePruneResult,
  DatabaseDriverCatalog,
  DatabaseDriverInstallation,
  DatabaseDriverProbeResult,
  DatabaseDriverRuntimeReconnectResult,
  DatabaseDriverRuntimeSummary,
  DatabaseDriverStoreInfo,
  ManagedJavaRuntimeInstallation,
} from "../types";
import {
  registerDatabaseCapabilities,
  registerRuntimeDatabaseCatalog,
} from "@/lib/databaseDialect";

const capabilitiesCache = new Map<string, Promise<DatabaseCapabilities>>();
let capabilityListCache: Promise<DatabaseCapabilities[]> | null = null;

function capabilityCacheDriverKey(driver: DatabaseDriver | string) {
  return String(driver).trim().toLowerCase();
}

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

export async function reconnectExternalDatabaseDriverRuntimes(
  driver: string,
  packageVersion: string,
): Promise<DatabaseDriverRuntimeReconnectResult> {
  return invokeWithInterceptors<DatabaseDriverRuntimeReconnectResult>(
    "reconnect_external_database_driver_runtimes",
    { driver, packageVersion },
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
