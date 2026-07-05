import type { AiToolAdapters, AiToolDefinition } from "./types";
import type { AiToolRegistry } from "./registry";
import type { DatabaseDriver } from "@/services/tauri/types";

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

  if (adapters.describeObject) {
    registry.register(describeObjectTool(adapters));
  }

  if (adapters.runReadOnlyQuery) {
    registry.register(readOnlyQueryTool(adapters));
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

function assertObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
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
