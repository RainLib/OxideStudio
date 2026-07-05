import {
  databaseService,
  queryService,
  schemaService,
  tableService,
} from "@/services/tauri";
import type { QueryResult } from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { registerCoreAiTools } from "./coreTools";
import { createAiToolRegistry } from "./registry";
import type {
  AiDescribeObjectInput,
  AiListObjectsInput,
  AiObjectDescription,
  AiObjectKind,
  AiObjectSummary,
  AiTableMutationInput,
  AiToolAdapters,
  AiToolExecutionContext,
  AiWorkspaceTabSummary,
} from "./types";

export function createWorkspaceAiToolRegistry() {
  return registerCoreAiTools(
    createAiToolRegistry(),
    createWorkspaceAiToolAdapters()
  );
}

export function createWorkspaceAiToolContext(
  requestId = createRequestId()
): AiToolExecutionContext {
  const connectionState = useConnectionStore.getState();
  const activeConnection = connectionState.connections.find(
    (connection) => connection.id === connectionState.activeConnectionId
  );

  return {
    requestId,
    activeConnectionId: connectionState.activeConnectionId,
    activeDriver: activeConnection?.driver ?? null,
  };
}

export function createWorkspaceAiToolAdapters(): AiToolAdapters {
  return {
    listConnections: () =>
      useConnectionStore.getState().connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        driver: connection.driver,
      })),

    getConnectionCapabilities: (driver) =>
      databaseService.getDatabaseCapabilities(driver),

    getActiveTab: () => {
      const tabState = useTabStore.getState();
      const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
      if (!activeTab) return null;
      return {
        id: activeTab.id,
        type: activeTab.type,
        title: activeTab.title,
        sql: activeTab.sql,
        connectionId: activeTab.connectionId ?? null,
      } satisfies AiWorkspaceTabSummary;
    },

    listCollections: async (input, context) => {
      const connectionId = input.connectionId || context.activeConnectionId;
      if (!connectionId) {
        throw new Error("No active connection is available for metadata.listCollections");
      }
      const namespace =
        input.namespace || useSchemaStore.getState().currentSchema || "";
      return schemaService.getCollections(connectionId, namespace);
    },

    listObjects: async (input, context) => listObjects(input, context),

    describeObject: async (input, context) => describeObject(input, context),

    runReadOnlyQuery: async (input, context) => {
      const connectionId = input.connectionId || context.activeConnectionId;
      if (!connectionId) {
        throw new Error("No active connection is available for query.runReadOnly");
      }

      const results = await queryService.executeQuery(connectionId, input.query);
      return limitQueryResults(results, input.limit ?? 200);
    },

    runMutationQuery: async (input, context) => {
      const connectionId = input.connectionId || context.activeConnectionId;
      if (!connectionId) {
        throw new Error("No active connection is available for mutation query");
      }

      return queryService.executeQuery(connectionId, input.query);
    },

    mutateTableRows: async (input, context) => mutateTableRows(input, context),
  };
}

async function mutateTableRows(
  input: AiTableMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, namespace, driver, capabilities } =
    await resolveMetadataTarget(
      input.connectionId,
      input.namespace,
      context,
      "table.mutateRows"
    );
  if (!capabilities.supportsTableBrowsing) {
    throw new Error(`${capabilities.displayName} does not support table row mutation`);
  }

  return tableService.mutateTableRows(
    connectionId,
    driver,
    namespace,
    input.table,
    input.inserts ?? [],
    input.updates ?? [],
    input.deletes ?? []
  );
}

async function listObjects(
  input: AiListObjectsInput,
  context: AiToolExecutionContext
): Promise<AiObjectSummary[]> {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "metadata.listObjects"
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
    const collections = await schemaService.getCollections(connectionId, namespace);
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
  context: AiToolExecutionContext
): Promise<AiObjectDescription> {
  const { connectionId, namespace, driver, capabilities } =
    await resolveMetadataTarget(
      input.connectionId,
      input.namespace,
      context,
      "metadata.describeObject"
    );
  if (capabilities.supportsTableBrowsing) {
    const [columns, indexes, constraints] = await Promise.all([
      schemaService.getColumns(connectionId, namespace, input.name),
      capabilities.supportsTableIndexes
        ? schemaService.getIndexes(connectionId, namespace, input.name)
        : Promise.resolve([]),
      capabilities.supportsTableConstraints
        ? schemaService.getConstraints(connectionId, namespace, input.name)
        : Promise.resolve([]),
    ]);

    return {
      connectionId,
      namespace,
      name: input.name,
      driver,
      kind: "relation",
      columns,
      indexes,
      constraints,
    };
  }

  if (
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing
  ) {
    const collections = await schemaService.getCollections(connectionId, namespace);
    const collection = collections.find((candidate) => candidate.name === input.name);
    return {
      connectionId,
      namespace,
      name: input.name,
      driver,
      kind: collectionKind(capabilities.dataModel),
      collection: collection ?? null,
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

function collectionKind(
  dataModel: "relational" | "document" | "keyValue" | "search"
): AiObjectKind {
  if (dataModel === "keyValue") return "key";
  if (dataModel === "search") return "index";
  if (dataModel === "document") return "collection";
  return "object";
}

async function resolveMetadataTarget(
  requestedConnectionId: string | null | undefined,
  requestedNamespace: string | null | undefined,
  context: AiToolExecutionContext,
  toolName: string
) {
  const connectionId = requestedConnectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error(`No active connection is available for ${toolName}`);
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const driver = connection?.driver ?? context.activeDriver ?? null;
  if (!driver) {
    throw new Error(`Connection driver is not available for ${connectionId}`);
  }

  const namespace = requestedNamespace || useSchemaStore.getState().currentSchema || "";
  const capabilities = await databaseService.getDatabaseCapabilities(driver);
  return { connectionId, namespace, driver, capabilities };
}

function limitQueryResults(results: QueryResult[], limit: number) {
  const rowLimit = Math.max(0, Math.floor(limit));
  return results.map((result) => ({
    ...result,
    rows: result.rows.slice(0, rowLimit),
  }));
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `ai-tool-${Date.now()}`;
}
