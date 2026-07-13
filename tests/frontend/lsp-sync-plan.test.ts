import { describe, expect, it } from "vitest";
import {
  buildLspFileMappings,
  createLspConfigKey,
  createLspSyncPlan,
} from "@/services/lsp/syncPlan";
import { collectionToLspTableDefinition } from "@/services/lsp/schemaConfig";
import { defaultDatabaseCapabilities, lspLanguageId } from "@/lib/databaseDialect";

describe("LSP sync plan", () => {
  it("selects active connection tabs, target schemas, and preferred objects", () => {
    const plan = createLspSyncPlan({
      activeConnectionId: "conn-main",
      connection: {
        id: "conn-main",
        driver: "mongodb",
        database: "app",
      },
      schemas: ["app", "audit"],
      currentSchema: "app",
      tabs: [
        {
          id: "query-users",
          type: "query",
          connectionId: "conn-main",
          targetSchema: "app",
          sql: '{"find":"users"}',
        },
        {
          id: "audit-table",
          type: "table",
          connectionId: "conn-main",
          schemaName: "audit",
          tableName: "events",
        },
        {
          id: "other-connection",
          type: "query",
          connectionId: "conn-other",
          targetSchema: "other",
          sql: "",
        },
      ],
    });

    expect(plan?.defaultSchema).toBe("app");
    expect(plan?.connectionTabs.map((tab) => tab.id)).toEqual([
      "query-users",
      "audit-table",
    ]);
    expect(plan?.queryTabs.map((tab) => tab.id)).toEqual(["query-users"]);
    expect(plan?.targetSchemas).toEqual(["app", "audit"]);
    expect(plan?.schemaByTabId).toEqual({ "query-users": "app" });
    expect(
      Array.from(plan?.preferredTablesBySchema.get("audit") ?? [])
    ).toEqual(["events"]);
  });

  it("builds schema and dialect mappings for Redis, MongoDB, and Elasticsearch tabs", () => {
    const schemaIds: Record<string, string> = {
      "0": "schema-redis",
      app: "schema-mongo",
      search: "schema-search",
    };
    const getSchemaId = (schemaName: string) => schemaIds[schemaName] || schemaName;

    const redis = buildLspFileMappings({
      queryTabs: [{ id: "redis-tab", type: "query", targetSchema: "0" }],
      schemaByTabId: { "redis-tab": "0" },
      defaultSchema: "0",
      driver: "redis",
      lspDialect: lspLanguageId("redis"),
      getSchemaId,
    });
    const mongodb = buildLspFileMappings({
      queryTabs: [{ id: "mongo-tab", type: "query", targetSchema: "app" }],
      schemaByTabId: { "mongo-tab": "app" },
      defaultSchema: "app",
      driver: "mongodb",
      lspDialect: lspLanguageId("mongodb"),
      getSchemaId,
    });
    const elasticsearch = buildLspFileMappings({
      queryTabs: [
        { id: "search-tab", type: "query", targetSchema: "search" },
      ],
      schemaByTabId: { "search-tab": "search" },
      defaultSchema: "search",
      driver: "elasticsearch",
      lspDialect: lspLanguageId("elasticsearch"),
      getSchemaId,
    });

    expect(redis).toEqual({
      fileSchemas: {
        "oxide://query/redis-tab.redis.redis": "schema-redis",
      },
      fileDialects: {
        "oxide://query/redis-tab.redis.redis": "redis",
      },
    });
    expect(mongodb).toEqual({
      fileSchemas: {
        "oxide://query/mongo-tab.mongodb.mongodb": "schema-mongo",
      },
      fileDialects: {
        "oxide://query/mongo-tab.mongodb.mongodb": "mongodb",
      },
    });
    expect(elasticsearch).toEqual({
      fileSchemas: {
        "oxide://query/search-tab.elasticsearch.elasticsearch": "schema-search",
      },
      fileDialects: {
        "oxide://query/search-tab.elasticsearch.elasticsearch": "elasticsearch-dsl",
      },
    });
  });

  it("maps query tabs with object schema metadata to that schema when target schema is unset", () => {
    const schemaIds: Record<string, string> = {
      public: "schema-public",
      audit: "schema-audit",
    };
    const getSchemaId = (schemaName: string) => schemaIds[schemaName] || schemaName;

    const mappings = buildLspFileMappings({
      queryTabs: [
        {
          id: "audit-query",
          type: "query",
          schemaName: "audit",
          tableName: "events",
        },
      ],
      schemaByTabId: {},
      defaultSchema: "public",
      driver: "postgres",
      lspDialect: lspLanguageId("postgres"),
      getSchemaId,
    });

    expect(mappings.fileSchemas).toEqual({
      "oxide://query/audit-query.postgres.postgres": "schema-audit",
    });
  });

  it("changes duplicate-send keys when NoSQL schema fields change", () => {
    const base = {
      connectionId: "conn-main",
      driver: "mongodb" as const,
      lspDialect: "mongodb",
      fileSchemas: {
        "oxide://query/q.mongodb.mongodb": "schema-1",
      },
      fileDialects: {
        "oxide://query/q.mongodb.mongodb": "mongodb",
      },
    };
    const first = createLspConfigKey({
      ...base,
      schemaDefinitions: [
        {
          id: "schema-1",
          database: "app",
          source_uri: null,
          tables: [
            collectionToLspTableDefinition(
              defaultDatabaseCapabilities("mongodb"),
              { name: "users", type: "collection" },
              [
                {
                  name: "email",
                  data_type: "string",
                  is_nullable: true,
                  is_primary_key: false,
                  is_indexed: true,
                },
              ]
            ),
          ],
          functions: [],
        },
      ],
    });
    const second = createLspConfigKey({
      ...base,
      schemaDefinitions: [
        {
          id: "schema-1",
          database: "app",
          source_uri: null,
          tables: [
            collectionToLspTableDefinition(
              defaultDatabaseCapabilities("mongodb"),
              { name: "users", type: "collection" },
              [
                {
                  name: "username",
                  data_type: "string",
                  is_nullable: true,
                  is_primary_key: false,
                  is_indexed: true,
                },
              ]
            ),
          ],
          functions: [],
        },
      ],
    });

    expect(first).not.toEqual(second);
    expect(first).toContain('\\"name\\":\\"email\\"');
    expect(second).toContain('\\"name\\":\\"username\\"');
  });
});
