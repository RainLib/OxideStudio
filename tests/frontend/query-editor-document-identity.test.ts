import { describe, expect, it } from "vitest";
import { editorDocumentIdentity } from "@/features/query-editor";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";

describe("query editor document identity", () => {
  it("keeps a database SQL tab on a connection-scoped LSP URI", () => {
    const identity = editorDocumentIdentity({
      tab: { id: "query 1" },
      driver: "postgres",
      capabilities: defaultDatabaseCapabilities("postgres"),
    });

    expect(identity).toMatchObject({
      documentUri: "oxide://query/query%201.postgres.postgres",
      editorLanguageId: "sql",
      documentLanguageId: "postgres",
      canUseLsp: true,
      usesGenericSqlLsp: false,
    });
  });

  it("uses a project-file model URI for non-database files without leaking into SQL LSP", () => {
    const identity = editorDocumentIdentity({
      tab: { id: "readme", fileRelativePath: "docs/notes.md" },
      driver: "postgres",
      capabilities: defaultDatabaseCapabilities("postgres"),
    });

    expect(identity).toMatchObject({
      documentUri: "oxide://project-file/readme.markdown",
      editorLanguageId: "markdown",
      canUseLsp: false,
    });
  });

  it("routes Mongo JSON through its provider but keeps image and diff previews out of LSP", () => {
    const mongo = editorDocumentIdentity({
      tab: { id: "mongo", fileRelativePath: "queries/aggregation.json" },
      driver: "mongodb",
      capabilities: defaultDatabaseCapabilities("mongodb"),
    });
    const preview = editorDocumentIdentity({
      tab: { id: "preview", filePreview: { kind: "image" } },
      driver: "mongodb",
      capabilities: defaultDatabaseCapabilities("mongodb"),
    });
    const diff = editorDocumentIdentity({
      tab: { id: "diff", gitFileDiffPreview: {} },
      driver: "postgres",
      capabilities: defaultDatabaseCapabilities("postgres"),
    });

    expect(mongo).toMatchObject({
      documentLanguageId: "mongodb",
      editorLanguageId: "json",
      canUseLsp: true,
    });
    expect(preview.canUseLsp).toBe(false);
    expect(diff.canUseLsp).toBe(false);
  });

  it("keeps Elasticsearch EQL separate from DSL JSON completion", () => {
    const eql = editorDocumentIdentity({
      tab: { id: "eql", queryLanguage: "elasticsearch-eql" },
      driver: "elasticsearch",
      capabilities: defaultDatabaseCapabilities("elasticsearch"),
    });
    const dsl = editorDocumentIdentity({
      tab: { id: "dsl", queryLanguage: "elasticsearch-dsl" },
      driver: "elasticsearch",
      capabilities: defaultDatabaseCapabilities("elasticsearch"),
    });

    expect(eql).toMatchObject({
      documentLanguageId: "elasticsearch-eql",
      editorLanguageId: "plaintext",
      canUseLsp: false,
      isElasticsearchConsole: false,
    });
    expect(dsl).toMatchObject({
      documentLanguageId: "elasticsearch-dsl",
      editorLanguageId: "elasticsearch-console",
      canUseLsp: true,
      isElasticsearchConsole: true,
    });
  });

  it("does not advertise generic SQL completion for an unactivated driver package", () => {
    const identity = editorDocumentIdentity({
      tab: { id: "oracle" },
      driver: "oracle",
      capabilities: defaultDatabaseCapabilities("oracle"),
    });

    expect(identity).toMatchObject({
      documentLanguageId: "sql",
      canUseLsp: false,
      usesGenericSqlLsp: false,
    });
  });
});
