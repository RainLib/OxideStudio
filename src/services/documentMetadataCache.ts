/** Stable compatibility entry point for document-database metadata caching. */
export { DocumentMetadataCache } from "./document-metadata-cache/cache";
export type {
  DocumentMetadataCacheIdentity,
  KnownDocumentCollection,
} from "./document-metadata-cache/contracts";
export {
  documentMetadataCacheKey,
  documentMetadataCacheScope,
} from "./document-metadata-cache/identity";
export { knownDocumentCollectionNamesForScope } from "./document-metadata-cache/collections";
export {
  invalidateDocumentMetadataScope,
  loadDocumentMetadata,
  resetDocumentMetadataCacheForTests,
} from "./document-metadata-cache/runtime";
