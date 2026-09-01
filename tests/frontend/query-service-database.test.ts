import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryService } from "@/services/tauri/query.service";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("query service database scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({ success: true, data: [] });
  });

  it("passes the selected database to execute_query", async () => {
    await queryService.executeQuery(
      "postgres-1",
      "SELECT 1",
      "public",
      undefined,
      "query-1",
      "analytics",
    );

    expect(mocks.invoke).toHaveBeenCalledWith("execute_query", {
      connectionId: "postgres-1",
      sql: "SELECT 1",
      schema: "public",
      transactionId: undefined,
      queryId: "query-1",
      database: "analytics",
    });
  });

  it("sends Explain Plan as one structured request", async () => {
    const request = {
      connectionId: "postgres-1",
      sql: "SELECT * FROM users",
      schema: "public",
      database: "analytics",
      queryId: "plan-1",
      mode: "estimate" as const,
    };

    await queryService.explainQuery(request);

    expect(mocks.invoke).toHaveBeenCalledWith("explain_query", { request });
  });

  it("resolves the current statement using Monaco's UTF-16 cursor offset", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        sql: "SELECT 2",
        startOffset: 10,
        endOffset: 18,
        statementIndex: 1,
        statementCount: 2,
      },
    });

    await queryService.resolveSqlStatementAtCursor(
      "postgres-1",
      "SELECT 1; SELECT 2",
      15,
    );

    expect(mocks.invoke).toHaveBeenCalledWith(
      "resolve_sql_statement_at_cursor",
      {
        connectionId: "postgres-1",
        sql: "SELECT 1; SELECT 2",
        cursorOffset: 15,
      },
    );
  });

  it("validates SQL syntax locally without a connection or execution command", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        valid: true,
        driver: "postgres",
        statementCount: 1,
        diagnostics: [],
      },
    });

    await queryService.validateSqlSyntax("postgres", "SELECT 1");

    expect(mocks.invoke).toHaveBeenCalledWith("validate_sql_syntax", {
      driver: "postgres",
      sql: "SELECT 1",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "execute_query",
      expect.anything(),
    );
  });

  it("builds a DML preview through the pure parser command", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        sql: "SELECT *, 2 AS \"total (new)\" FROM orders WHERE id = 1",
        operation: "update",
        hasNewValueColumns: true,
        tables: [{ schema: "public", table: "orders" }],
      },
    });

    await queryService.buildDmlChangePreviewSql({
      sql: "UPDATE orders SET total = 2 WHERE id = 1",
      databaseType: "postgres",
      identifierQuote: "\"",
      columns: ["id", "total"],
    });

    expect(mocks.invoke).toHaveBeenCalledWith(
      "build_dml_change_preview_sql",
      {
        options: {
          sql: "UPDATE orders SET total = 2 WHERE id = 1",
          databaseType: "postgres",
          identifierQuote: "\"",
          columns: ["id", "total"],
        },
      },
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "execute_query",
      expect.anything(),
    );
  });

  it("passes an active package's editor language to syntax validation", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: { valid: true, driver: "trino", statementCount: 1, diagnostics: [] },
    });

    await queryService.validateSqlSyntax("trino", "SELECT 1", "sql");

    expect(mocks.invoke).toHaveBeenCalledWith("validate_sql_syntax", {
      driver: "trino",
      sql: "SELECT 1",
      lspLanguageId: "sql",
    });
  });

  it("passes a reviewed server parser separately from generic SQL document language", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: { valid: true, driver: "doris", statementCount: 1, diagnostics: [] },
    });

    await queryService.validateSqlSyntax("doris", "SELECT `id` FROM `orders`", "sql", "mysql");

    expect(mocks.invoke).toHaveBeenCalledWith("validate_sql_syntax", {
      driver: "doris",
      sql: "SELECT `id` FROM `orders`",
      lspLanguageId: "sql",
      lspServerDialect: "mysql",
    });
  });

  it("previews then imports a reviewed SQL script in the selected database and schema", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        fileName: "seed.sql",
        totalBytes: 120,
        statementCount: 3,
        statementPreview: ["CREATE TABLE seed (id integer)"],
        truncated: false,
        reviewDigest: "reviewed-script-digest",
      },
    });
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        filePath: "/tmp/seed.sql",
        statementsExecuted: 3,
        rowsAffected: 12,
      },
    });

    const preview = await queryService.previewSqlScriptImport("postgres-1", "/tmp/seed.sql");
    await queryService.importSqlScript(
      "postgres-1",
      "/tmp/seed.sql",
      preview.reviewDigest,
      "public",
      "analytics",
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "preview_sql_script_import", {
      connectionId: "postgres-1",
      filePath: "/tmp/seed.sql",
    });

    expect(mocks.invoke).toHaveBeenCalledWith("import_sql_script", {
      connectionId: "postgres-1",
      filePath: "/tmp/seed.sql",
      schema: "public",
      database: "analytics",
      reviewDigest: "reviewed-script-digest",
    });
  });

  it("uses native dialogs for Elasticsearch Console import and export", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        success: true,
        data: {
          filePath: "/tmp/requests.txt",
          fileName: "requests.txt",
          content: "GET /_cluster/health",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          exported: true,
          filePath: "/tmp/elasticsearch-console.txt",
          byteCount: 20,
        },
      });

    await queryService.importElasticsearchConsoleFile();
    await queryService.exportElasticsearchConsoleFile("GET /_cluster/health");

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "import_elasticsearch_console_file",
      undefined,
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "export_elasticsearch_console_file",
      { content: "GET /_cluster/health" },
    );
  });
});
