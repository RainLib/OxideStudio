import { createAiToolRegistry } from "@/ai/tools/registry";
import type { AiToolExecutionContext } from "@/ai/tools/types";

export function createTestRegistry() {
  const registry = createAiToolRegistry();

  registry.register({
    name: "demo.read",
    description: "Read a bounded demo value.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["metadata"],
    execute: async (input, context) => ({ input, mode: "read", context }),
  });

  registry.register({
    name: "demo.write",
    description: "Write a demo value after approval.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    permissions: ["write"],
    capabilities: ["query"],
    execute: async (input) => ({ input, mode: "write" }),
  });

  return registry;
}

export function createPlannerRegistry() {
  const registry = createAiToolRegistry();

  registry.register({
    name: "query.runReadOnly",
    description: "Run a read-only query.",
    inputSchema: { type: "object", additionalProperties: true },
    permissions: ["read"],
    capabilities: ["query"],
    execute: async (input) => ({ input }),
  });

  registry.register({
    name: "key.getValue",
    description: "Read a Redis key.",
    inputSchema: { type: "object", additionalProperties: true },
    permissions: ["read"],
    capabilities: ["query"],
    execute: async (input) => ({ input }),
  });

  return registry;
}

export function createContext(): AiToolExecutionContext {
  return {
    requestId: "test-request",
    activeConnectionId: "connection-1",
    activeDriver: "postgres",
  };
}

export function createRichContext(): AiToolExecutionContext {
  return {
    ...createContext(),
    activeNamespace: "public",
    activeTab: {
      id: "tab-1",
      type: "query",
      title: "Query #1",
      sql: "SELECT * FROM public.users WHERE active = true",
      connectionId: "connection-1",
      targetSchema: "public",
      schemaName: "public",
      tableName: "users",
      objectType: "table",
      selection: {
        tabId: "tab-1",
        tabTitle: "Query #1",
        text: "SELECT * FROM public.users",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 27,
        connectionId: "connection-1",
      },
    },
  };
}
