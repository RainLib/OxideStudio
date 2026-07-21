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

  it("imports a SQL script in the selected database and schema", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        filePath: "/tmp/seed.sql",
        statementsExecuted: 3,
        rowsAffected: 12,
      },
    });

    await queryService.importSqlScript(
      "postgres-1",
      "/tmp/seed.sql",
      "public",
      "analytics",
    );

    expect(mocks.invoke).toHaveBeenCalledWith("import_sql_script", {
      connectionId: "postgres-1",
      filePath: "/tmp/seed.sql",
      schema: "public",
      database: "analytics",
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
