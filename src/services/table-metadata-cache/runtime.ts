import {
  MetadataCacheGenerationRegistry,
} from "@/services/metadataCacheGeneration";
import { MetadataTaskLimiter } from "@/services/metadataTaskLimiter";
import type { TableMetadataSnapshot } from "./contracts";
import {
  scopedTableCacheKey,
  type ResolvedTableMetadataIdentity,
} from "./identity";

export const metadataLoads = new Map<string, Promise<TableMetadataSnapshot>>();
export const objectSourceLoads = new Map<
  string,
  { force: boolean; promise: Promise<string> }
>();
export const cacheOperations = new Map<string, Promise<unknown>>();
export const cacheGenerations = new MetadataCacheGenerationRegistry();
export const remoteMetadataLimiter = new MetadataTaskLimiter(2, 512);

export function captureCacheGeneration(identity: ResolvedTableMetadataIdentity) {
  const scope = scopedTableCacheKey(identity);
  return { scope, generation: cacheGenerations.capture(scope) };
}

export function advanceCacheGeneration(identity: ResolvedTableMetadataIdentity) {
  const scope = scopedTableCacheKey(identity);
  return { scope, generation: cacheGenerations.advance(scope) };
}

export function runObjectSourceLoad(
  key: string,
  force: boolean,
  load: () => Promise<string>,
) {
  const existing = objectSourceLoads.get(key);
  if (existing && (!force || existing.force)) return existing.promise;

  const entry = {
    force,
    promise: Promise.resolve("") as Promise<string>,
  };
  entry.promise = load().finally(() => {
    if (objectSourceLoads.get(key) === entry) {
      objectSourceLoads.delete(key);
    }
  });
  objectSourceLoads.set(key, entry);
  return entry.promise;
}

export function invalidateObjectSourceLoads(
  identity: ResolvedTableMetadataIdentity,
) {
  const prefix = `${scopedTableCacheKey(identity)}:`;
  for (const key of objectSourceLoads.keys()) {
    if (key.startsWith(prefix)) objectSourceLoads.delete(key);
  }
}
