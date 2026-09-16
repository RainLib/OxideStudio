import type { DocumentMetadataCacheIdentity } from "./contracts";
import { DocumentMetadataCache } from "./cache";
import { documentMetadataCacheScope } from "./identity";

const documentMetadataCache = new DocumentMetadataCache<unknown>();

export function loadDocumentMetadata<T>(
  key: string,
  loader: () => Promise<T>,
  options?: { onBackgroundRefresh?: (value: T) => void },
): Promise<T> {
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
): void {
  documentMetadataCache.invalidateScope(documentMetadataCacheScope(identity));
}

export function resetDocumentMetadataCacheForTests(): void {
  documentMetadataCache.clear();
}
