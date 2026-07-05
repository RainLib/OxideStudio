import type {
  AiToolAdapters,
  AiToolDefinition,
  AiToolExecutionContext,
} from "./types";
import type { AiToolRegistry } from "./registry";
import type {
  DatabaseDriver,
  TableRowDelete,
  TableRowUpdate,
} from "@/services/tauri/types";

const DEFAULT_QUERY_LIMIT = 200;

export function registerCoreAiTools(
  registry: AiToolRegistry,
  adapters: AiToolAdapters
) {
  registry.register(connectionListTool(adapters));
  registry.register(connectionCapabilitiesTool(adapters));

  if (adapters.getActiveTab) {
    registry.register(activeTabTool(adapters));
  }

  if (adapters.listCollections) {
    registry.register(listCollectionsTool(adapters));
  }

  if (adapters.listObjects) {
    registry.register(listObjectsTool(adapters));
  }

  if (adapters.describeObject) {
    registry.register(describeObjectTool(adapters));
  }

  if (adapters.runReadOnlyQuery) {
    registry.register(readOnlyQueryTool(adapters));
  }

  if (adapters.runMutationQuery) {
    registry.register(mutationQueryTool(adapters));
    registry.register(destructiveQueryTool(adapters));
  }

  if (adapters.mutateTableRows) {
    registry.register(insertTableRowsTool(adapters));
    registry.register(updateTableRowsTool(adapters));
    registry.register(deleteTableRowsTool(adapters));
  }

  return registry;
}

function connectionListTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "connection.list",
    description: "List saved database connections visible to the current workspace.",
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

function connectionCapabilitiesTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "connection.capabilities",
    description: "Return driver capabilities for a database connection type.",
    inputSchema: {
      type: "object",
      properties: {
        driver: {
          type: "string",
          description: "Database driver id, for example postgres, mysql, redis, mongodb.",
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

function activeTabTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "workspace.getActiveTab",
    description: "Return the active editor tab metadata and current query text.",
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

function listCollectionsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "metadata.listCollections",
    description: "List document collections, search indexes, or analogous objects.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description: "Database, schema, or namespace. Defaults to the active namespace.",
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
            typeof payload.connectionId === "string" ? payload.connectionId : null,
          namespace: typeof payload.namespace === "string" ? payload.namespace : null,
        },
        context
      );
    },
  };
}

function listObjectsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "metadata.listObjects",
    description: "List tables, collections, indexes, keys, or analogous objects.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description: "Database, schema, or namespace. Defaults to the active namespace.",
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
            typeof payload.connectionId === "string" ? payload.connectionId : null,
          namespace: typeof payload.namespace === "string" ? payload.namespace : null,
        },
        context
      );
    },
  };
}

function describeObjectTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "metadata.describeObject",
    description: "Describe a table, collection, index, or key in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description: "Database, schema, or namespace. Defaults to the active namespace.",
        },
        name: {
          type: "string",
          description: "Object name, for example a table, collection, index, or key.",
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
            typeof payload.connectionId === "string" ? payload.connectionId : null,
          namespace: typeof payload.namespace === "string" ? payload.namespace : null,
          name,
        },
        context
      );
    },
  };
}

function readOnlyQueryTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "query.runReadOnly",
    description: "Run a bounded read-only query or driver-native read request.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        query: {
          type: "string",
          description: "Query or driver-native request body.",
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
          : context.activeConnectionId ?? null;
      const driver = await resolveQueryDriver(adapters, connectionId, context.activeDriver);

      if (!looksReadOnly(query, driver)) {
        throw new Error("query.runReadOnly rejected a potentially mutating request");
      }

      return adapters.runReadOnlyQuery?.(
        {
          connectionId,
          query,
          limit:
            typeof payload.limit === "number"
              ? Math.min(payload.limit, DEFAULT_QUERY_LIMIT)
              : DEFAULT_QUERY_LIMIT,
        },
        context
      );
    },
  };
}

function mutationQueryTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "query.runMutation",
    description: "Run a non-destructive database mutation after explicit approval.",
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
    description: "Run a destructive database operation after explicit approval.",
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
        context
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
        context
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
        context
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
        description: "Rows to update. Each item must include primary-key values and changed column values.",
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
        description: "Rows to delete. Each item must include primary-key values.",
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

function requireRecordArray(
  payload: Record<string, unknown>,
  field: string
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

function requireTableUpdates(payload: Record<string, unknown>): TableRowUpdate[] {
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

function requireTableDeletes(payload: Record<string, unknown>): TableRowDelete[] {
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

async function runApprovedMutation(
  adapters: AiToolAdapters,
  input: unknown,
  context: AiToolExecutionContext,
  mode: "write" | "destructive"
) {
  const payload = assertObject(input);
  const query = payload.query;
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("query is required");
  }

  const connectionId =
    typeof payload.connectionId === "string"
      ? payload.connectionId
      : context.activeConnectionId ?? null;
  const driver = await resolveQueryDriver(adapters, connectionId, context.activeDriver);
  const safety = classifyQuerySafety(query, driver);

  if (safety === "read") {
    throw new Error("Mutation tools do not run read-only requests");
  }
  if (mode === "write" && safety === "destructive") {
    throw new Error("query.runMutation rejected a destructive request");
  }
  if (mode === "destructive" && safety !== "destructive") {
    throw new Error("query.runDestructive only accepts destructive requests");
  }

  return adapters.runMutationQuery?.({ connectionId, query }, context);
}

async function resolveQueryDriver(
  adapters: AiToolAdapters,
  connectionId: string | null,
  activeDriver?: DatabaseDriver | null
) {
  if (!connectionId) return activeDriver ?? null;

  const connections = await adapters.listConnections();
  return (
    connections.find((connection) => connection.id === connectionId)?.driver ??
    activeDriver ??
    null
  );
}

function looksReadOnly(query: string, driver?: DatabaseDriver | null) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const normalizedDriver = String(driver || "").trim().toLowerCase();
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    if (normalizedDriver === "mongodb" || normalizedDriver === "mongo") {
      return looksReadOnlyMongoCommand(query);
    }
    return looksReadOnlyJsonSearchBody(query);
  }

  if (normalizedDriver === "redis") {
    return looksReadOnlyRedisCommands(query);
  }

  if (normalizedDriver === "elasticsearch" || normalizedDriver === "elastic") {
    return looksReadOnlyElasticsearchRequest(query);
  }

  const mutatingSqlPrefixes = [
    "alter",
    "call",
    "comment",
    "copy",
    "create",
    "delete",
    "drop",
    "grant",
    "insert",
    "load",
    "merge",
    "replace",
    "revoke",
    "set",
    "truncate",
    "update",
    "vacuum",
  ];

  return !mutatingSqlPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function classifyQuerySafety(
  query: string,
  driver?: DatabaseDriver | null
): "read" | "write" | "destructive" {
  if (looksReadOnly(query, driver)) return "read";
  if (looksDestructive(query, driver)) return "destructive";
  return "write";
}

function looksDestructive(query: string, driver?: DatabaseDriver | null) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const normalizedDriver = String(driver || "").trim().toLowerCase();
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    if (normalizedDriver === "mongodb" || normalizedDriver === "mongo") {
      return looksDestructiveMongoCommand(query);
    }
    return looksDestructiveJsonSearchBody(query);
  }

  if (normalizedDriver === "redis") {
    return looksDestructiveRedisCommands(query);
  }

  if (normalizedDriver === "elasticsearch" || normalizedDriver === "elastic") {
    return looksDestructiveElasticsearchRequest(query);
  }

  return ["delete", "drop", "truncate"].some((prefix) =>
    normalized.startsWith(prefix)
  );
}

function looksReadOnlyJsonSearchBody(query: string) {
  const normalized = query.toLowerCase();
  const mutatingMarkers = [
    '"delete"',
    '"delete_by_query"',
    '"doc"',
    '"index"',
    '"scripted_upsert"',
    '"update"',
    '"upsert"',
  ];
  return !mutatingMarkers.some((marker) => normalized.includes(marker));
}

function looksDestructiveJsonSearchBody(query: string) {
  const normalized = query.toLowerCase();
  return normalized.includes('"delete"') || normalized.includes('"delete_by_query"');
}

function looksReadOnlyMongoCommand(query: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    return false;
  }

  const commands = Array.isArray(parsed) ? parsed : [parsed];
  return commands.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const payload = item as Record<string, unknown>;
    const keys = Object.keys(payload).map((key) => key.toLowerCase());
    const operations = keys.filter((key) =>
      [
        "aggregate",
        "command",
        "countdocuments",
        "deletemany",
        "deleteone",
        "find",
        "insertmany",
        "insertone",
        "updatemany",
        "updateone",
      ].includes(key)
    );

    if (operations.length === 0) {
      return typeof payload.collection === "string";
    }
    if (operations.length > 1) return false;

    const operation = operations[0];
    if (!operation) return false;
    if (["find", "aggregate", "countdocuments"].includes(operation)) {
      return true;
    }
    if (operation !== "command") return false;

    const commandBody = payload.command;
    if (!commandBody || typeof commandBody !== "object" || Array.isArray(commandBody)) {
      return false;
    }
    const [commandName] = Object.keys(commandBody);
    return Boolean(commandName && READ_ONLY_MONGO_COMMANDS.has(commandName.toLowerCase()));
  });
}

function looksDestructiveMongoCommand(query: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    return false;
  }

  const commands = Array.isArray(parsed) ? parsed : [parsed];
  return commands.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const payload = item as Record<string, unknown>;
    const keys = Object.keys(payload).map((key) => key.toLowerCase());
    if (
      keys.some((key) =>
        [
          "collmod",
          "deleteone",
          "deletemany",
          "drop",
          "dropdatabase",
          "renamecollection",
        ].includes(key)
      )
    ) {
      return true;
    }

    const commandBody = payload.command;
    if (!commandBody || typeof commandBody !== "object" || Array.isArray(commandBody)) {
      return false;
    }
    const [commandName] = Object.keys(commandBody).map((key) => key.toLowerCase());
    return Boolean(
      commandName &&
        [
          "collmod",
          "delete",
          "drop",
          "dropdatabase",
          "dropindexes",
          "findandmodify",
          "renamecollection",
        ].includes(commandName)
    );
  });
}

const READ_ONLY_MONGO_COMMANDS = new Set([
  "aggregate",
  "buildinfo",
  "collstats",
  "count",
  "dbstats",
  "distinct",
  "explain",
  "find",
  "hello",
  "ismaster",
  "listcollections",
  "listdatabases",
  "listindexes",
  "ping",
  "serverstatus",
]);

function looksReadOnlyElasticsearchRequest(query: string) {
  const requestLines = query
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (requestLines.length === 0) return false;

  const parsedRequests = requestLines
    .map((line) => line.match(/^(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\S+)/i))
    .filter((match): match is RegExpMatchArray => Boolean(match));
  if (parsedRequests.length === 0) return false;

  return parsedRequests.every((match) => {
    const method = match[1]!.toUpperCase();
    const path = match[2]!.toLowerCase();
    if (method === "GET" || method === "HEAD") return true;
    if (method !== "POST") return false;
    return READ_ONLY_ELASTICSEARCH_POST_PATHS.some((pattern) => pattern.test(path));
  });
}

function looksDestructiveElasticsearchRequest(query: string) {
  const requestLines = query
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  return requestLines.some((line) => {
    const match = line.match(/^(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
    if (!match) return false;

    const method = match[1]!.toUpperCase();
    const path = match[2]!.toLowerCase();
    return (
      method === "DELETE" ||
      path.includes("_delete_by_query") ||
      path.includes("_close") ||
      path.includes("_forcemerge") ||
      path.includes("_shrink") ||
      path.includes("_split")
    );
  });
}

const READ_ONLY_ELASTICSEARCH_POST_PATHS = [
  /^\/_search(?:[/?#]|$)/,
  /^\/_msearch(?:[/?#]|$)/,
  /^\/_count(?:[/?#]|$)/,
  /^\/_sql(?:[/?#]|$)/,
  /^\/_eql\/search(?:[/?#]|$)/,
  /^\/_async_search(?:[/?#]|$)/,
  /^\/[^/]+\/_search(?:[/?#]|$)/,
  /^\/[^/]+\/_msearch(?:[/?#]|$)/,
  /^\/[^/]+\/_count(?:[/?#]|$)/,
];

function looksReadOnlyRedisCommands(query: string) {
  const commands = query
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;$/, ""))
    .filter((line) => line && !line.startsWith("#"));

  if (commands.length === 0) return false;

  return commands.every((line) => {
    const command = line.split(/\s+/)[0]?.toUpperCase();
    return Boolean(command && READ_ONLY_REDIS_COMMANDS.has(command));
  });
}

function looksDestructiveRedisCommands(query: string) {
  const commands = query
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;$/, ""))
    .filter((line) => line && !line.startsWith("#"));

  return commands.some((line) => {
    const command = line.split(/\s+/)[0]?.toUpperCase();
    return Boolean(command && DESTRUCTIVE_REDIS_COMMANDS.has(command));
  });
}

const READ_ONLY_REDIS_COMMANDS = new Set([
  "DBSIZE",
  "EXISTS",
  "FT.INFO",
  "FT.SEARCH",
  "GET",
  "GETRANGE",
  "HGET",
  "HGETALL",
  "HEXISTS",
  "HKEYS",
  "HLEN",
  "HMGET",
  "HSCAN",
  "HSTRLEN",
  "HVALS",
  "JSON.GET",
  "JSON.MGET",
  "KEYS",
  "LINDEX",
  "LLEN",
  "LRANGE",
  "MGET",
  "PING",
  "PTTL",
  "SCAN",
  "SCARD",
  "SISMEMBER",
  "SMEMBERS",
  "SRANDMEMBER",
  "SSCAN",
  "STRLEN",
  "TTL",
  "TYPE",
  "XINFO",
  "XLEN",
  "XRANGE",
  "XREAD",
  "XREVRANGE",
  "ZCARD",
  "ZCOUNT",
  "ZLEXCOUNT",
  "ZRANGE",
  "ZRANGEBYLEX",
  "ZRANGEBYSCORE",
  "ZRANK",
  "ZREVRANGE",
  "ZREVRANGEBYLEX",
  "ZREVRANGEBYSCORE",
  "ZREVRANK",
  "ZSCAN",
  "ZSCORE",
]);

const DESTRUCTIVE_REDIS_COMMANDS = new Set([
  "DEL",
  "DISCARD",
  "EVAL",
  "EVALSHA",
  "FLUSHALL",
  "FLUSHDB",
  "FT.DROPINDEX",
  "HDEL",
  "JSON.ARRPOP",
  "JSON.CLEAR",
  "JSON.DEL",
  "JSON.FORGET",
  "LPOP",
  "LTRIM",
  "MOVE",
  "PERSIST",
  "PEXPIRE",
  "PEXPIREAT",
  "RENAME",
  "RENAMENX",
  "RESTORE",
  "RPOP",
  "SPOP",
  "SREM",
  "UNLINK",
  "XDEL",
  "XTRIM",
  "ZPOPMAX",
  "ZPOPMIN",
  "ZREM",
  "ZREMRANGEBYLEX",
  "ZREMRANGEBYRANK",
  "ZREMRANGEBYSCORE",
]);
