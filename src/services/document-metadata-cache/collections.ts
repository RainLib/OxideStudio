import type { KnownDocumentCollection } from "./contracts";

/** Return schema-store values only when they belong to the exact tab connection. */
export function knownDocumentCollectionNamesForScope(
  collections: readonly KnownDocumentCollection[],
  options: {
    metadataConnectionId: string | null | undefined;
    targetConnectionId: string | null | undefined;
    namespace: string;
  },
): string[] {
  if (
    !options.metadataConnectionId ||
    options.metadataConnectionId !== options.targetConnectionId
  ) {
    return [];
  }
  return collections
    .filter(
      (collection) =>
        !options.namespace ||
        !collection.namespace ||
        collection.namespace === options.namespace,
    )
    .map((collection) => collection.name)
    .filter(Boolean);
}
