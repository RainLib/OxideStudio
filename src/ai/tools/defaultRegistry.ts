import { databaseService, queryService, schemaService } from "@/services/tauri";
import type { QueryResult } from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { registerCoreAiTools } from "./coreTools";
import { createAiToolRegistry } from "./registry";
import type {
  AiDescribeObjectInput,
  AiObjectDescription,
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

    describeObject: async (input, context) => describeObject(input, context),

    runReadOnlyQuery: async (input, context) => {
      const connectionId = input.connectionId || context.activeConnectionId;
      if (!connectionId) {
        throw new Error("No active connection is available for query.runReadOnly");
      }

      const results = await queryService.executeQuery(connectionId, input.query);
      return limitQueryResults(results, input.limit ?? 200);
    },
  };
}

async function describeObject(
  input: AiDescribeObjectInput,
  context: AiToolExecutionContext
): Promise<AiObjectDescription> {
  const connectionId = input.connectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error("No active connection is available for metadata.describeObject");
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const driver = connection?.driver ?? context.activeDriver ?? null;
  if (!driver) {
    throw new Error(`Connection driver is not available for ${connectionId}`);
  }

  const namespace = input.namespace || useSchemaStore.getState().currentSchema || "";
  const capabilities = await databaseService.getDatabaseCapabilities(driver);
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
): AiObjectDescription["kind"] {
  if (dataModel === "keyValue") return "key";
  if (dataModel === "search") return "index";
  if (dataModel === "document") return "collection";
  return "object";
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
