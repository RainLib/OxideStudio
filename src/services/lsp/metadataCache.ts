export type CachedLspMetadata<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

export type LspMetadataCacheStatus = "hit" | "miss";

export function getCachedLspMetadata<T>(
  cache: Map<string, CachedLspMetadata<T>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  now = Date.now(),
  onCacheStatus?: (status: LspMetadataCacheStatus) => void,
) {
  pruneExpiredLspMetadata(cache, now);

  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    onCacheStatus?.("hit");
    return cached.promise;
  }

  onCacheStatus?.("miss");
  const promise = loader();
  cache.set(key, {
    expiresAt: now + ttlMs,
    promise,
  });

  promise.catch(() => {
    if (cache.get(key)?.promise === promise) {
      cache.delete(key);
    }
  });

  return promise;
}

export function pruneExpiredLspMetadata<T>(
  cache: Map<string, CachedLspMetadata<T>>,
  now = Date.now()
) {
  for (const [key, cached] of cache) {
    if (cached.expiresAt <= now) {
      cache.delete(key);
    }
  }
}
