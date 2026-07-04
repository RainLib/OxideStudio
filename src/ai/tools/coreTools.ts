import type { AiToolAdapters, AiToolDefinition } from "./types";
import type { AiToolRegistry } from "./registry";

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
      if (!looksReadOnly(query)) {
        throw new Error("query.runReadOnly rejected a potentially mutating request");
      }

      return adapters.runReadOnlyQuery?.(
        {
          connectionId:
            typeof payload.connectionId === "string"
              ? payload.connectionId
              : context.activeConnectionId ?? null,
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

function looksReadOnly(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const mutatingJsonMarkers = [
    '"collmod"',
    '"create"',
    '"createindexes"',
    '"deleteone"',
    '"deletemany"',
    '"drop"',
    '"dropdatabase"',
    '"findandmodify"',
    '"insertone"',
    '"insertmany"',
    '"renamecollection"',
    '"updateone"',
    '"updatemany"',
  ];
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    return !mutatingJsonMarkers.some((marker) => normalized.includes(marker));
  }

  const mutatingPrefixes = [
    "alter",
    "create",
    "delete",
    "drop",
    "insert",
    "merge",
    "replace",
    "truncate",
    "update",
  ];

  return !mutatingPrefixes.some((prefix) => normalized.startsWith(prefix));
}
