import { afterEach, describe, expect, it } from "vitest";
import {
  defaultDatabaseCapabilities,
  lspLanguageId,
  normalizeLspDialect,
  resetRuntimeDatabaseCatalogForTests,
  supportsLspLanguageId,
  syncExternalDatabaseDriverProfiles,
} from "@/lib/databaseDialect";
import { builtInLspProfileForDriver } from "@/services/lsp/profiles";
import {
  getLspDocumentUri,
  getLspProjectDocumentUri,
  parseLspProjectDocumentUri,
} from "@/services/lsp/document";
import {
  assignLspObjectSourceLocations,
  collectionToLspTableDefinition,
  lspSchemaSignature,
  selectLspTablesForSchema,
  type LspSchemaDefinition,
} from "@/services/lsp/schemaConfig";
import {
  getLspDatabaseObjectUri,
  parseLspDatabaseObjectUri,
} from "@/services/lsp/objectUri";
import type { ColumnInfo, IndexInfo } from "@/services/tauri/types";

function column(name: string, dataType: string): ColumnInfo {
  return {
    name,
    data_type: dataType,
    is_nullable: true,
    is_primary_key: false,
    is_unique: false,
    is_indexed: true,
    comment: null,
  };
}

function index(name: string, columns: string[]): IndexInfo {
  return {
    name,
    columns,
    is_unique: false,
    is_primary: false,
  };
}

function signatureSchema(): LspSchemaDefinition {
  return {
    id: "schema-1",
    database: "app",
    source_uri: null,
    tables: [
      {
        name: "users",
        object_type: "BASE TABLE",
        comment: "Application users",
        source_location: null,
        columns: [
          {
            name: "id",
            data_type: "integer",
            nullable: false,
            primary_key: true,
            unique: true,
            indexed: true,
            default_value: "nextval('users_id_seq')",
            auto_increment: true,
            comment: "Primary identifier",
            source_location: null,
          },
          {
            name: "email",
            data_type: "text",
            nullable: false,
            primary_key: false,
            unique: true,
            indexed: true,
            default_value: null,
            auto_increment: false,
            comment: null,
            source_location: null,
          },
        ],
        indexes: [
          {
            name: "users_pkey",
            columns: ["id"],
            is_unique: true,
            is_primary: true,
            index_type: "btree",
            definition: "CREATE UNIQUE INDEX users_pkey ON users (id)",
          },
          {
            name: "users_email_key",
            columns: ["email"],
            is_unique: true,
            is_primary: false,
            index_type: "btree",
            definition: "CREATE UNIQUE INDEX users_email_key ON users (email)",
          },
        ],
        constraints: [
          {
            name: "users_team_fk",
            constraint_type: "FOREIGN KEY",
            columns: ["team_id"],
            referenced_schema: "app",
            referenced_table: "teams",
            referenced_columns: ["id"],
            definition:
              "FOREIGN KEY (team_id) REFERENCES app.teams(id) ON DELETE CASCADE",
          },
          {
            name: "users_email_check",
            constraint_type: "CHECK",
            columns: ["email"],
            referenced_schema: null,
            referenced_table: null,
            referenced_columns: [],
            definition: "CHECK (email <> '')",
          },
        ],
      },
    ],
    functions: [
      {
        name: "find_user",
        routine_type: "function",
        parameters: [
          { name: "user_id", data_type: "integer", optional: false, mode: "IN" },
          { name: "include_deleted", data_type: "boolean", optional: true, mode: "IN" },
        ],
        return_type: "app.users",
        description: "Find a user",
      },
    ],
  };
}

function cloneSchema(schema: LspSchemaDefinition): LspSchemaDefinition {
  return JSON.parse(JSON.stringify(schema)) as LspSchemaDefinition;
}

describe("LSP schema config", () => {
  afterEach(() => resetRuntimeDatabaseCatalogForTests());

  it("maps Redis keys to LSP table-shaped objects", () => {
    const table = collectionToLspTableDefinition(
      defaultDatabaseCapabilities("redis"),
      {
        name: "user:1",
        type: "hash",
        documentCount: 3,
      }
    );

    expect(table).toMatchObject({
      name: "user:1",
      object_type: "hash",
      comment: "3 value item(s)",
    });
    expect(table.columns.map((item) => [item.name, item.data_type])).toEqual([
      ["key", "string"],
      ["type", "hash"],
      ["value", "json"],
    ]);
  });

  it("round-trips credential-free database object navigation URIs", () => {
    const uri = getLspDatabaseObjectUri({
      connectionId: "postgres/primary",
      databaseName: "analytics db",
      schemaName: "业务",
      objectName: "orders",
      objectType: "BASE TABLE",
      columnName: "customer id",
    });

    expect(uri).not.toContain("postgres://");
    expect(parseLspDatabaseObjectUri(uri)).toEqual({
      connectionId: "postgres/primary",
      databaseName: "analytics db",
      schemaName: "业务",
      objectName: "orders",
      objectType: "BASE TABLE",
      columnName: "customer id",
    });
    expect(parseLspDatabaseObjectUri("file:///schema.sql")).toBeNull();
  });

  it("assigns table and column definition targets to schema metadata", () => {
    const table = assignLspObjectSourceLocations(
      collectionToLspTableDefinition(
        defaultDatabaseCapabilities("redis"),
        { name: "user:1", type: "hash" }
      ),
      {
        tableUri: "oxide://database-object/object?object=user%3A1",
        columnUri: (columnName) =>
          `oxide://database-object/object?object=user%3A1&column=${columnName}`,
      }
    );

    expect(table.source_location).toEqual([
      "oxide://database-object/object?object=user%3A1",
      1,
    ]);
    expect(table.columns.every((column) => column.source_location?.[0]))
      .toBe(true);
  });

  it("maps MongoDB collection fields and indexes for schema-aware LSP", () => {
    const table = collectionToLspTableDefinition(
      defaultDatabaseCapabilities("mongodb"),
      {
        name: "users",
        type: "collection",
        documentCount: 12,
      },
      [column("_id", "objectId"), column("email", "string")],
      [index("email_1", ["email"])]
    );

    expect(table).toMatchObject({
      name: "users",
      object_type: "collection",
      comment: "12 document(s)",
      indexes: [expect.objectContaining({ name: "email_1", columns: ["email"] })],
    });
    expect(table.columns.map((item) => item.name)).toEqual(["_id", "email"]);
  });

  it("maps Elasticsearch index mapping fields and fallback fields", () => {
    const capabilities = defaultDatabaseCapabilities("elasticsearch");
    const mapped = collectionToLspTableDefinition(
      capabilities,
      {
        name: "logs",
        type: "index",
        documentCount: 20,
      },
      [column("@timestamp", "date"), column("message", "text")]
    );
    const fallback = collectionToLspTableDefinition(capabilities, {
      name: "empty-index",
      type: "index",
    });

    expect(mapped.comment).toBe("20 indexed document(s)");
    expect(mapped.columns.map((item) => [item.name, item.data_type])).toEqual([
      ["@timestamp", "date"],
      ["message", "text"],
    ]);
    expect(fallback.columns.map((item) => item.name)).toEqual([
      "id",
      "score",
      "source",
    ]);
  });

  it("keeps preferred tables first while bounding synced objects", () => {
    const selected = selectLspTablesForSchema(
      [{ name: "users" }, { name: "orders" }, { name: "events" }],
      new Set(["EVENTS", "missing"]),
      2
    );

    expect(selected.map((item) => item.name)).toEqual(["events", "users"]);
  });

  it("keeps every schema object when no explicit compatibility limit is given", () => {
    const tables = Array.from({ length: 620 }, (_, index) => ({
      name: `table_${index}`,
    }));
    const selected = selectLspTablesForSchema(
      tables,
      new Set(["TABLE_619"])
    );

    expect(selected).toHaveLength(620);
    expect(selected[0]?.name).toBe("table_619");
    expect(new Set(selected.map((table) => table.name))).toEqual(
      new Set(tables.map((table) => table.name))
    );
  });

  it("uses LSP document URIs that the bundled server can infer when mappings lag", () => {
    expect(lspLanguageId("redis")).toBe("redis");
    expect(lspLanguageId("mongodb")).toBe("mongodb");
    expect(lspLanguageId("elasticsearch")).toBe("elasticsearch-dsl");

    expect(getLspDocumentUri("tab/redis", "redis", lspLanguageId("redis"))).toBe(
      "oxide://query/tab%2Fredis.redis.redis"
    );
    expect(
      getLspDocumentUri("tab/mongo", "mongodb", lspLanguageId("mongodb"))
    ).toBe("oxide://query/tab%2Fmongo.mongodb.mongodb");
    expect(
      getLspDocumentUri(
        "tab/search",
        "elasticsearch",
        lspLanguageId("elasticsearch")
      )
    ).toBe("oxide://query/tab%2Fsearch.elasticsearch.elasticsearch");

    const projectUri = getLspProjectDocumentUri(
      "project/one",
      "queries/report.sql",
    );
    expect(projectUri).toBe("oxide://project/project%2Fone/queries/report.sql");
    expect(parseLspProjectDocumentUri(projectUri)).toEqual({
      projectId: "project/one",
      relativePath: "queries/report.sql",
    });
    expect(parseLspProjectDocumentUri("oxide://project/only-project.sql")).toBeNull();
  });

  it("does not treat generic sql as a concrete LSP dialect", () => {
    expect(supportsLspLanguageId("postgres")).toBe(true);
    expect(supportsLspLanguageId("unknown-sql")).toBe(false);
    expect(lspLanguageId("unknown-sql")).toBe("sql");
    expect(normalizeLspDialect("sql", "mysql")).toBe("mysql");
  });

  it("starts the bundled generic SQL session for a verified external relation driver", () => {
    syncExternalDatabaseDriverProfiles([
      {
        driver: "oracle",
        displayName: "Oracle Database",
        clientLibrary: "fixture",
        clientVersion: "1.0",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "declared-by-package",
        implementation: "isolated driver sidecar",
        packageVersion: "1.0.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        capabilities: {
          ...defaultDatabaseCapabilities("postgres"),
          driver: "oracle",
          displayName: "Oracle Database",
          lspLanguageId: "oracle",
        },
      },
    ]);

    expect(builtInLspProfileForDriver("oracle")).toMatchObject({
      driver: "oracle",
      languageId: "sql",
      documentLanguageId: "sql",
      serverDialect: "postgres",
    });
  });

  it("uses a connection-pinned capability contract when creating an LSP profile", () => {
    expect(
      builtInLspProfileForDriver("oracle", {
        ...defaultDatabaseCapabilities("postgres"),
        driver: "oracle",
        displayName: "Oracle pinned package",
        lspLanguageId: "clickhouse",
      }),
    ).toMatchObject({
      driver: "oracle",
      languageId: "clickhouse",
      documentLanguageId: "sql",
      serverDialect: "clickhouse",
    });
  });

  it("starts generic SQL intelligence for an explicitly SQL-shaped non-relational package", () => {
    expect(
      builtInLspProfileForDriver("questdb", {
        ...defaultDatabaseCapabilities("postgres"),
        driver: "questdb",
        displayName: "QuestDB",
        dataModel: "timeSeries",
        lspLanguageId: "sql",
        supportsSqlQuery: true,
        supportsTableBrowsing: true,
        supportsTableRowMutation: false,
        supportsTableDdl: false,
      }),
    ).toMatchObject({
      driver: "questdb",
      languageId: "sql",
      documentLanguageId: "sql",
      serverDialect: "postgres",
    });
  });

  it("keeps a MySQL-compatible package's generic document language separate from its parser", () => {
    expect(
      builtInLspProfileForDriver("doris", {
        ...defaultDatabaseCapabilities("postgres"),
        driver: "doris",
        displayName: "Apache Doris",
        lspLanguageId: "sql",
        lspServerDialect: "mysql",
      }),
    ).toMatchObject({
      driver: "doris",
      languageId: "sql",
      documentLanguageId: "sql",
      serverDialect: "mysql",
    });
  });

  it("captures the complete semantic schema metadata in its signature", () => {
    const baseline = signatureSchema();
    const baselineSignature = lspSchemaSignature([baseline]);
    const mutations: Array<(schema: LspSchemaDefinition) => void> = [
      (schema) => (schema.database = "audit"),
      (schema) => (schema.driver = "mysql"),
      (schema) => (schema.server_version = "8.0.38"),
      (schema) => (schema.snapshot_revision = 42),
      (schema) => (schema.tables[0]!.comment = "Changed"),
      (schema) => (schema.tables[0]!.columns[0]!.data_type = "bigint"),
      (schema) => (schema.tables[0]!.columns[0]!.nullable = true),
      (schema) => (schema.tables[0]!.columns[0]!.unique = false),
      (schema) => (schema.tables[0]!.columns[0]!.comment = "Changed"),
      (schema) => (schema.tables[0]!.columns[0]!.default_value = "1"),
      (schema) => (schema.tables[0]!.columns[0]!.auto_increment = false),
      (schema) => (schema.tables[0]!.indexes[0]!.name = "renamed_idx"),
      (schema) => (schema.tables[0]!.indexes[0]!.columns = ["email", "id"]),
      (schema) => (schema.tables[0]!.indexes[0]!.is_unique = false),
      (schema) => (schema.tables[0]!.indexes[0]!.index_type = "hash"),
      (schema) => (schema.tables[0]!.indexes[0]!.definition = "changed"),
      (schema) => (schema.tables[0]!.constraints[0]!.name = "renamed_fk"),
      (schema) => (schema.tables[0]!.constraints[0]!.constraint_type = "UNIQUE"),
      (schema) => (schema.tables[0]!.constraints[0]!.columns = ["team_id", "id"]),
      (schema) => (schema.tables[0]!.constraints[0]!.referenced_schema = "core"),
      (schema) => (schema.tables[0]!.constraints[0]!.referenced_table = "groups"),
      (schema) => (schema.tables[0]!.constraints[0]!.referenced_columns = ["group_id"]),
      (schema) => (schema.tables[0]!.constraints[0]!.definition = "ON DELETE RESTRICT"),
      (schema) => (schema.functions[0]!.return_type = "jsonb"),
      (schema) => (schema.functions[0]!.description = "Changed"),
      (schema) => (schema.functions[0]!.parameters[0]!.name = "id"),
      (schema) => (schema.functions[0]!.parameters[0]!.data_type = "bigint"),
      (schema) => (schema.functions[0]!.parameters[0]!.optional = true),
      (schema) => (schema.functions[0]!.parameters[0]!.mode = "INOUT"),
      (schema) => schema.functions[0]!.parameters.reverse(),
    ];

    for (const mutate of mutations) {
      const changed = cloneSchema(baseline);
      mutate(changed);
      expect(lspSchemaSignature([changed])).not.toBe(baselineSignature);
    }
  });

  it("ignores metadata collection ordering while retaining ordered semantics", () => {
    const original = signatureSchema();
    const secondTable = cloneSchema(original).tables[0]!;
    secondTable.name = "teams";
    original.tables.push(secondTable);
    const secondFunction = cloneSchema(original).functions[0]!;
    secondFunction.name = "list_users";
    original.functions.push(secondFunction);
    const secondSchema = cloneSchema(original);
    secondSchema.id = "schema-2";
    secondSchema.database = "audit";

    const reordered = cloneSchema(original);
    reordered.tables.reverse();
    for (const table of reordered.tables) {
      table.columns.reverse();
      table.indexes.reverse();
      table.constraints.reverse();
    }
    reordered.functions.reverse();

    expect(lspSchemaSignature([secondSchema, reordered])).toBe(
      lspSchemaSignature([original, secondSchema])
    );
  });
});
