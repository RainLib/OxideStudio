import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { exportDatabaseSql } from "./table.service";

describe("exportDatabaseSql", () => {
  beforeEach(() => {
    invokeWithInterceptors.mockReset();
    invokeWithInterceptors.mockResolvedValue({
      exportId: "selected-export",
      filePath: "selected.sql",
      tablesExported: 2,
      rowsExported: 3,
      omittedObjectKinds: [],
    });
  });

  it("forwards the exact selected table order to the host", async () => {
    await exportDatabaseSql("connection-1", "postgres", "public", {
      exportId: "selected-export",
      includeStructure: false,
      includeData: true,
      tableNames: ["audit_log", "accounts"],
      pageSize: 250,
      sqlInsertBatchSize: 80,
    });

    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "export_database_sql",
      {
        connectionId: "connection-1",
        exportId: "selected-export",
        driver: "postgres",
        schema: "public",
        includeStructure: false,
        includeData: true,
        tableNames: ["audit_log", "accounts"],
        pageSize: 250,
        sqlInsertBatchSize: 80,
      },
    );
  });
});
