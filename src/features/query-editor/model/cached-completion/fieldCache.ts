import type { CachedSearchColumn } from "./metadataSearch";
import type { DatabaseDriver } from "@/services/tauri/types";
export type CachedMetadataScope = {
  activeProjectId?: string | null;
  connectionId?: string | null;
  driver: DatabaseDriver;
  metadataRevision: number;
};
export function cachedMetadataKey(runtime: CachedMetadataScope, databaseName: string | undefined, schema: string, suffix: readonly string[]) {
  return [runtime.activeProjectId || "local", runtime.connectionId, runtime.driver, String(runtime.metadataRevision), databaseName || "", schema, ...suffix].join("\u0000");
}

/** A renderer-local cache must not pin the service cache's evicted snapshots.
 * Estimates count UTF-16 payload plus per-column overhead, not process RSS. */
export const CACHED_FIELDS_MAX_ENTRIES = 128;
export const CACHED_FIELDS_MAX_ESTIMATED_BYTES = 8 * 1024 * 1024;
const size = (columns: readonly CachedSearchColumn[]) => columns.reduce((sum, column) => sum + 128 + 2 * (column.name.length + column.dataType.length + (column.comment?.length ?? 0)), 0);
export function rememberCachedFields(cache: Map<string, CachedSearchColumn[]>, key: string, columns: CachedSearchColumn[]) {
  const bytes = size(columns);
  if (bytes > CACHED_FIELDS_MAX_ESTIMATED_BYTES) return;
  cache.delete(key);
  cache.set(key, columns);
  let total = 0;
  for (const columns of cache.values()) total += size(columns);
  while (cache.size > CACHED_FIELDS_MAX_ENTRIES || total > CACHED_FIELDS_MAX_ESTIMATED_BYTES) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    total -= size(cache.get(first)!);
    cache.delete(first);
  }
}
