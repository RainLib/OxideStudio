import { schemaService } from "@/services/tauri";
import type { TableInfo } from "@/services/tauri/types";

export type RelationCatalogCache = Map<string, { expiresAt: number; promise: Promise<TableInfo[]> }>;

/** Discover one selected namespace lazily. Opening a SELECT or FROM must not
 * require the Explorer's table node to have been expanded beforehand. */
export async function completionRelationCatalog(options: {
  tables: TableInfo[];
  connectionId?: string | null;
  database?: string | null;
  schema?: string | null;
  cache: RelationCatalogCache;
  allowed: () => boolean;
}): Promise<TableInfo[]> {
  if (!options.allowed()) return [];
  if (options.tables.length) return options.tables;
  const { connectionId, database, schema, cache } = options;
  if (!connectionId || !schema) return [];
  const key = JSON.stringify([connectionId, database, schema]);
  let cached = cache.get(key);
  if (!cached || cached.expiresAt < Date.now()) {
    const promise = (database
      ? schemaService.getDatabaseTables(connectionId, database, schema)
      : schemaService.getTables(connectionId, schema)).catch(() => []);
    cached = { promise, expiresAt: Date.now() + 30_000 };
    cache.set(key, cached);
    while (cache.size > 24) cache.delete(cache.keys().next().value!);
  }
  const tables = await cached.promise;
  return options.allowed() ? tables : [];
}
