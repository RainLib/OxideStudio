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
});
