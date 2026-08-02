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
    expect(plan?.queryTabs.map((tab) => tab.id)).toEqual([
      "query-users",
      "audit-table",
    ]);
    expect(plan?.targetSchemas).toEqual(["app", "audit"]);
    expect(plan?.schemaByTabId).toEqual({
      "query-users": "app",
      "audit-table": "audit",
    });
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

  it("keeps a generic SQL document URI while routing it to a concrete server dialect", () => {
    const mappings = buildLspFileMappings({
      queryTabs: [{ id: "oracle-query", type: "query", targetSchema: "app" }],
      schemaByTabId: { "oracle-query": "app" },
      defaultSchema: "app",
      driver: "oracle",
      documentLanguageId: "sql",
      lspDialect: "postgres",
      getSchemaId: (schemaName) => `schema-${schemaName}`,
    });

    expect(mappings).toEqual({
      fileSchemas: {
        "oxide://query/oracle-query.oracle.sql": "schema-app",
      },
      fileDialects: {
        "oxide://query/oracle-query.oracle.sql": "postgres",
      },
    });
  });

  it("isolates PostgreSQL tabs by catalog when databases share a schema name", () => {
    const plan = createLspSyncPlan({
      activeConnectionId: "postgres-main",
      connection: {
        id: "postgres-main",
        driver: "postgres",
        database: "primary",
      },
      schemas: ["public"],
      currentSchema: "public",
      activeTabId: "analytics-query",
      tabs: [
        {
          id: "primary-query",
          type: "query",
          connectionId: "postgres-main",
          targetSchema: "public",
          sql: "SELECT id FROM users",
        },
        {
          id: "analytics-query",
          type: "query",
          connectionId: "postgres-main",
          databaseName: "analytics",
          targetSchema: "public",
          schemaName: "public",
          tableName: "events",
          sql: "SELECT id FROM events",
        },
      ],
    });

    expect(plan?.targetCatalogs).toEqual([
      {
        catalogName: "primary",
        databaseName: null,
        schemaName: "public",
      },
      {
        catalogName: "analytics",
        databaseName: "analytics",
        schemaName: "public",
      },
    ]);
    expect(plan?.catalogByTabId["primary-query"]).toMatchObject({
      catalogName: "primary",
      schemaName: "public",
    });
    expect(plan?.catalogByTabId["analytics-query"]).toMatchObject({
      catalogName: "analytics",
      databaseName: "analytics",
      schemaName: "public",
    });

    const mappings = buildLspFileMappings({
      queryTabs: plan?.queryTabs || [],
      schemaByTabId: plan?.schemaByTabId || {},
      catalogByTabId: plan?.catalogByTabId,
      defaultSchema: plan?.defaultSchema || "public",
      defaultCatalog: plan?.defaultCatalog,
      driver: "postgres",
      lspDialect: "postgres",
      getSchemaId: (schemaName, catalogName) =>
        `${catalogName || "default"}/${schemaName}`,
    });

    expect(mappings.fileSchemas).toEqual({
      "oxide://query/primary-query.postgres.postgres": "primary/public",
      "oxide://query/analytics-query.postgres.postgres": "analytics/public",
    });
  });

  it("does not widen an external PostgreSQL package without catalog capability", () => {
    const plan = createLspSyncPlan({
      activeConnectionId: "external-postgres",
      connection: {
        id: "external-postgres",
        driver: "postgres",
        database: "primary",
        supportsDatabaseCatalogs: false,
      },
      schemas: ["public"],
      currentSchema: "public",
      tabs: [
        {
          id: "package-query",
          type: "query",
          connectionId: "external-postgres",
          databaseName: "analytics",
          targetSchema: "public",
          sql: "SELECT id FROM events",
        },
      ],
    });

    expect(plan?.defaultCatalog).toEqual({
      catalogName: null,
      databaseName: null,
      schemaName: "public",
    });
    expect(plan?.catalogByTabId["package-query"]).toEqual({
      catalogName: null,
      databaseName: null,
      schemaName: "public",
    });
  });

  it("preserves the selected catalog for capability-declared external SQL drivers", () => {
    const plan = createLspSyncPlan({
      activeConnectionId: "sqlserver-main",
      connection: {
        id: "sqlserver-main",
        driver: "sqlserver",
        database: "warehouse",
        supportsDatabaseCatalogs: true,
      },
      schemas: ["sales"],
      currentSchema: "sales",
      tabs: [
        {
          id: "query",
          type: "query",
          connectionId: "sqlserver-main",
          targetSchema: "sales",
          sql: "SELECT id FROM archive.sales.orders",
        },
      ],
    });

    expect(plan?.defaultCatalog).toEqual({
      catalogName: "warehouse",
      databaseName: null,
      schemaName: "sales",
    });
    expect(plan?.catalogByTabId.query).toEqual({
      catalogName: "warehouse",
      databaseName: null,
      schemaName: "sales",
    });
    expect(plan?.targetCatalogs).toContainEqual({
      catalogName: "archive",
      databaseName: "archive",
      schemaName: "sales",
    });
  });

  it("isolates attached DuckDB catalogs without treating the file path as a catalog", () => {
    const plan = createLspSyncPlan({
      activeConnectionId: "duckdb-main",
      connection: {
        id: "duckdb-main",
        driver: "duckdb",
        database: "/workspace/analytics.duckdb",
      },
      schemas: ["main"],
      currentSchema: "main",
      tabs: [
        {
          id: "main-query",
          type: "query",
          connectionId: "duckdb-main",
          targetSchema: "main",
          sql: "SELECT * FROM local_events",
        },
        {
          id: "attached-query",
          type: "query",
          connectionId: "duckdb-main",
          databaseName: "archive",
          targetSchema: "main",
          sql: "SELECT * FROM archived_events",
        },
      ],
    });

    expect(plan?.targetCatalogs).toEqual([
      { catalogName: null, databaseName: null, schemaName: "main" },
      { catalogName: "archive", databaseName: "archive", schemaName: "main" },
    ]);
    expect(plan?.catalogByTabId["main-query"]).toMatchObject({
      catalogName: null,
      schemaName: "main",
    });
    expect(plan?.catalogByTabId["attached-query"]).toMatchObject({
      catalogName: "archive",
      databaseName: "archive",
      schemaName: "main",
    });
  });

  it("prioritizes the active tab object within a catalog", () => {
    const plan = createLspSyncPlan({
      activeConnectionId: "postgres-main",
      connection: {
        id: "postgres-main",
        driver: "postgres",
        database: "primary",
      },
      schemas: ["public"],
      currentSchema: "public",
      activeTabId: "orders-table",
      tabs: [
        {
          id: "users-table",
          type: "table",
          connectionId: "postgres-main",
          schemaName: "public",
          tableName: "users",
        },
        {
          id: "orders-table",
          type: "table",
          connectionId: "postgres-main",
          schemaName: "public",
          tableName: "orders",
        },
        {
          id: "query",
          type: "query",
          connectionId: "postgres-main",
          targetSchema: "public",
          sql: "SELECT ",
        },
      ],
    });
    const catalog = plan?.targetCatalogs.find(
      (item) => item.catalogName === "primary" && item.schemaName === "public"
    );
    expect(catalog).toBeDefined();
    expect(
      Array.from(
        plan?.preferredTablesByCatalog.get(
          JSON.stringify(["primary", "public"])
        ) || []
      )
    ).toEqual(["orders", "users"]);
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
