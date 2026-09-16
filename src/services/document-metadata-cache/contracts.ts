export const DEFAULT_DOCUMENT_METADATA_TTL_MS = 2 * 60_000;
export const DEFAULT_DOCUMENT_METADATA_MAX_ENTRIES = 256;

export type DocumentMetadataCacheEntry<T> = {
  expiresAt: number;
  lastAccessedAt: number;
  promise?: Promise<T>;
  value?: T;
};

export type DocumentMetadataCacheIdentity = {
  projectId: string;
  connectionId: string;
  driver: string;
};

export type KnownDocumentCollection = {
  name: string;
  namespace?: string | null;
};
