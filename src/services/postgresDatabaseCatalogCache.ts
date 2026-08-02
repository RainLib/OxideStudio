import { schemaService } from "@/services/tauri/schema.service";
import {
  storeService,
  type Resource,
} from "@/services/tauri/store.service";
import type { DatabaseDriver } from "@/services/tauri/types";

export const POSTGRES_DATABASE_CATALOG_CACHE_KIND =
  "POSTGRES_DATABASE_CATALOG_CACHE";

const POSTGRES_DATABASE_CATALOG_CACHE_VERSION = 1;

export interface PostgresDatabaseCatalogIdentity {
  projectId: string;
  connectionId: string;
  /**
   * The file keeps its historical name for storage compatibility, but its
   * cache key is driver-scoped and can safely serve any capability-declared
   * catalog provider (for example DuckDB attached databases).
   */
  driver: DatabaseDriver;
}

export interface PostgresDatabaseCatalogSnapshot {
  databases: string[];
  source: "cache" | "remote";
  updatedAt: number;
}

interface StoredPostgresDatabaseCatalog {
  version: number;
  driver: DatabaseDriver;
  connectionId: string;
  databases: string[];
}

const catalogRefreshes = new Map<
  string,
  Promise<PostgresDatabaseCatalogSnapshot>
>();
const catalogListeners = new Map<
  string,
  Set<(snapshot: PostgresDatabaseCatalogSnapshot) => void>
>();

function catalogKey(identity: PostgresDatabaseCatalogIdentity) {
  return [identity.projectId, identity.connectionId, identity.driver].join(":");
}

export function subscribePostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
  listener: (snapshot: PostgresDatabaseCatalogSnapshot) => void
) {
  const key = catalogKey(identity);
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
  return `oxide:server-catalog:${identity.connectionId}:${identity.driver}`;
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
  identity: PostgresDatabaseCatalogIdentity
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
    metadata.connectionId !== identity.connectionId ||
    !Array.isArray(metadata.databases) ||
    metadata.databases.some((database) => typeof database !== "string")
  ) {
    return null;
  }

  return {
    version: POSTGRES_DATABASE_CATALOG_CACHE_VERSION,
    driver: identity.driver,
    connectionId: identity.connectionId,
    databases: normalizeDatabases(metadata.databases),
  };
}

export async function readCachedPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity
): Promise<PostgresDatabaseCatalogSnapshot | null> {
  try {
    const resources = await storeService.getResources(
      identity.connectionId,
      postgresDatabaseCatalogParentId(identity),
      identity.projectId
    );
    const resource = resources.find(
      (item) => item.kind === POSTGRES_DATABASE_CATALOG_CACHE_KIND
    );
    const catalog = parseCatalogResource(resource, identity);
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
  databases: readonly string[]
): Promise<void> {
  const normalizedDatabases = normalizeDatabases(databases);
  const parentId = postgresDatabaseCatalogParentId(identity);

  await storeService.saveResources(
    [
      {
        id: postgresDatabaseCatalogResourceId(identity),
        project_id: identity.projectId,
        connection_id: identity.connectionId,
        parent_id: parentId,
        kind: POSTGRES_DATABASE_CATALOG_CACHE_KIND,
        name: `${identity.driver} database catalog`,
        metadata: {
          version: POSTGRES_DATABASE_CATALOG_CACHE_VERSION,
          driver: identity.driver,
          connectionId: identity.connectionId,
          databases: normalizedDatabases,
        } satisfies StoredPostgresDatabaseCatalog,
        last_updated: Date.now(),
      },
    ],
    identity.projectId
  );
}

/**
 * Fetch the authoritative list and persist it under the project captured by
 * the caller. Concurrent StrictMode/effect refreshes share one request.
 */
export function refreshPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity
): Promise<PostgresDatabaseCatalogSnapshot> {
  const key = catalogKey(identity);
  const pending = catalogRefreshes.get(key);
  if (pending) return pending;

  const refresh = (async () => {
    const databases = normalizeDatabases(
      await schemaService.getDatabases(identity.connectionId)
    );
    try {
      await persistPostgresDatabaseCatalog(identity, databases);
    } catch (error) {
      console.warn("Failed to cache database catalog", error);
    }
    const snapshot = {
      databases,
      source: "remote" as const,
      updatedAt: Date.now(),
    };
    notifyPostgresDatabaseCatalog(identity, snapshot);
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
  await storeService.deleteResources(
    identity.connectionId,
    postgresDatabaseCatalogParentId(identity),
    POSTGRES_DATABASE_CATALOG_CACHE_KIND,
    identity.projectId
  );
}
