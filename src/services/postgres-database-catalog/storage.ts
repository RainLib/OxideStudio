import { storeService, type Resource } from "@/services/tauri/store.service";
import type {
  PostgresDatabaseCatalogIdentity,
  PostgresDatabaseCatalogSnapshot,
  ResolvedPostgresDatabaseCatalogIdentity,
  StoredPostgresDatabaseCatalog,
} from "./contracts";
import {
  POSTGRES_DATABASE_CATALOG_CACHE_KIND,
  POSTGRES_DATABASE_CATALOG_CACHE_VERSION,
} from "./contracts";
import {
  normalizePostgresDatabaseCatalog,
  postgresDatabaseCatalogKey,
  postgresDatabaseCatalogParentId,
  postgresDatabaseCatalogResourceId,
  resolvePostgresDatabaseCatalogIdentity,
} from "./identity";
import {
  assertPostgresDatabaseCatalogGeneration,
  capturePostgresDatabaseCatalogGeneration,
  queuePostgresDatabaseCatalogOperation,
} from "./runtime";

function parseCatalogResource(
  resource: Resource | undefined,
  identity: ResolvedPostgresDatabaseCatalogIdentity,
): StoredPostgresDatabaseCatalog | null {
  if (
    !resource ||
    resource.id !== postgresDatabaseCatalogResourceId(identity) ||
    resource.kind !== POSTGRES_DATABASE_CATALOG_CACHE_KIND ||
    resource.connection_id !== identity.connectionId ||
    resource.project_id !== identity.projectId
  ) {
    return null;
  }
  const metadata = resource.metadata as Partial<StoredPostgresDatabaseCatalog> | undefined;
  if (
    metadata?.version !== POSTGRES_DATABASE_CATALOG_CACHE_VERSION ||
    metadata.driver !== identity.driver ||
    (metadata.driverPackageVersion || null) !== identity.driverPackageVersion ||
    (metadata.connectionDatabaseName || null) !==
      identity.connectionDatabaseName ||
    metadata.connectionId !== identity.connectionId ||
    !Array.isArray(metadata.databases) ||
    metadata.databases.some((database) => typeof database !== "string")
  ) {
    return null;
  }
  return {
    version: POSTGRES_DATABASE_CATALOG_CACHE_VERSION,
    driver: identity.driver,
    driverPackageVersion: identity.driverPackageVersion,
    connectionDatabaseName: identity.connectionDatabaseName,
    connectionId: identity.connectionId,
    databases: normalizePostgresDatabaseCatalog(metadata.databases),
  };
}

export async function readCachedPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
): Promise<PostgresDatabaseCatalogSnapshot | null> {
  const resolvedIdentity = resolvePostgresDatabaseCatalogIdentity(identity);
  try {
    const resources = await storeService.getResources(
      resolvedIdentity.connectionId,
      postgresDatabaseCatalogParentId(resolvedIdentity),
      resolvedIdentity.projectId,
    );
    const resource = resources.find(
      (item) => item.kind === POSTGRES_DATABASE_CATALOG_CACHE_KIND,
    );
    const catalog = parseCatalogResource(resource, resolvedIdentity);
    return catalog
      ? {
          databases: catalog.databases,
          source: "cache",
          updatedAt: resource?.last_updated || 0,
        }
      : null;
  } catch {
    // Metadata cache availability must never prevent live introspection.
    return null;
  }
}

export async function persistPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
  databases: readonly string[],
  expectedGeneration = capturePostgresDatabaseCatalogGeneration(
    postgresDatabaseCatalogKey(identity),
  ),
): Promise<void> {
  const resolvedIdentity = resolvePostgresDatabaseCatalogIdentity(identity);
  const normalizedDatabases = normalizePostgresDatabaseCatalog(databases);
  const parentId = postgresDatabaseCatalogParentId(resolvedIdentity);
  const key = postgresDatabaseCatalogKey(resolvedIdentity);
  await queuePostgresDatabaseCatalogOperation(key, async () => {
    assertPostgresDatabaseCatalogGeneration(key, expectedGeneration);
    await storeService.saveResources(
      [
        {
          id: postgresDatabaseCatalogResourceId(resolvedIdentity),
          project_id: resolvedIdentity.projectId,
          connection_id: resolvedIdentity.connectionId,
          parent_id: parentId,
          kind: POSTGRES_DATABASE_CATALOG_CACHE_KIND,
          name: `${resolvedIdentity.driver} database catalog`,
          metadata: {
            version: POSTGRES_DATABASE_CATALOG_CACHE_VERSION,
            driver: resolvedIdentity.driver,
            driverPackageVersion: resolvedIdentity.driverPackageVersion,
            connectionDatabaseName: resolvedIdentity.connectionDatabaseName,
            connectionId: resolvedIdentity.connectionId,
            databases: normalizedDatabases,
          } satisfies StoredPostgresDatabaseCatalog,
          last_updated: Date.now(),
        },
      ],
      resolvedIdentity.projectId,
    );
  });
}

export async function clearPostgresDatabaseCatalogStorage(
  identity: PostgresDatabaseCatalogIdentity,
): Promise<void> {
  const resolvedIdentity = resolvePostgresDatabaseCatalogIdentity(identity);
  const key = postgresDatabaseCatalogKey(resolvedIdentity);
  await queuePostgresDatabaseCatalogOperation(key, async () => {
    await storeService.deleteResources(
      resolvedIdentity.connectionId,
      postgresDatabaseCatalogParentId(resolvedIdentity),
      POSTGRES_DATABASE_CATALOG_CACHE_KIND,
      resolvedIdentity.projectId,
    );
  });
}
