import {
  commonRedisCommandDocumentation,
  mergeRedisCommandDocumentation,
  parseRedisCommandCatalog,
  parseRedisCommandDocumentation,
  type RedisCommandDocumentation,
} from "@/lib/redisCommandDocs";
import { queryService, schemaService } from "@/services/tauri";

const commandCache = new Map<string, Promise<RedisCommandDocumentation[]>>();
const keyCache = new Map<string, Promise<string[]>>();
const MAX_KEY_SUGGESTIONS = 1_000;
const MAX_KEY_PAGES = 6;

function redisResultValue(results: Awaited<ReturnType<typeof queryService.executeQuery>>): unknown {
  return results[0]?.rows[0]?.[1];
}

export function loadRedisCommandDocumentation(
  connectionId: string,
  database: string,
  generation = 0,
): Promise<RedisCommandDocumentation[]> {
  const cacheKey = `${connectionId}:${generation}`;
  const cached = commandCache.get(cacheKey);
  if (cached) return cached;
  const request = (async () => {
    let documentation: RedisCommandDocumentation[] = [];
    let catalog: RedisCommandDocumentation[] = [];
    try {
      const docs = await queryService.executeQuery(
        connectionId,
        "COMMAND DOCS",
        database || "0",
      );
      documentation = parseRedisCommandDocumentation(redisResultValue(docs));
    } catch {
      // Redis before 7 and restricted servers can still expose COMMAND.
    }
    try {
      const commands = await queryService.executeQuery(
        connectionId,
        "COMMAND",
        database || "0",
      );
      catalog = parseRedisCommandCatalog(redisResultValue(commands));
    } catch {
      // A least-privilege Redis user may deny command introspection.
    }
    const merged = mergeRedisCommandDocumentation(documentation, catalog);
    return merged.length ? merged : commonRedisCommandDocumentation();
  })();
  commandCache.set(cacheKey, request);
  request.catch(() => commandCache.delete(cacheKey));
  return request;
}

export function loadRedisCompletionKeys(
  connectionId: string,
  database: string,
  generation = 0,
): Promise<string[]> {
  const cacheKey = `${connectionId}:${database || "0"}:${generation}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const request = (async () => {
    const keys: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await schemaService.getCollectionsPage(
        connectionId,
        database || "0",
        cursor,
        Math.min(200, MAX_KEY_SUGGESTIONS - keys.length),
      );
      page.items.forEach((item) => {
        if (keys.length < MAX_KEY_SUGGESTIONS && !/\\x[0-9a-f]{2}/i.test(item.name)) {
          keys.push(item.name);
        }
      });
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < MAX_KEY_PAGES && keys.length < MAX_KEY_SUGGESTIONS);
    return [...new Set(keys)].sort((left, right) => left.localeCompare(right));
  })();
  keyCache.set(cacheKey, request);
  request.catch(() => keyCache.delete(cacheKey));
  return request;
}

export function clearRedisCompletionCache(connectionId?: string): void {
  for (const cache of [commandCache, keyCache]) {
    for (const key of cache.keys()) {
      if (!connectionId || key.startsWith(`${connectionId}:`)) cache.delete(key);
    }
  }
}
