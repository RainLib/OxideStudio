import type {
  AiToolAdapters,
  AiToolDefinition,
  AiToolExecutionContext,
} from "./types";
import type { AiToolRegistry } from "./registry";
import type { AiToolFamily } from "./families";
import {
  describeAiToolFamilyAvailability,
  mergeAiToolFamilies,
  registerAiToolFamilies,
} from "./families";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
  TableRowDelete,
  TableRowUpdate,
} from "@/services/tauri/types";
import { evaluateSqlExecutionIntent } from "@/lib/sqlExecutionGate";
import {
  supportedDatabaseDriverProfiles,
  supportsLspLanguageId,
} from "@/lib/databaseDialect";
import { listRegisteredDatabaseProviders } from "@/providers";
import { buildRedisGetCommand } from "./nativeMutationBuilders";

const DEFAULT_QUERY_LIMIT = 200;

export const CORE_AI_TOOL_FAMILIES: AiToolFamily[] = [
  {
    name: "connection",
    tools: [connectionListTool, connectionCapabilitiesTool],
  },
  {
    name: "provider.registry",
    tools: [providerListTool],
  },
  {
    name: "workspace",
    requiredAdapters: ["getActiveTab"],
    tools: [activeTabTool],
  },
  {
    name: "workspace.selection",
    requiredAdapters: ["getWorkspaceSelection"],
    tools: [workspaceSelectionTool],
  },
  {
    name: "editor.patch",
    requiredAdapters: ["proposeEditorPatch"],
    tools: [editorPatchTool],
  },
  {
    name: "metadata.collections",
    requiredAdapters: ["listCollections"],
    tools: [listCollectionsTool],
  },
  {
    name: "metadata.objects",
    requiredAdapters: ["listObjects"],
    tools: [listObjectsTool],
  },
  {
    name: "metadata.describe",
    requiredAdapters: ["describeObject"],
    tools: [describeObjectTool],
  },
  {
    name: "query.read",
    requiredAdapters: ["runReadOnlyQuery"],
    tools: [readOnlyQueryTool],
  },
  {
    name: "query.explain",
    requiredAdapters: ["explainQuery"],
    tools: [explainQueryTool],
  },
  {
    name: "query.write",
    requiredAdapters: ["runMutationQuery"],
    tools: [mutationQueryTool, destructiveQueryTool],
  },
  {
    name: "database.namespace",
    requiredAdapters: ["mutateNamespace"],
    tools: [createNamespaceTool, dropNamespaceTool],
  },
  {
    name: "table.rows",
    requiredAdapters: ["mutateTableRows"],
    tools: [insertTableRowsTool, updateTableRowsTool, deleteTableRowsTool],
  },
  {
    name: "document.mutations",
    requiredAdapters: ["mutateDocuments"],
    tools: [insertDocumentsTool, updateDocumentsTool, deleteDocumentsTool],
  },
  {
    name: "keyValue.read",
    requiredAdapters: ["runReadOnlyQuery"],
    tools: [getKeyValueTool],
  },
  {
    name: "keyValue.mutations",
    requiredAdapters: ["mutateKeyValues"],
    tools: [setKeyValueTool, deleteKeysTool],
  },
  {
    name: "search.mutations",
    requiredAdapters: ["mutateSearchDocuments"],
    tools: [
      indexSearchDocumentTool,
      updateSearchDocumentTool,
      deleteSearchDocumentTool,
    ],
  },
  {
    name: "lsp.completion",
    requiredAdapters: ["getLspCompletions"],
    tools: [lspCompletionsTool],
  },
  {
    name: "lsp.diagnostics",
    requiredAdapters: ["explainLspDiagnostics"],
    tools: [lspExplainDiagnosticsTool],
  },
];

export function registerCoreAiTools(
  registry: AiToolRegistry,
  adapters: AiToolAdapters,
  families: AiToolFamily[] = mergeAiToolFamilies(CORE_AI_TOOL_FAMILIES),
) {
  return registerAiToolFamilies(registry, adapters, families);
}

export function describeCoreAiToolEnvironment(
  adapters: AiToolAdapters,
  host: string,
  families: AiToolFamily[] = mergeAiToolFamilies(CORE_AI_TOOL_FAMILIES),
) {
  const availability = describeAiToolFamilyAvailability(families, adapters);

  return {
    host,
    enabledToolFamilies: availability
      .filter((family) => family.enabled)
      .map((family) => family.name),
    disabledToolFamilies: availability
      .filter((family) => !family.enabled)
      .map((family) => ({
        name: family.name,
        toolCount: family.toolCount,
        requiredAdapters: family.requiredAdapters,
        missingAdapters: family.missingAdapters,
      })),
  };
}

function connectionListTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "connection.list",
    description:
      "List saved database connections visible to the current workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["connection"],
    timeoutMs: 5_000,
    execute: async () => adapters.listConnections(),
  };
}

function connectionCapabilitiesTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "connection.capabilities",
    description: "Return driver capabilities for a database connection type.",
    inputSchema: {
      type: "object",
      properties: {
        driver: {
          type: "string",
          description:
            "Database driver id, for example postgres, mysql, redis, mongodb.",
        },
      },
      required: ["driver"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["connection", "metadata"],
    timeoutMs: 5_000,
    execute: async (input) => {
      const driver = assertObject(input).driver;
      if (typeof driver !== "string" || !driver.trim()) {
        throw new Error("driver is required");
      }
      return adapters.getConnectionCapabilities(driver);
    },
  };
}

function providerListTool(): AiToolDefinition {
  return {
    name: "provider.list",
    description:
      "List registered database providers and supported driver profiles available to the assistant.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["provider", "metadata"],
    timeoutMs: 5_000,
    execute: async () => {
      const driverProfiles = supportedDatabaseDriverProfiles();
      const supportedDrivers = new Set(
        driverProfiles.map((profile) => String(profile.driver)),
      );
      return {
        providers: listRegisteredDatabaseProviders().map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          priority: provider.priority ?? 0,
          activated: provider.activated,
          driverProfiles: (provider.driverProfiles ?? [])
            .filter((profile) => supportedDrivers.has(String(profile.driver)))
            .map((profile) => profile.driver),
          objectPreviewProviders: (provider.objectPreviewProviders ?? []).map(
            (previewProvider) => previewProvider.id,
          ),
          aiToolFamilies: (provider.aiToolFamilies ?? []).map(
            (family) => family.name,
          ),
        })),
        driverProfiles: driverProfiles.map((profile) => {
          const capabilities = {
            driver: profile.driver,
            ...profile.capabilities,
          } satisfies DatabaseCapabilities;
          return {
            driver: profile.driver,
            menuLabel: profile.menuLabel,
            displayName: profile.capabilities.displayName,
            dataModel: profile.capabilities.dataModel,
            lspLanguageId: profile.capabilities.lspLanguageId,
            namespaceLabel: profile.capabilities.namespaceLabel,
            defaultPort: profile.capabilities.defaultPort,
            capabilities,
            aiToolHints: aiToolHintsForCapabilities(capabilities),
          };
        }),
      };
    },
  };
}

function aiToolHintsForCapabilities(capabilities: DatabaseCapabilities) {
  const read = [
    "connection.capabilities",
    "metadata.listObjects",
    "metadata.describeObject",
    "query.runReadOnly",
  ];
  const metadata = ["metadata.listObjects", "metadata.describeObject"];
  const write = ["query.runMutation"];
  const destructive = ["query.runDestructive"];
  const lsp: string[] = [];

  if (
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing
  ) {
    read.push("metadata.listCollections");
    metadata.push("metadata.listCollections");
  }

  if (capabilities.supportsCreateDatabase) {
    write.push("database.createNamespace");
    destructive.push("database.dropNamespace");
  }

  if (capabilities.supportsTableBrowsing) {
    write.push("table.insertRows", "table.updateRows");
    destructive.push("table.deleteRows");
  }

  if (capabilities.dataModel === "document") {
    write.push("document.insertDocuments", "document.updateDocuments");
    destructive.push("document.deleteDocuments");
  } else if (capabilities.dataModel === "keyValue") {
    read.push("key.getValue");
    write.push("key.setValue");
    destructive.push("key.deleteKeys");
  } else if (capabilities.dataModel === "search") {
    write.push("search.indexDocument", "search.updateDocument");
    destructive.push("search.deleteDocument");
  }

  if (supportsLspLanguageId(capabilities.driver)) {
    lsp.push("lsp.getCompletions", "lsp.explainDiagnostics");
    read.push(...lsp);
  }

  if (capabilities.supportsExplainPlan) {
    read.push("query.explain");
  }

  return {
    read: uniqueToolNames(read),
    metadata: uniqueToolNames(metadata),
    write: uniqueToolNames(write),
    destructive: uniqueToolNames(destructive),
    lsp: uniqueToolNames(lsp),
  };
}

function uniqueToolNames(names: string[]) {
  return Array.from(new Set(names));
}

function activeTabTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "workspace.getActiveTab",
    description:
      "Return the active editor tab metadata and current query text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    timeoutMs: 5_000,
    execute: async () => adapters.getActiveTab?.() ?? null,
  };
}

function workspaceSelectionTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "workspace.getSelection",
    description:
      "Return the current editor selection for the active workspace tab.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    timeoutMs: 5_000,
    execute: async () => adapters.getWorkspaceSelection?.() ?? null,
  };
}

function editorPatchTool(adapters: AiToolAdapters): AiToolDefinition {
  const positionProperties = {
    startLine: { type: "integer", description: "One-based start line." },
    startColumn: { type: "integer", description: "One-based start column." },
    endLine: { type: "integer", description: "One-based end line." },
    endColumn: { type: "integer", description: "One-based end column." },
  };
  return {
    name: "editor.proposePatch",
    description:
      "Create a revision-bound before/after patch preview for the active SQL editor. This never edits the document; the user must open and apply the preview.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "Defaults to the active tab." },
        range: {
          type: "object",
          properties: positionProperties,
          required: ["startLine", "startColumn", "endLine", "endColumn"],
          additionalProperties: false,
          description:
            "Optional one-based replacement range. Defaults to the current selection, then the whole document.",
        },
        replacement: {
          type: "string",
          description: "Exact replacement text. An empty string proposes deletion.",
        },
        title: { type: "string", description: "Short review title." },
        rationale: { type: "string", description: "Why this patch is proposed." },
      },
      required: ["replacement"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    timeoutMs: 5_000,
    resultLimit: { maxRows: 1, maxBytes: 450_000 },
    execute: async (input, context) => {
      const payload = assertObject(input);
      const replacement = payload.replacement;
      if (typeof replacement !== "string") {
        throw new Error("replacement is required");
      }
      return adapters.proposeEditorPatch?.(
        {
          tabId: optionalString(payload, "tabId"),
          range:
            payload.range && typeof payload.range === "object"
              ? (payload.range as {
                  startLine: number;
                  startColumn: number;
                  endLine: number;
                  endColumn: number;
                })
              : null,
          replacement,
          title: optionalString(payload, "title"),
          rationale: optionalString(payload, "rationale"),
        },
        context,
      );
    },
  };
}

function listCollectionsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "metadata.listCollections",
    description:
      "List document collections, search indexes, or analogous objects.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description:
            "Database, schema, or namespace. Defaults to the active namespace.",
        },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["metadata"],
    timeoutMs: 10_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.listCollections?.(
        {
          connectionId:
            typeof payload.connectionId === "string"
              ? payload.connectionId
              : null,
          namespace:
            typeof payload.namespace === "string" ? payload.namespace : null,
        },
        context,
      );
    },
  };
}

function listObjectsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "metadata.listObjects",
    description:
      "List tables, collections, indexes, keys, or analogous objects.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description:
            "Database, schema, or namespace. Defaults to the active namespace.",
        },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["metadata"],
    timeoutMs: 10_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.listObjects?.(
        {
          connectionId:
            typeof payload.connectionId === "string"
              ? payload.connectionId
              : null,
          namespace:
            typeof payload.namespace === "string" ? payload.namespace : null,
        },
        context,
      );
    },
  };
}

function describeObjectTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "metadata.describeObject",
    description:
      "Describe a table, collection, index, or key in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description:
            "Database, schema, or namespace. Defaults to the active namespace.",
        },
        name: {
          type: "string",
          description:
            "Object name, for example a table, collection, index, or key.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["metadata"],
    timeoutMs: 10_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      const name = payload.name;
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name is required");
      }

      return adapters.describeObject?.(
        {
          connectionId:
            typeof payload.connectionId === "string"
              ? payload.connectionId
              : null,
          namespace:
            typeof payload.namespace === "string" ? payload.namespace : null,
          name,
        },
        context,
      );
    },
  };
}

function readOnlyQueryTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "query.runReadOnly",
    description:
      "Run a bounded read-only request. Use SELECT for SQL, MongoDB read-command JSON, Redis read commands, or Elasticsearch JSON/Kibana syntax such as POST index/_search followed by a DSL body.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        query: {
          type: "string",
          description:
            "SQL SELECT, MongoDB read-command JSON, Redis read command, or Elasticsearch JSON/Kibana-style read request.",
        },
        namespace: {
          type: "string",
          description:
            "Optional schema, database, Redis DB, or Elasticsearch index context.",
        },
        limit: {
          type: "number",
          description: "Maximum rows requested by the assistant.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    resultLimit: {
      maxRows: DEFAULT_QUERY_LIMIT,
      maxBytes: 250_000,
    },
    execute: async (input, context) => {
      const payload = assertObject(input);
      const query = payload.query;
      if (typeof query !== "string" || !query.trim()) {
        throw new Error("query is required");
      }
      const connectionId =
        typeof payload.connectionId === "string"
          ? payload.connectionId
          : (context.activeConnectionId ?? null);
      const driver = await resolveQueryDriver(
        adapters,
        connectionId,
        context.activeDriver,
      );

      const gate = evaluateSqlExecutionIntent({
        sql: query,
        driver,
        intent: "read",
        approved: true,
      });
      if (!gate.allowed) {
        throw new Error(`query.runReadOnly rejected request: ${gate.reason}`);
      }

      const namespace = optionalString(payload, "namespace");
      return adapters.runReadOnlyQuery?.(
        {
          connectionId,
          ...(namespace ? { namespace } : {}),
          query,
          limit:
            typeof payload.limit === "number"
              ? Math.min(payload.limit, DEFAULT_QUERY_LIMIT)
              : DEFAULT_QUERY_LIMIT,
        },
        context,
      );
    },
  };
}

function explainQueryTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "query.explain",
    description:
      "Generate an estimated, read-only execution plan for one PostgreSQL or MySQL query. This never runs EXPLAIN ANALYZE.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        query: {
          type: "string",
          description: "One SELECT, TABLE, or VALUES query to explain.",
        },
        namespace: {
          type: "string",
          description: "Optional schema context.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      const query = requireString(payload, "query");
      const connectionId =
        optionalString(payload, "connectionId") ??
        context.activeConnectionId ??
        null;
      const driver = await resolveQueryDriver(
        adapters,
        connectionId,
        context.activeDriver,
      );
      if (!driver) throw new Error("A connection driver is required");
      const capabilities = await adapters.getConnectionCapabilities(driver);
      if (!capabilities.supportsExplainPlan) {
        throw new Error(
          `${capabilities.displayName} does not support Explain Plan`,
        );
      }
      return adapters.explainQuery?.(
        {
          connectionId,
          namespace: optionalString(payload, "namespace"),
          query,
        },
        context,
      );
    },
  };
}

function mutationQueryTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "query.runMutation",
    description:
      "Run a non-destructive database mutation after explicit approval.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        query: {
          type: "string",
          description: "Mutation query or driver-native write request.",
        },
        namespace: {
          type: "string",
          description:
            "Optional schema, database, Redis DB, or Elasticsearch index context.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) =>
      runApprovedMutation(adapters, input, context, "write"),
  };
}

function destructiveQueryTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "query.runDestructive",
    description:
      "Run a destructive database operation after explicit approval.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        query: {
          type: "string",
          description: "Destructive query or driver-native request.",
        },
        namespace: {
          type: "string",
          description:
            "Optional schema, database, Redis DB, or Elasticsearch index context.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) =>
      runApprovedMutation(adapters, input, context, "destructive"),
  };
}

function createNamespaceTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "database.createNamespace",
    description: "Create a database or schema after explicit approval.",
    inputSchema: namespaceMutationSchema(false),
    permissions: ["write"],
    capabilities: ["metadata"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.mutateNamespace?.(
        {
          operation: "create",
          connectionId: optionalString(payload, "connectionId"),
          namespace: requireString(payload, "namespace"),
          charset: optionalString(payload, "charset"),
          collation: optionalString(payload, "collation"),
        },
        context,
      );
    },
  };
}

function dropNamespaceTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "database.dropNamespace",
    description: "Drop a database or schema after explicit approval.",
    inputSchema: namespaceMutationSchema(true),
    permissions: ["destructive"],
    capabilities: ["metadata"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.mutateNamespace?.(
        {
          operation: "drop",
          connectionId: optionalString(payload, "connectionId"),
          namespace: requireString(payload, "namespace"),
          cascade: optionalBoolean(payload, "cascade") ?? false,
        },
        context,
      );
    },
  };
}

function insertTableRowsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "table.insertRows",
    description: "Insert rows into a table after explicit approval.",
    inputSchema: tableInsertRowsSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = tableMutationPayload(input);
      const inserts = requireRecordArray(assertObject(input), "inserts");
      return adapters.mutateTableRows?.(
        {
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          table: payload.table,
          inserts,
        },
        context,
      );
    },
  };
}

function updateTableRowsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "table.updateRows",
    description: "Update rows in a table after explicit approval.",
    inputSchema: tableUpdateRowsSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = tableMutationPayload(input);
      const updates = requireTableUpdates(assertObject(input));
      return adapters.mutateTableRows?.(
        {
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          table: payload.table,
          updates,
        },
        context,
      );
    },
  };
}

function deleteTableRowsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "table.deleteRows",
    description: "Delete rows from a table after explicit approval.",
    inputSchema: tableDeleteRowsSchema(),
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = tableMutationPayload(input);
      const deletes = requireTableDeletes(assertObject(input));
      return adapters.mutateTableRows?.(
        {
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          table: payload.table,
          deletes,
        },
        context,
      );
    },
  };
}

function insertDocumentsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "document.insertDocuments",
    description:
      "Insert documents into a document collection after explicit approval.",
    inputSchema: documentInsertSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = documentMutationPayload(input);
      return adapters.mutateDocuments?.(
        {
          operation: "insert",
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          collection: payload.collection,
          documents: requireRecordArray(assertObject(input), "documents"),
        },
        context,
      );
    },
  };
}

function updateDocumentsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "document.updateDocuments",
    description: "Update matching documents after explicit approval.",
    inputSchema: documentUpdateSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = documentMutationPayload(input);
      const raw = assertObject(input);
      return adapters.mutateDocuments?.(
        {
          operation: "update",
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          collection: payload.collection,
          filter: requireRecordField(raw, "filter"),
          update: requireRecordField(raw, "update"),
          many: optionalBoolean(raw, "many") ?? false,
          upsert: optionalBoolean(raw, "upsert") ?? false,
        },
        context,
      );
    },
  };
}

function deleteDocumentsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "document.deleteDocuments",
    description: "Delete matching documents after explicit approval.",
    inputSchema: documentDeleteSchema(),
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = documentMutationPayload(input);
      const raw = assertObject(input);
      return adapters.mutateDocuments?.(
        {
          operation: "delete",
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          collection: payload.collection,
          filter: requireRecordField(raw, "filter"),
          many: optionalBoolean(raw, "many") ?? false,
        },
        context,
      );
    },
  };
}

function getKeyValueTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "key.getValue",
    description: "Read a Redis key value from a key-value connection.",
    inputSchema: keyGetSchema(),
    permissions: ["read"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    resultLimit: {
      maxRows: 1,
      maxBytes: 100_000,
    },
    execute: async (input, context) => {
      const raw = assertObject(input);
      const connectionId =
        optionalString(raw, "connectionId") ??
        context.activeConnectionId ??
        null;
      const driver = await resolveQueryDriver(
        adapters,
        connectionId,
        context.activeDriver,
      );
      if (!driver) {
        throw new Error("Connection driver is required for key.getValue");
      }
      const capabilities = await adapters.getConnectionCapabilities(driver);
      if (capabilities.dataModel !== "keyValue") {
        throw new Error(
          `${capabilities.displayName} does not support key-value reads`,
        );
      }
      const namespace = optionalString(raw, "namespace");
      return adapters.runReadOnlyQuery?.(
        {
          connectionId,
          ...(namespace ? { namespace } : {}),
          query: buildRedisGetCommand(requireString(raw, "key")),
          limit: 1,
        },
        context,
      );
    },
  };
}

function setKeyValueTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "key.setValue",
    description: "Set a key-value entry after explicit approval.",
    inputSchema: keySetSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateKeyValues?.(
        {
          operation: "set",
          connectionId: optionalString(raw, "connectionId"),
          namespace: optionalString(raw, "namespace"),
          key: requireString(raw, "key"),
          value: requirePresent(raw, "value"),
          ttlSeconds: optionalPositiveInteger(raw, "ttlSeconds"),
        },
        context,
      );
    },
  };
}

function deleteKeysTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "key.deleteKeys",
    description: "Delete one or more keys after explicit approval.",
    inputSchema: keyDeleteSchema(),
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateKeyValues?.(
        {
          operation: "delete",
          connectionId: optionalString(raw, "connectionId"),
          namespace: optionalString(raw, "namespace"),
          keys: requireStringArray(raw, "keys"),
        },
        context,
      );
    },
  };
}

function indexSearchDocumentTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "search.indexDocument",
    description:
      "Index or replace an Elasticsearch document after explicit approval.",
    inputSchema: searchIndexSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateSearchDocuments?.(
        {
          operation: "index",
          connectionId: optionalString(raw, "connectionId"),
          index: requireString(raw, "index"),
          id: optionalString(raw, "id"),
          document: requireRecordField(raw, "document"),
        },
        context,
      );
    },
  };
}

function updateSearchDocumentTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "search.updateDocument",
    description:
      "Partially update an Elasticsearch document after explicit approval.",
    inputSchema: searchUpdateSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateSearchDocuments?.(
        {
          operation: "update",
          connectionId: optionalString(raw, "connectionId"),
          index: requireString(raw, "index"),
          id: requireString(raw, "id"),
          document: requireRecordField(raw, "document"),
          upsert: optionalBoolean(raw, "upsert") ?? false,
        },
        context,
      );
    },
  };
}

function deleteSearchDocumentTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "search.deleteDocument",
    description: "Delete an Elasticsearch document after explicit approval.",
    inputSchema: searchDeleteSchema(),
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateSearchDocuments?.(
        {
          operation: "delete",
          connectionId: optionalString(raw, "connectionId"),
          index: requireString(raw, "index"),
          id: requireString(raw, "id"),
        },
        context,
      );
    },
  };
}

function lspCompletionsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "lsp.getCompletions",
    description: "Return LSP completions for a document position.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        uri: {
          type: "string",
          description:
            "Optional document URI. Defaults to the active query tab URI.",
        },
        text: {
          type: "string",
          description:
            "Optional document text. Defaults to the active query text.",
        },
        line: {
          type: "number",
          description: "Zero-based line number.",
        },
        character: {
          type: "number",
          description: "Zero-based character offset.",
        },
        languageId: {
          type: "string",
          description:
            "Optional LSP language id. Defaults to the active driver dialect.",
        },
      },
      required: ["line", "character"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["lsp"],
    timeoutMs: 10_000,
    resultLimit: {
      maxRows: 100,
      maxBytes: 100_000,
    },
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.getLspCompletions?.(
        {
          connectionId: optionalString(payload, "connectionId"),
          uri: optionalString(payload, "uri"),
          text: typeof payload.text === "string" ? payload.text : null,
          line: requireNonNegativeInteger(payload, "line"),
          character: requireNonNegativeInteger(payload, "character"),
          languageId: optionalString(payload, "languageId"),
        },
        context,
      );
    },
  };
}

function lspExplainDiagnosticsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "lsp.explainDiagnostics",
    description: "Explain current LSP diagnostics for the active editor tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "string",
          description: "Optional tab id. Defaults to the active tab.",
        },
        uri: {
          type: "string",
          description: "Optional LSP document URI.",
        },
        onlySelection: {
          type: "boolean",
          description:
            "When true, only include diagnostics overlapping the current selection.",
        },
        severity: {
          type: "string",
          enum: ["error", "warning", "information", "hint"],
          description: "Optional severity filter.",
        },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["lsp"],
    timeoutMs: 5_000,
    resultLimit: {
      maxRows: 100,
      maxBytes: 100_000,
    },
    execute: async (input, context) => {
      const payload = assertObject(input);
      const severity = optionalString(payload, "severity");
      if (
        severity &&
        !["error", "warning", "information", "hint"].includes(severity)
      ) {
        throw new Error(
          "severity must be error, warning, information, or hint",
        );
      }

      return adapters.explainLspDiagnostics?.(
        {
          tabId: optionalString(payload, "tabId"),
          uri: optionalString(payload, "uri"),
          onlySelection: optionalBoolean(payload, "onlySelection") ?? false,
          severity: severity as
            "error" | "warning" | "information" | "hint" | null,
        },
        context,
      );
    },
  };
}

function assertObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function namespaceMutationSchema(includeCascade: boolean) {
  return {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Connection id. Defaults to the active connection.",
      },
      namespace: {
        type: "string",
        description: "Database or schema name.",
      },
      ...(includeCascade
        ? {
            cascade: {
              type: "boolean",
              description: "When true, drop dependent objects where supported.",
            },
          }
        : {
            charset: {
              type: "string",
              description:
                "Optional charset for database engines that support it.",
            },
            collation: {
              type: "string",
              description:
                "Optional collation for database engines that support it.",
            },
          }),
    },
    required: ["namespace"],
    additionalProperties: false,
  };
}

function tableMutationBaseProperties() {
  return {
    connectionId: {
      type: "string",
      description: "Connection id. Defaults to the active connection.",
    },
    namespace: {
      type: "string",
      description: "Schema or database. Defaults to the active namespace.",
    },
    table: {
      type: "string",
      description: "Target table name.",
    },
  };
}

function tableInsertRowsSchema() {
  return {
    type: "object",
    properties: {
      ...tableMutationBaseProperties(),
      inserts: {
        type: "array",
        description: "Rows to insert as column/value objects.",
        items: { type: "object", additionalProperties: true },
      },
    },
    required: ["table", "inserts"],
    additionalProperties: false,
  };
}

function tableUpdateRowsSchema() {
  return {
    type: "object",
    properties: {
      ...tableMutationBaseProperties(),
      updates: {
        type: "array",
        description:
          "Rows to update. Each item must include primary-key values and changed column values.",
        items: {
          type: "object",
          properties: {
            key: {
              type: "object",
              description: "Primary-key column values identifying the row.",
              additionalProperties: true,
            },
            values: {
              type: "object",
              description: "Column values to set.",
              additionalProperties: true,
            },
          },
          required: ["key", "values"],
          additionalProperties: false,
        },
      },
    },
    required: ["table", "updates"],
    additionalProperties: false,
  };
}

function tableDeleteRowsSchema() {
  return {
    type: "object",
    properties: {
      ...tableMutationBaseProperties(),
      deletes: {
        type: "array",
        description:
          "Rows to delete. Each item must include primary-key values.",
        items: {
          type: "object",
          properties: {
            key: {
              type: "object",
              description: "Primary-key column values identifying the row.",
              additionalProperties: true,
            },
          },
          required: ["key"],
          additionalProperties: false,
        },
      },
    },
    required: ["table", "deletes"],
    additionalProperties: false,
  };
}

function tableMutationPayload(input: unknown) {
  const payload = assertObject(input);
  const table = payload.table;
  if (typeof table !== "string" || !table.trim()) {
    throw new Error("table is required");
  }

  return {
    connectionId:
      typeof payload.connectionId === "string" ? payload.connectionId : null,
    namespace: typeof payload.namespace === "string" ? payload.namespace : null,
    table,
  };
}

function documentBaseProperties() {
  return {
    connectionId: {
      type: "string",
      description: "Connection id. Defaults to the active connection.",
    },
    namespace: {
      type: "string",
      description: "MongoDB database. Defaults to the active namespace.",
    },
    collection: {
      type: "string",
      description: "Target collection name.",
    },
  };
}

function documentInsertSchema() {
  return {
    type: "object",
    properties: {
      ...documentBaseProperties(),
      documents: {
        type: "array",
        description: "Documents to insert.",
        items: { type: "object", additionalProperties: true },
      },
    },
    required: ["collection", "documents"],
    additionalProperties: false,
  };
}

function documentUpdateSchema() {
  return {
    type: "object",
    properties: {
      ...documentBaseProperties(),
      filter: {
        type: "object",
        description: "MongoDB filter selecting documents to update.",
        additionalProperties: true,
      },
      update: {
        type: "object",
        description: "MongoDB update document, for example {$set:{...}}.",
        additionalProperties: true,
      },
      many: {
        type: "boolean",
        description: "When true, update all matching documents.",
      },
      upsert: {
        type: "boolean",
        description: "When true, insert when no document matches.",
      },
    },
    required: ["collection", "filter", "update"],
    additionalProperties: false,
  };
}

function documentDeleteSchema() {
  return {
    type: "object",
    properties: {
      ...documentBaseProperties(),
      filter: {
        type: "object",
        description: "MongoDB filter selecting documents to delete.",
        additionalProperties: true,
      },
      many: {
        type: "boolean",
        description: "When true, delete all matching documents.",
      },
    },
    required: ["collection", "filter"],
    additionalProperties: false,
  };
}

function keyGetSchema() {
  return {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Connection id. Defaults to the active connection.",
      },
      namespace: {
        type: "string",
        description: "Redis database index. Defaults to the active namespace.",
      },
      key: {
        type: "string",
        description: "Redis key.",
      },
    },
    required: ["key"],
    additionalProperties: false,
  };
}

function keySetSchema() {
  return {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Connection id. Defaults to the active connection.",
      },
      namespace: {
        type: "string",
        description: "Redis database index. Defaults to the active namespace.",
      },
      key: {
        type: "string",
        description: "Redis key.",
      },
      value: {
        description:
          "Value to store. Objects and arrays are serialized as JSON.",
      },
      ttlSeconds: {
        type: "number",
        description: "Optional positive TTL in seconds.",
      },
    },
    required: ["key", "value"],
    additionalProperties: false,
  };
}

function keyDeleteSchema() {
  return {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Connection id. Defaults to the active connection.",
      },
      namespace: {
        type: "string",
        description: "Redis database index. Defaults to the active namespace.",
      },
      keys: {
        type: "array",
        description: "Redis keys to delete.",
        items: { type: "string" },
      },
    },
    required: ["keys"],
    additionalProperties: false,
  };
}

function searchBaseProperties() {
  return {
    connectionId: {
      type: "string",
      description: "Connection id. Defaults to the active connection.",
    },
    index: {
      type: "string",
      description: "Elasticsearch index name.",
    },
  };
}

function searchIndexSchema() {
  return {
    type: "object",
    properties: {
      ...searchBaseProperties(),
      id: {
        type: "string",
        description:
          "Optional document id. Omit to let Elasticsearch generate one.",
      },
      document: {
        type: "object",
        description: "Document body to index.",
        additionalProperties: true,
      },
    },
    required: ["index", "document"],
    additionalProperties: false,
  };
}

function searchUpdateSchema() {
  return {
    type: "object",
    properties: {
      ...searchBaseProperties(),
      id: {
        type: "string",
        description: "Document id.",
      },
      document: {
        type: "object",
        description: "Partial document fields to update.",
        additionalProperties: true,
      },
      upsert: {
        type: "boolean",
        description: "When true, create the document if it does not exist.",
      },
    },
    required: ["index", "id", "document"],
    additionalProperties: false,
  };
}

function searchDeleteSchema() {
  return {
    type: "object",
    properties: {
      ...searchBaseProperties(),
      id: {
        type: "string",
        description: "Document id.",
      },
    },
    required: ["index", "id"],
    additionalProperties: false,
  };
}

function documentMutationPayload(input: unknown) {
  const payload = assertObject(input);
  return {
    connectionId: optionalString(payload, "connectionId"),
    namespace: optionalString(payload, "namespace"),
    collection: requireString(payload, "collection"),
  };
}

function requireRecordArray(
  payload: Record<string, unknown>,
  field: string,
): Array<Record<string, unknown>> {
  const value = payload[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  if (!value.every(isRecord)) {
    throw new Error(`${field} must contain objects`);
  }
  return value;
}

function requireTableUpdates(
  payload: Record<string, unknown>,
): TableRowUpdate[] {
  const updates = requireRecordArray(payload, "updates");
  return updates.map((update, index) => {
    if (!isRecord(update.key) || Object.keys(update.key).length === 0) {
      throw new Error(`updates[${index}].key is required`);
    }
    if (!isRecord(update.values) || Object.keys(update.values).length === 0) {
      throw new Error(`updates[${index}].values is required`);
    }
    return { key: update.key, values: update.values };
  });
}

function requireTableDeletes(
  payload: Record<string, unknown>,
): TableRowDelete[] {
  const deletes = requireRecordArray(payload, "deletes");
  return deletes.map((row, index) => {
    if (!isRecord(row.key) || Object.keys(row.key).length === 0) {
      throw new Error(`deletes[${index}].key is required`);
    }
    return { key: row.key };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireRecordField(
  payload: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = payload[field];
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireString(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function requireStringArray(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`${field} must contain one or more strings`);
  }
  return value;
}

function requirePresent(payload: Record<string, unknown>, field: string) {
  if (!Object.prototype.hasOwnProperty.call(payload, field)) {
    throw new Error(`${field} is required`);
  }
  return payload[field];
}

function optionalBoolean(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  return typeof value === "boolean" ? value : undefined;
}

function optionalPositiveInteger(
  payload: Record<string, unknown>,
  field: string,
) {
  const value = payload[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return Math.floor(value);
}

function requireNonNegativeInteger(
  payload: Record<string, unknown>,
  field: string,
) {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return Math.floor(value);
}

async function runApprovedMutation(
  adapters: AiToolAdapters,
  input: unknown,
  context: AiToolExecutionContext,
  mode: "write" | "destructive",
) {
  const payload = assertObject(input);
  const query = payload.query;
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("query is required");
  }

  const connectionId =
    typeof payload.connectionId === "string"
      ? payload.connectionId
      : (context.activeConnectionId ?? null);
  const driver = await resolveQueryDriver(
    adapters,
    connectionId,
    context.activeDriver,
  );
  const gate = evaluateSqlExecutionIntent({
    sql: query,
    driver,
    intent: mode,
    approved: true,
  });
  if (!gate.allowed) {
    throw new Error(
      `${mode === "write" ? "query.runMutation" : "query.runDestructive"} rejected request: ${gate.reason}`,
    );
  }

  const namespace = optionalString(payload, "namespace");
  return adapters.runMutationQuery?.(
    {
      connectionId,
      ...(namespace ? { namespace } : {}),
      query,
    },
    context,
  );
}

async function resolveQueryDriver(
  adapters: AiToolAdapters,
  connectionId: string | null,
  activeDriver?: DatabaseDriver | null,
) {
  if (!connectionId) return activeDriver ?? null;

  const connections = await adapters.listConnections();
  return (
    connections.find((connection) => connection.id === connectionId)?.driver ??
    activeDriver ??
    null
  );
}
