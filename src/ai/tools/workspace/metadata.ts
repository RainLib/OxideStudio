import type {
  AiDescribeObjectInput,
  AiListObjectsInput,
  AiObjectDescription,
  AiObjectKind,
  AiObjectSummary,
  AiToolAdapters,
  AiToolExecutionContext,
} from "@/ai/tools/types";
import {
  requireLocalAiConnection,
  resolveMetadataTarget,
} from "@/ai/tools/workspace/targets";
import { previewTableQuery } from "@/lib/databaseDialect";
import {
  collectionDeleteQueryTemplateForCapabilities,
  collectionPreviewQueryTemplateForCapabilities,
} from "@/lib/databaseObjectPreview";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import { schemaService } from "@/services/tauri";
import type { DatabaseDataModel } from "@/services/tauri/types";
import { useSchemaStore } from "@/store/useSchemaStore";

async function listObjects(
  input: AiListObjectsInput,
  context: AiToolExecutionContext,
): Promise<AiObjectSummary[]> {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "metadata.listObjects",
  );

  if (capabilities.supportsTableBrowsing) {
    const tables = await schemaService.getTables(connectionId, namespace);
    return tables.map((table) => ({
      name: table.name,
      namespace: table.schema || namespace,
      kind: "relation",
      type: table.type || null,
      comment: table.comment || null,
      table,
    }));
  }

  if (
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing
  ) {
    const collections = await schemaService.getCollections(
      connectionId,
      namespace,
    );
    const kind = collectionKind(capabilities.dataModel);
    return collections.map((collection) => ({
      name: collection.name,
      namespace: collection.namespace || namespace,
      kind,
      type: collection.type || null,
      documentCount: collection.documentCount ?? null,
      collection,
    }));
  }

  return [];
}

async function describeObject(
  input: AiDescribeObjectInput,
  context: AiToolExecutionContext,
): Promise<AiObjectDescription> {
  const { connectionId, namespace, driver, capabilities } =
    await resolveMetadataTarget(
      input.connectionId,
      input.namespace,
      context,
      "metadata.describeObject",
    );
  if (capabilities.supportsTableBrowsing) {
    const metadata = await loadTableMetadata({
      connectionId,
      driver,
      schema: namespace,
      table: input.name,
      includeIndexes: capabilities.supportsTableIndexes,
      includeConstraints: capabilities.supportsTableConstraints,
    });

    return {
      connectionId,
      namespace,
      name: input.name,
      driver,
      kind: "relation",
      columns: metadata.columns,
      indexes: metadata.indexes,
      constraints: metadata.constraints,
      previewQuery: previewTableQuery(driver, namespace, input.name, 100),
    };
  }

  if (
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing
  ) {
    const collections = await schemaService.getCollections(
      connectionId,
      namespace,
    );
    const collection = collections.find(
      (candidate) => candidate.name === input.name,
    );
    const metadata =
      capabilities.dataModel === "document" ||
      capabilities.dataModel === "search"
        ? await loadTableMetadata({
            connectionId,
            driver,
            schema: namespace,
            table: input.name,
            includeIndexes: capabilities.dataModel === "document",
            includeConstraints: false,
          })
        : null;
    const previewCollection = collection ?? {
      name: input.name,
      namespace,
      type: null,
      documentCount: null,
    };
    return {
      connectionId,
      namespace,
      name: input.name,
      driver,
      kind: collectionKind(capabilities.dataModel),
      collection: collection ?? null,
      columns: metadata?.columns || [],
      indexes: metadata?.indexes || [],
      previewQuery: collectionPreviewQueryTemplateForCapabilities(
        capabilities,
        namespace,
        previewCollection,
      ),
      deleteQuery: collectionDeleteQueryTemplateForCapabilities(
        capabilities,
        namespace,
        previewCollection,
      ),
    };
  }

  return {
    connectionId,
    namespace,
    name: input.name,
    driver,
    kind: "object",
  };
}

function collectionKind(dataModel: DatabaseDataModel): AiObjectKind {
  if (dataModel === "keyValue") return "key";
  if (dataModel === "search") return "index";
  if (dataModel === "document") return "collection";
  return "object";
}

export function createMetadataAdapters(): Pick<
  AiToolAdapters,
  "listCollections" | "listObjects" | "describeObject"
> {
  return {
    listCollections: async (input, context) => {
      const connectionId = input.connectionId || context.activeConnectionId;
      if (!connectionId) {
        throw new Error(
          "No active connection is available for metadata.listCollections",
        );
      }
      requireLocalAiConnection(connectionId);
      const namespace =
        input.namespace || useSchemaStore.getState().currentSchema || "";
      return schemaService.getCollections(connectionId, namespace);
    },

    listObjects: async (input, context) => listObjects(input, context),

    describeObject: async (input, context) => describeObject(input, context),
  };
}
