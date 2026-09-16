import { schemaService } from "@/services/tauri/schema.service";
import {
  isMetadataCacheSupersededError,
  MetadataCacheSupersededError,
} from "@/services/metadataCacheGeneration";
import { isMetadataConnectionScopeCurrent } from "@/services/metadataConnectionScope";
import type {
  PostgresDatabaseCatalogIdentity,
  PostgresDatabaseCatalogSnapshot,
} from "./contracts";
import {
  normalizePostgresDatabaseCatalog,
  postgresDatabaseCatalogKey,
  resolvePostgresDatabaseCatalogIdentity,
} from "./identity";
import {
  advancePostgresDatabaseCatalogGeneration,
  assertPostgresDatabaseCatalogGeneration,
  capturePostgresDatabaseCatalogGeneration,
  clearPostgresDatabaseCatalogRefresh,
  pendingPostgresDatabaseCatalogRefresh,
  registerPostgresDatabaseCatalogRefresh,
} from "./runtime";
import { clearPostgresDatabaseCatalogStorage, persistPostgresDatabaseCatalog } from "./storage";
import { notifyPostgresDatabaseCatalog } from "./subscriptions";

/**
 * Fetches the authoritative catalog under the caller's captured project and
 * connection scope. Concurrent StrictMode/effect refreshes share one request.
 */
export function refreshPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
): Promise<PostgresDatabaseCatalogSnapshot> {
  const resolvedIdentity = resolvePostgresDatabaseCatalogIdentity(identity);
  const key = postgresDatabaseCatalogKey(resolvedIdentity);
  const pending = pendingPostgresDatabaseCatalogRefresh(key);
  if (pending) return pending;

  const refresh = (async () => {
    const generation = capturePostgresDatabaseCatalogGeneration(key);
    if (!isMetadataConnectionScopeCurrent(resolvedIdentity)) {
      throw new MetadataCacheSupersededError();
    }
    const databases = normalizePostgresDatabaseCatalog(
      await schemaService.getDatabases(resolvedIdentity.connectionId),
    );
    assertPostgresDatabaseCatalogGeneration(key, generation);
    if (!isMetadataConnectionScopeCurrent(resolvedIdentity)) {
      throw new MetadataCacheSupersededError();
    }
    try {
      await persistPostgresDatabaseCatalog(resolvedIdentity, databases, generation);
    } catch (error) {
      if (isMetadataCacheSupersededError(error)) throw error;
      console.warn("Failed to cache database catalog", error);
    }
    assertPostgresDatabaseCatalogGeneration(key, generation);
    const snapshot = {
      databases,
      source: "remote" as const,
      updatedAt: Date.now(),
    };
    notifyPostgresDatabaseCatalog(resolvedIdentity, snapshot);
    return snapshot;
  })();

  registerPostgresDatabaseCatalogRefresh(key, refresh);
  return refresh;
}

export async function clearPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
): Promise<void> {
  const resolvedIdentity = resolvePostgresDatabaseCatalogIdentity(identity);
  const key = postgresDatabaseCatalogKey(resolvedIdentity);
  advancePostgresDatabaseCatalogGeneration(key);
  clearPostgresDatabaseCatalogRefresh(key);
  await clearPostgresDatabaseCatalogStorage(resolvedIdentity);
}
