import { describe, expect, it } from "vitest";
import { registerCoreAiTools } from "@/ai/tools/coreTools";
import {
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
} from "@/ai/tools/policy";
import { createAiToolRegistry } from "@/ai/tools/registry";
import type {
  AiConnectionSummary,
  AiToolAdapters,
  AiToolExecutionContext,
} from "@/ai/tools/types";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import type { DatabaseDriver } from "@/services/tauri/types";

type AdapterCall = {
  name: string;
  input: unknown;
};

const CONNECTIONS: AiConnectionSummary[] = [
  { id: "redis-1", name: "Redis local", driver: "redis" },
  { id: "mongodb-1", name: "Mongo local", driver: "mongodb" },
  { id: "elasticsearch-1", name: "Elasticsearch local", driver: "elasticsearch" },
  { id: "postgres-1", name: "Postgres local", driver: "postgres" },
];

function createContext(
  driver: DatabaseDriver,
  connectionId = `${driver}-1`
): AiToolExecutionContext {
  return {
    requestId: `core-tools-${driver}`,
    activeConnectionId: connectionId,
    activeDriver: driver,
  };
}

function createAdapters(calls: AdapterCall[] = []): AiToolAdapters {
  return {
    listConnections: () => CONNECTIONS,
    getConnectionCapabilities: (driver) => defaultDatabaseCapabilities(driver),
    runReadOnlyQuery: async (input) => {
      calls.push({ name: "read", input });
      return [];
    },
    runMutationQuery: async (input) => {
      calls.push({ name: "mutation", input });
      return [];
    },
    mutateDocuments: async (input) => {
      calls.push({ name: "documents", input });
      return [];
    },
    mutateKeyValues: async (input) => {
      calls.push({ name: "keys", input });
      return [];
    },
    mutateSearchDocuments: async (input) => {
      calls.push({ name: "search", input });
      return [];
    },
    mutateNamespace: async (input) => {
      calls.push({ name: "namespace", input });
      return "ok";
    },
    getLspCompletions: async (input) => {
      calls.push({ name: "lsp.completions", input });
      return [];
    },
    explainLspDiagnostics: async (input) => {
      calls.push({ name: "lsp.diagnostics", input });
      return {
        tabId: "tab-1",
        tabTitle: "Query",
        onlySelection: false,
        summary: "No diagnostics.",
        diagnostics: [],
      };
    },
  };
}

function createRegistry(adapters = createAdapters()) {
  return registerCoreAiTools(createAiToolRegistry(), adapters);
}

function approvedPolicy(toolName: string) {
  return approveAiToolForPolicy(DEFAULT_AI_TOOL_POLICY, toolName);
}

describe("core AI tools", () => {
  it("advertises driver-specific NoSQL and search capabilities to AI planners", async () => {
    const registry = createRegistry();

    const result = await registry.execute<{
      driverProfiles: Array<{
        driver: DatabaseDriver;
        aiToolHints: {
          read: string[];
          write: string[];
          destructive: string[];
          lsp: string[];
        };
      }>;
    }>("provider.list", {}, createContext("postgres"));

    const redis = result.driverProfiles.find((profile) => profile.driver === "redis");
    const postgres = result.driverProfiles.find(
      (profile) => profile.driver === "postgres"
    );
    const mysql = result.driverProfiles.find((profile) => profile.driver === "mysql");
    const mongodb = result.driverProfiles.find(
      (profile) => profile.driver === "mongodb"
    );
    const elasticsearch = result.driverProfiles.find(
      (profile) => profile.driver === "elasticsearch"
    );

    expect(redis?.aiToolHints).toMatchObject({
      read: expect.arrayContaining(["key.getValue"]),
      write: expect.arrayContaining(["query.runMutation", "key.setValue"]),
      destructive: expect.arrayContaining([
        "query.runDestructive",
        "key.deleteKeys",
      ]),
      lsp: expect.arrayContaining([
        "lsp.getCompletions",
        "lsp.explainDiagnostics",
      ]),
    });
    expect(postgres?.aiToolHints).toMatchObject({
      write: expect.arrayContaining(["database.createNamespace"]),
      destructive: expect.arrayContaining(["database.dropNamespace"]),
    });
    expect(mysql?.aiToolHints).toMatchObject({
      write: expect.arrayContaining(["database.createNamespace"]),
      destructive: expect.arrayContaining(["database.dropNamespace"]),
    });
    expect(mongodb?.aiToolHints).toMatchObject({
      write: expect.arrayContaining([
        "query.runMutation",
        "document.insertDocuments",
        "document.updateDocuments",
      ]),
      destructive: expect.arrayContaining([
        "query.runDestructive",
        "document.deleteDocuments",
      ]),
      lsp: expect.arrayContaining([
        "lsp.getCompletions",
        "lsp.explainDiagnostics",
      ]),
    });
    expect(elasticsearch?.aiToolHints).toMatchObject({
      write: expect.arrayContaining([
        "query.runMutation",
        "search.indexDocument",
        "search.updateDocument",
      ]),
      destructive: expect.arrayContaining([
        "query.runDestructive",
        "search.deleteDocument",
      ]),
      lsp: expect.arrayContaining([
        "lsp.getCompletions",
        "lsp.explainDiagnostics",
      ]),
    });
  });

  it("routes read, write, and destructive query tools through safety gates", async () => {
    const calls: AdapterCall[] = [];
    const registry = createRegistry(createAdapters(calls));
    const context = createContext("elasticsearch");

    await registry.executeWithPolicy(
      "query.runReadOnly",
      {
        connectionId: "elasticsearch-1",
        namespace: "users",
        query: 'GET /users/_search\n{"query":{"match_all":{}}}',
        limit: 500,
      },
      context,
      DEFAULT_AI_TOOL_POLICY
    );
    await expect(
      registry.executeWithPolicy(
        "query.runReadOnly",
        {
          connectionId: "elasticsearch-1",
          query: 'POST /_bulk\n{"delete":{"_index":"users","_id":"1"}}',
        },
        context,
        DEFAULT_AI_TOOL_POLICY
      )
    ).rejects.toThrow("potentially mutating");
    await expect(
      registry.executeWithPolicy(
        "query.runMutation",
        {
          connectionId: "elasticsearch-1",
          query: 'POST /_bulk\n{"delete":{"_index":"users","_id":"1"}}',
        },
        context,
        approvedPolicy("query.runMutation")
      )
    ).rejects.toThrow("destructive request");
    await registry.executeWithPolicy(
      "query.runDestructive",
      {
        connectionId: "elasticsearch-1",
        query: 'POST /_bulk\n{"delete":{"_index":"users","_id":"1"}}',
      },
      context,
      approvedPolicy("query.runDestructive")
    );

    expect(calls).toEqual([
      {
        name: "read",
        input: {
          connectionId: "elasticsearch-1",
          namespace: "users",
          query: 'GET /users/_search\n{"query":{"match_all":{}}}',
          limit: 200,
        },
      },
      {
        name: "mutation",
        input: {
          connectionId: "elasticsearch-1",
          query: 'POST /_bulk\n{"delete":{"_index":"users","_id":"1"}}',
        },
      },
    ]);

    expect(
      registry.list().find((tool) => tool.name === "query.runReadOnly")
        ?.inputSchema.properties?.namespace
    ).toMatchObject({
      type: "string",
    });
  });

  it("requires approval before structured mutation tools can call adapters", async () => {
    const registry = createRegistry(createAdapters());

    expect(
      registry.list().find((tool) => tool.name === "key.setValue")?.inputSchema
        .properties?.namespace
    ).toMatchObject({ type: "string" });

    await expect(
      registry.executeWithPolicy(
        "key.setValue",
        { key: "session:1", value: "active" },
        createContext("redis"),
        DEFAULT_AI_TOOL_POLICY
      )
    ).rejects.toThrow("requires explicit approval");
  });

  it("gates namespace mutations behind approval and normalizes inputs", async () => {
    const calls: AdapterCall[] = [];
    const registry = createRegistry(createAdapters(calls));

    await expect(
      registry.executeWithPolicy(
        "database.createNamespace",
        { namespace: "app" },
        createContext("postgres"),
        DEFAULT_AI_TOOL_POLICY
      )
    ).rejects.toThrow("requires explicit approval");

    await registry.executeWithPolicy(
      "database.createNamespace",
      {
        connectionId: "postgres-1",
        namespace: "app",
        charset: "",
        collation: "",
      },
      createContext("postgres"),
      approvedPolicy("database.createNamespace")
    );
    await registry.executeWithPolicy(
      "database.dropNamespace",
      {
        connectionId: "postgres-1",
        namespace: "app",
        cascade: true,
      },
      createContext("postgres"),
      approvedPolicy("database.dropNamespace")
    );

    expect(calls).toEqual([
      {
        name: "namespace",
        input: {
          operation: "create",
          connectionId: "postgres-1",
          namespace: "app",
          charset: null,
          collation: null,
        },
      },
      {
        name: "namespace",
        input: {
          operation: "drop",
          connectionId: "postgres-1",
          namespace: "app",
          cascade: true,
        },
      },
    ]);
  });

  it("reads Redis keys through a bounded read-only tool", async () => {
    const calls: AdapterCall[] = [];
    const registry = createRegistry(createAdapters(calls));

    await registry.executeWithPolicy(
      "key.getValue",
      {
        connectionId: "redis-1",
        namespace: "2",
        key: "session token",
      },
      createContext("redis"),
      DEFAULT_AI_TOOL_POLICY
    );

    expect(calls).toEqual([
      {
        name: "read",
        input: {
          connectionId: "redis-1",
          namespace: "2",
          query: 'GET "session token"',
          limit: 1,
        },
      },
    ]);

    expect(
      registry.list().find((tool) => tool.name === "key.getValue")?.inputSchema
        .properties?.namespace
    ).toMatchObject({ type: "string" });

    await expect(
      registry.executeWithPolicy(
        "key.getValue",
        {
          connectionId: "postgres-1",
          key: "session:1",
        },
        createContext("postgres"),
        DEFAULT_AI_TOOL_POLICY
      )
    ).rejects.toThrow("does not support key-value reads");
  });

  it("normalizes MongoDB, Redis, and Elasticsearch structured mutations", async () => {
    const calls: AdapterCall[] = [];
    const registry = createRegistry(createAdapters(calls));

    await registry.executeWithPolicy(
      "document.insertDocuments",
      {
        connectionId: "mongodb-1",
        namespace: "app",
        collection: "users",
        documents: [{ name: "Ada" }],
      },
      createContext("mongodb"),
      approvedPolicy("document.insertDocuments")
    );
    await registry.executeWithPolicy(
      "key.setValue",
      {
        connectionId: "redis-1",
        namespace: "2",
        key: "session:1",
        value: { status: "active" },
        ttlSeconds: 60.8,
      },
      createContext("redis"),
      approvedPolicy("key.setValue")
    );
    await registry.executeWithPolicy(
      "search.updateDocument",
      {
        connectionId: "elasticsearch-1",
        index: "users",
        id: "1",
        document: { active: true },
        upsert: true,
      },
      createContext("elasticsearch"),
      approvedPolicy("search.updateDocument")
    );

    expect(calls).toEqual([
      {
        name: "documents",
        input: {
          operation: "insert",
          connectionId: "mongodb-1",
          namespace: "app",
          collection: "users",
          documents: [{ name: "Ada" }],
        },
      },
      {
        name: "keys",
        input: {
          operation: "set",
          connectionId: "redis-1",
          namespace: "2",
          key: "session:1",
          value: { status: "active" },
          ttlSeconds: 60,
        },
      },
      {
        name: "search",
        input: {
          operation: "update",
          connectionId: "elasticsearch-1",
          index: "users",
          id: "1",
          document: { active: true },
          upsert: true,
        },
      },
    ]);
  });
});
