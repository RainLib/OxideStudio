import {
  collectionToLspTableDefinition,
  type LspTableDefinition,
} from "@/services/lsp/schemaConfig";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import {
  type CollectionInfo,
  type DatabaseCapabilities,
} from "@/services/tauri";

export async function collectionToLspTableDefinitionWithMetadata(
  connectionId: string,
  namespace: string,
  capabilities: DatabaseCapabilities,
  collection: CollectionInfo,
): Promise<LspTableDefinition> {
  if (
    capabilities.dataModel !== "document" &&
    capabilities.dataModel !== "search"
  ) {
    return collectionToLspTableDefinition(capabilities, collection);
  }

  try {
    const metadata = await loadTableMetadata({
      connectionId,
      driver: capabilities.driver,
      schema: namespace,
      table: collection.name,
      includeIndexes: capabilities.dataModel === "document",
      includeConstraints: false,
      priority: "background",
    });
    return collectionToLspTableDefinition(
      capabilities,
      collection,
      metadata.columns,
      metadata.indexes,
    );
  } catch (error) {
    console.error(
      `[LSP] Failed to fetch object fields for ${namespace}.${collection.name}:`,
      error,
    );
    return collectionToLspTableDefinition(capabilities, collection);
  }
}
