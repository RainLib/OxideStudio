import {
  MetadataCacheGenerationRegistry,
} from "@/services/metadataCacheGeneration";
import type {
  PostgresDatabaseCatalogListener,
  PostgresDatabaseCatalogSnapshot,
} from "./contracts";

const catalogRefreshes = new Map<
  string,
  Promise<PostgresDatabaseCatalogSnapshot>
>();
const catalogOperations = new Map<string, Promise<unknown>>();
const catalogGenerations = new MetadataCacheGenerationRegistry();
const catalogListeners = new Map<string, Set<PostgresDatabaseCatalogListener>>();

export function pendingPostgresDatabaseCatalogRefresh(key: string) {
  return catalogRefreshes.get(key);
}

export function registerPostgresDatabaseCatalogRefresh(
  key: string,
  refresh: Promise<PostgresDatabaseCatalogSnapshot>,
) {
  catalogRefreshes.set(key, refresh);
  const clear = () => {
    if (catalogRefreshes.get(key) === refresh) catalogRefreshes.delete(key);
  };
  void refresh.then(clear, clear);
}

export function clearPostgresDatabaseCatalogRefresh(key: string) {
  catalogRefreshes.delete(key);
}

export function capturePostgresDatabaseCatalogGeneration(key: string) {
  return catalogGenerations.capture(key);
}

export function assertPostgresDatabaseCatalogGeneration(
  key: string,
  generation: number,
) {
  catalogGenerations.assertCurrent(key, generation);
}

export function advancePostgresDatabaseCatalogGeneration(key: string) {
  catalogGenerations.advance(key);
}

export async function queuePostgresDatabaseCatalogOperation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previousOperation = catalogOperations.get(key) || Promise.resolve();
  const queuedOperation = previousOperation.catch(() => null).then(operation);
  catalogOperations.set(key, queuedOperation);
  try {
    return await queuedOperation;
  } finally {
    if (catalogOperations.get(key) === queuedOperation) {
      catalogOperations.delete(key);
    }
  }
}

export function subscribePostgresDatabaseCatalogRuntime(
  key: string,
  listener: PostgresDatabaseCatalogListener,
) {
  const listeners = catalogListeners.get(key) || new Set();
  listeners.add(listener);
  catalogListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) catalogListeners.delete(key);
  };
}

export function notifyPostgresDatabaseCatalogRuntime(
  key: string,
  snapshot: PostgresDatabaseCatalogSnapshot,
) {
  for (const listener of catalogListeners.get(key) || []) listener(snapshot);
}
