const DEFAULT_DOCUMENT_METADATA_TTL_MS = 2 * 60_000;
const DEFAULT_DOCUMENT_METADATA_MAX_ENTRIES = 256;

type DocumentMetadataCacheEntry<T> = {
  expiresAt: number;
  lastAccessedAt: number;
  promise?: Promise<T>;
  value?: T;
};

/**
 * Bounded metadata cache for document databases. Unlike SQL LSP schema state,
 * index/collection discovery is requested by Console completion providers.
 * Keep that work shared across tabs and serve a last known value while one
 * expired entry refreshes in the background.
 */
export class DocumentMetadataCache<T> {
  private readonly entries = new Map<string, DocumentMetadataCacheEntry<T>>();

  constructor(
    private readonly ttlMs = DEFAULT_DOCUMENT_METADATA_TTL_MS,
    private readonly maxEntries = DEFAULT_DOCUMENT_METADATA_MAX_ENTRIES,
  ) {}

  get(
    key: string,
    loader: () => Promise<T>,
    now = Date.now(),
    onBackgroundRefresh?: (value: T) => void,
  ): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      cached.lastAccessedAt = now;
      this.entries.delete(key);
      this.entries.set(key, cached);
      if (cached.value !== undefined) {
        let backgroundRefresh = cached.promise;
        if (cached.expiresAt <= now && !cached.promise) {
          backgroundRefresh = this.refresh(key, cached, loader, now);
          void backgroundRefresh.catch(() => undefined);
        }
        if (backgroundRefresh && onBackgroundRefresh) {
          void backgroundRefresh.then(onBackgroundRefresh, () => undefined);
        }
        return Promise.resolve(cached.value);
      }
      if (cached.promise) return cached.promise;
    }

    const entry: DocumentMetadataCacheEntry<T> = {
      expiresAt: now + this.ttlMs,
      lastAccessedAt: now,
    };
    this.entries.set(key, entry);
    this.prune();
    return this.refresh(key, entry, loader, now);
  }

  invalidateScope(scope: string) {
    const prefix = `${scope}\u0000`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  private refresh(
    key: string,
    entry: DocumentMetadataCacheEntry<T>,
    loader: () => Promise<T>,
    now: number,
  ) {
    const refresh = loader().then(
      (value) => {
        if (this.entries.get(key) === entry) {
          entry.value = value;
          entry.expiresAt = now + this.ttlMs;
          entry.lastAccessedAt = now;
          entry.promise = undefined;
        }
        return value;
      },
      (error) => {
        if (this.entries.get(key) === entry) {
          entry.promise = undefined;
          if (entry.value === undefined) {
            this.entries.delete(key);
          } else {
            // Do not hammer an unavailable service while preserving a safe,
            // read-only last-known catalog for the current editor session.
            entry.expiresAt = now + Math.min(this.ttlMs, 15_000);
          }
        }
        throw error;
      },
    );
    entry.promise = refresh;
    return refresh;
  }

  private prune() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") return;
      this.entries.delete(oldest);
    }
  }
}

export type DocumentMetadataCacheIdentity = {
  projectId: string;
  connectionId: string;
  driver: string;
};

export function documentMetadataCacheScope(
  identity: DocumentMetadataCacheIdentity,
) {
  return [identity.projectId, identity.connectionId, identity.driver]
    .map((part) => encodeURIComponent(part))
    .join("\u0000");
}

export function documentMetadataCacheKey(
  identity: DocumentMetadataCacheIdentity & {
    namespace: string;
    kind: "collections" | "fields";
    objectName?: string;
  },
) {
  return [
    documentMetadataCacheScope(identity),
    encodeURIComponent(identity.namespace),
    identity.kind,
    encodeURIComponent(identity.objectName || ""),
  ].join("\u0000");
}

const documentMetadataCache = new DocumentMetadataCache<unknown>();

export function loadDocumentMetadata<T>(
  key: string,
  loader: () => Promise<T>,
  options?: {
    onBackgroundRefresh?: (value: T) => void;
  },
) {
  return documentMetadataCache.get(
    key,
    loader,
    Date.now(),
    options?.onBackgroundRefresh
      ? (value) => options.onBackgroundRefresh?.(value as T)
      : undefined,
  ) as Promise<T>;
}

export function invalidateDocumentMetadataScope(
  identity: DocumentMetadataCacheIdentity,
) {
  documentMetadataCache.invalidateScope(documentMetadataCacheScope(identity));
}

export function resetDocumentMetadataCacheForTests() {
  documentMetadataCache.clear();
}
