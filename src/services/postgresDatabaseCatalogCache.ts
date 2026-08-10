import { schemaService } from "@/services/tauri/schema.service";
import {
  storeService,
  type Resource,
} from "@/services/tauri/store.service";
import type { DatabaseDriver } from "@/services/tauri/types";
import {
  isMetadataCacheSupersededError,
  MetadataCacheSupersededError,
  MetadataCacheGenerationRegistry,
} from "@/services/metadataCacheGeneration";
import {
  isMetadataConnectionScopeCurrent,
  resolveMetadataConnectionScope,
  type ResolvedMetadataConnectionScope,
} from "@/services/metadataConnectionScope";

export const POSTGRES_DATABASE_CATALOG_CACHE_KIND =
  "POSTGRES_DATABASE_CATALOG_CACHE";

const POSTGRES_DATABASE_CATALOG_CACHE_VERSION = 2;

export interface PostgresDatabaseCatalogIdentity {
  projectId: string;
  connectionId: string;
  /**
   * The file keeps its historical name for storage compatibility, but its
   * cache key is driver-scoped and can safely serve any capability-declared
   * catalog provider (for example DuckDB attached databases).
   */
  driver: DatabaseDriver;
  driverPackageVersion?: string | null;
  connectionDatabaseName?: string | null;
}

type ResolvedPostgresDatabaseCatalogIdentity =
  PostgresDatabaseCatalogIdentity & ResolvedMetadataConnectionScope;

export interface PostgresDatabaseCatalogSnapshot {
  databases: string[];
  source: "cache" | "remote";
  updatedAt: number;
}

interface StoredPostgresDatabaseCatalog {
  version: number;
  driver: DatabaseDriver;
  driverPackageVersion: string | null;
  connectionDatabaseName: string | null;
  connectionId: string;
  databases: string[];
}

const catalogRefreshes = new Map<
  string,
  Promise<PostgresDatabaseCatalogSnapshot>
>();
const catalogOperations = new Map<string, Promise<unknown>>();
const catalogGenerations = new MetadataCacheGenerationRegistry();
const catalogListeners = new Map<
  string,
  Set<(snapshot: PostgresDatabaseCatalogSnapshot) => void>
>();

function catalogKey(identity: PostgresDatabaseCatalogIdentity) {
  const resolvedIdentity = resolveMetadataConnectionScope(identity);
  return JSON.stringify([
    resolvedIdentity.projectId,
    resolvedIdentity.connectionId,
    resolvedIdentity.driver,
    resolvedIdentity.driverPackageVersion,
    resolvedIdentity.connectionDatabaseName,
  ]);
}

export function subscribePostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
  listener: (snapshot: PostgresDatabaseCatalogSnapshot) => void
) {
  const resolvedIdentity = resolveMetadataConnectionScope(identity);
  const key = catalogKey(resolvedIdentity);
  const listeners = catalogListeners.get(key) || new Set();
  listeners.add(listener);
  catalogListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) catalogListeners.delete(key);
  };
}

function notifyPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
  snapshot: PostgresDatabaseCatalogSnapshot
) {
  for (const listener of catalogListeners.get(catalogKey(identity)) || []) {
    listener(snapshot);
  }
}

/**
 * Keep the server database catalog outside the normal DATABASE/SCHEMA tree.
 * The SQLite project_id column is the outer isolation boundary; this parent
 * adds connection and driver isolation inside that project.
 */
export function postgresDatabaseCatalogParentId(
  identity: PostgresDatabaseCatalogIdentity
) {
  const resolvedIdentity = resolveMetadataConnectionScope(identity);
  return `oxide:server-catalog:v2:${encodeURIComponent(
    JSON.stringify([
      resolvedIdentity.connectionId,
      resolvedIdentity.driver,
      resolvedIdentity.driverPackageVersion,
      resolvedIdentity.connectionDatabaseName,
    ]),
  )}`;
}

export function postgresDatabaseCatalogResourceId(
  identity: PostgresDatabaseCatalogIdentity
) {
  return `${postgresDatabaseCatalogParentId(
    identity
  )}:${POSTGRES_DATABASE_CATALOG_CACHE_KIND}`;
}

function normalizeDatabases(databases: readonly string[]) {
  const unique = new Set<string>();
  for (const database of databases) {
    const normalized = database.trim();
    if (normalized) unique.add(normalized);
  }
  return Array.from(unique);
}

function parseCatalogResource(
  resource: Resource | undefined,
  identity: ResolvedPostgresDatabaseCatalogIdentity
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

  const metadata = resource.metadata as
    | Partial<StoredPostgresDatabaseCatalog>
    | undefined;
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
    databases: normalizeDatabases(metadata.databases),
  };
}

export async function readCachedPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity
): Promise<PostgresDatabaseCatalogSnapshot | null> {
  const resolvedIdentity = resolveMetadataConnectionScope(identity);
  try {
    const resources = await storeService.getResources(
      resolvedIdentity.connectionId,
      postgresDatabaseCatalogParentId(resolvedIdentity),
      resolvedIdentity.projectId
    );
    const resource = resources.find(
      (item) => item.kind === POSTGRES_DATABASE_CATALOG_CACHE_KIND
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
  expectedGeneration = catalogGenerations.capture(catalogKey(identity)),
): Promise<void> {
  const resolvedIdentity = resolveMetadataConnectionScope(identity);
  const normalizedDatabases = normalizeDatabases(databases);
  const parentId = postgresDatabaseCatalogParentId(resolvedIdentity);
  const key = catalogKey(resolvedIdentity);
  const previousOperation = catalogOperations.get(key) || Promise.resolve();
  const write = previousOperation.catch(() => null).then(async () => {
    catalogGenerations.assertCurrent(key, expectedGeneration);
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
      resolvedIdentity.projectId
    );
  });
  catalogOperations.set(key, write);
  try {
    await write;
  } finally {
    if (catalogOperations.get(key) === write) {
      catalogOperations.delete(key);
    }
  }
}

/**
 * Fetch the authoritative list and persist it under the project captured by
 * the caller. Concurrent StrictMode/effect refreshes share one request.
 */
export function refreshPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity
): Promise<PostgresDatabaseCatalogSnapshot> {
  const resolvedIdentity = resolveMetadataConnectionScope(identity);
  const key = catalogKey(resolvedIdentity);
  const pending = catalogRefreshes.get(key);
  if (pending) return pending;

  const refresh = (async () => {
    const generation = catalogGenerations.capture(key);
    if (!isMetadataConnectionScopeCurrent(resolvedIdentity)) {
      throw new MetadataCacheSupersededError();
    }
    const databases = normalizeDatabases(
      await schemaService.getDatabases(resolvedIdentity.connectionId)
    );
    catalogGenerations.assertCurrent(key, generation);
    if (!isMetadataConnectionScopeCurrent(resolvedIdentity)) {
      throw new MetadataCacheSupersededError();
    }
    try {
      await persistPostgresDatabaseCatalog(
        resolvedIdentity,
        databases,
        generation,
      );
    } catch (error) {
      if (isMetadataCacheSupersededError(error)) throw error;
      console.warn("Failed to cache database catalog", error);
    }
    catalogGenerations.assertCurrent(key, generation);
    const snapshot = {
      databases,
      source: "remote" as const,
      updatedAt: Date.now(),
    };
    notifyPostgresDatabaseCatalog(resolvedIdentity, snapshot);
    return snapshot;
  })();

  catalogRefreshes.set(key, refresh);
  const clearPendingRefresh = () => {
    if (catalogRefreshes.get(key) === refresh) {
      catalogRefreshes.delete(key);
    }
  };
  void refresh.then(clearPendingRefresh, clearPendingRefresh);
  return refresh;
}

export async function clearPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity
): Promise<void> {
  const resolvedIdentity = resolveMetadataConnectionScope(identity);
  const key = catalogKey(resolvedIdentity);
  catalogGenerations.advance(key);
  catalogRefreshes.delete(key);
  const previousOperation = catalogOperations.get(key) || Promise.resolve();
  const clear = previousOperation.catch(() => null).then(async () => {
    await storeService.deleteResources(
      resolvedIdentity.connectionId,
      postgresDatabaseCatalogParentId(resolvedIdentity),
      POSTGRES_DATABASE_CATALOG_CACHE_KIND,
      resolvedIdentity.projectId
    );
  });
  catalogOperations.set(key, clear);
  try {
    await clear;
  } finally {
    if (catalogOperations.get(key) === clear) {
      catalogOperations.delete(key);
    }
  }
}
