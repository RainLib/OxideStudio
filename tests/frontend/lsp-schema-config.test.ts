import { describe, expect, it } from "vitest";
import { defaultDatabaseCapabilities, lspLanguageId } from "@/lib/databaseDialect";
import { getLspDocumentUri } from "@/services/lsp/document";
import {
  collectionToLspTableDefinition,
  lspSchemaSignature,
  selectLspTablesForSchema,
} from "@/services/lsp/schemaConfig";
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

describe("LSP schema config", () => {
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
  });

  it("captures schema signature changes from NoSQL fields and indexes", () => {
    const signature = lspSchemaSignature([
      {
        id: "schema-1",
        database: "app",
        source_uri: null,
        tables: [
          collectionToLspTableDefinition(
            defaultDatabaseCapabilities("mongodb"),
            { name: "users", type: "collection" },
            [column("email", "string")],
            [index("email_1", ["email"])]
          ),
        ],
        functions: [],
      },
    ]);

    expect(signature).toContain("schema-1:app");
    expect(signature).toContain("users:collection");
    expect(signature).toContain("email:string:1:0:1");
    expect(signature).toContain(":1:0");
  });
});
