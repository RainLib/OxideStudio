import {
  databaseService,
  queryService,
  schemaService,
  tableService,
} from "@/services/tauri";
import { getSqlDocumentUri, lspClient } from "@/services/lsp";
import type { QueryResult } from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { lspLanguageId, supportsLspLanguageId } from "@/lib/databaseDialect";
import { registerCoreAiTools } from "./coreTools";
import { createAiToolRegistry } from "./registry";
import type {
  AiDescribeObjectInput,
  AiDocumentMutationInput,
  AiKeyValueMutationInput,
  AiListObjectsInput,
  AiLspCompletionInput,
  AiObjectDescription,
  AiObjectKind,
  AiObjectSummary,
  AiSearchDocumentMutationInput,
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

    mutateDocuments: async (input, context) => mutateDocuments(input, context),

    mutateKeyValues: async (input, context) => mutateKeyValues(input, context),

    mutateSearchDocuments: async (input, context) =>
      mutateSearchDocuments(input, context),

    getLspCompletions: async (input, context) =>
      getLspCompletions(input, context),
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

async function mutateDocuments(
  input: AiDocumentMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "document.mutate"
  );
  if (capabilities.dataModel !== "document") {
    throw new Error(`${capabilities.displayName} does not support document mutation`);
  }

  return queryService.executeQuery(
    connectionId,
    JSON.stringify(buildMongoMutationCommand(input, namespace))
  );
}

async function mutateKeyValues(
  input: AiKeyValueMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "key.mutate"
  );
  if (capabilities.dataModel !== "keyValue") {
    throw new Error(`${capabilities.displayName} does not support key-value mutation`);
  }

  return queryService.executeQuery(connectionId, buildRedisMutationCommand(input));
}

async function mutateSearchDocuments(
  input: AiSearchDocumentMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "search.mutate"
  );
  if (capabilities.dataModel !== "search") {
    throw new Error(`${capabilities.displayName} does not support search document mutation`);
  }

  return queryService.executeQuery(
    connectionId,
    buildElasticsearchMutationRequest(input)
  );
}

async function getLspCompletions(
  input: AiLspCompletionInput,
  context: AiToolExecutionContext
) {
  const connectionId = input.connectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error("No active connection is available for lsp.getCompletions");
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const driver = connection?.driver ?? context.activeDriver ?? null;
  if (!driver) {
    throw new Error(`Connection driver is not available for ${connectionId}`);
  }
  if (!supportsLspLanguageId(driver)) {
    throw new Error(`${driver} does not support LSP completions`);
  }

  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
  const uri =
    input.uri ||
    (activeTab
      ? getSqlDocumentUri(activeTab.id, driver)
      : getSqlDocumentUri(context.requestId, driver));
  const text = input.text ?? activeTab?.sql ?? "";
  const languageId = input.languageId || lspLanguageId(driver);

  await lspClient.didOpen(uri, text, Date.now(), languageId);
  return lspClient.getCompletions(uri, input.line, input.character);
}

function buildMongoMutationCommand(
  input: AiDocumentMutationInput,
  namespace: string
) {
  const base = {
    ...(namespace ? { database: namespace } : {}),
    collection: input.collection,
  };

  if (input.operation === "insert") {
    if (!input.documents?.length) {
      throw new Error("documents is required");
    }
    return {
      ...base,
      insertMany: input.documents,
    };
  }

  if (input.operation === "update") {
    if (!input.filter || !input.update) {
      throw new Error("filter and update are required");
    }
    return {
      ...base,
      [input.many ? "updateMany" : "updateOne"]: {
        filter: input.filter,
        update: input.update,
        upsert: input.upsert ?? false,
      },
    };
  }

  if (!input.filter) {
    throw new Error("filter is required");
  }
  return {
    ...base,
    [input.many ? "deleteMany" : "deleteOne"]: input.filter,
  };
}

function buildRedisMutationCommand(input: AiKeyValueMutationInput) {
  if (input.operation === "set") {
    const key = input.key?.trim();
    if (!key) {
      throw new Error("key is required");
    }
    const value = redisValueLiteral(input.value);
    const parts = ["SET", redisArg(key), redisArg(value)];
    if (input.ttlSeconds) {
      parts.push("EX", String(input.ttlSeconds));
    }
    return parts.join(" ");
  }

  const keys = input.keys?.map((key) => key.trim()).filter(Boolean) ?? [];
  if (keys.length === 0) {
    throw new Error("keys is required");
  }
  return ["DEL", ...keys.map(redisArg)].join(" ");
}

function redisValueLiteral(value: unknown) {
  if (value === undefined) {
    throw new Error("value is required");
  }
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("value is not serializable");
  }
  return serialized;
}

function redisArg(value: string) {
  return /^[^\s"'\\;#]+$/.test(value) ? value : JSON.stringify(value);
}

function buildElasticsearchMutationRequest(input: AiSearchDocumentMutationInput) {
  const index = pathSegment(input.index);
  const id = input.id?.trim() || null;

  if (input.operation === "index") {
    if (!input.document) {
      throw new Error("document is required");
    }
    const body = JSON.stringify(input.document);
    if (id) {
      return `PUT /${index}/_doc/${pathSegment(id)}\n${body}`;
    }
    return `POST /${index}/_doc\n${body}`;
  }

  if (!id) {
    throw new Error("id is required");
  }

  if (input.operation === "update") {
    if (!input.document) {
      throw new Error("document is required");
    }
    return [
      `POST /${index}/_update/${pathSegment(id)}`,
      JSON.stringify({
        doc: input.document,
        ...(input.upsert ? { doc_as_upsert: true } : {}),
      }),
    ].join("\n");
  }

  return `DELETE /${index}/_doc/${pathSegment(id)}`;
}

function pathSegment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("path segment is required");
  }
  return encodeURIComponent(trimmed);
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
