import {
  assertObject,
  optionalString,
  requireString,
} from "@/ai/tools/core/inputValidation";
import type {
  AiToolAdapters,
  AiToolDefinition,
  AiToolExecutionContext,
} from "@/ai/tools/types";
import { evaluateSqlExecutionIntent } from "@/lib/sqlExecutionGate";
import type { DatabaseDriver } from "@/services/tauri/types";

const DEFAULT_QUERY_LIMIT = 200;

export function readOnlyQueryTool(adapters: AiToolAdapters): AiToolDefinition {
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

export function explainQueryTool(adapters: AiToolAdapters): AiToolDefinition {
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
      const capabilities = await adapters.getConnectionCapabilities(
        driver,
        connectionId,
      );
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

export function mutationQueryTool(adapters: AiToolAdapters): AiToolDefinition {
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

export function destructiveQueryTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
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

export async function resolveQueryDriver(
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
