import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableService } from "@/services/tauri/table.service";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("table service database scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({
      success: true,
      data: {
        result: { columns: [], rows: [] },
        page: 0,
        pageSize: 500,
        totalRows: 0,
      },
    });
  });

  it("maps databaseName to the preview_table_page database payload", async () => {
    await tableService.previewTablePage(
      "postgres-1",
      "postgres",
      "public",
      "users",
      0,
      500,
      undefined,
      undefined,
      undefined,
      "analytics"
    );

    expect(mocks.invoke).toHaveBeenCalledWith("preview_table_page", {
      connectionId: "postgres-1",
      driver: "postgres",
      schema: "public",
      table: "users",
      page: 0,
      pageSize: 500,
      filterSql: undefined,
      filters: undefined,
      sort: undefined,
      database: "analytics",
    });
  });

  it("passes SQL export and JSON import options through the table contract", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        success: true,
        data: { filePath: "/tmp/users.sql", rowsExported: 2 },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          filePath: "/tmp/users.json",
          rowsImported: 2,
          batches: 1,
        },
      });

    await tableService.exportTableData(
      "postgres-1",
      "postgres",
      "public",
      "users",
      "sql",
    );
    await tableService.importTableData(
      "postgres-1",
      "postgres",
      "public",
      "users",
      "/tmp/users.json",
      "json",
      true,
      "analytics",
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "export_table_data", {
      connectionId: "postgres-1",
      driver: "postgres",
      schema: "public",
      table: "users",
      format: "sql",
      filterSql: undefined,
      filters: undefined,
      sort: undefined,
      pageSize: 5000,
      maxRows: undefined,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "import_table_data", {
      connectionId: "postgres-1",
      driver: "postgres",
      schema: "public",
      table: "users",
      filePath: "/tmp/users.json",
      format: "json",
      firstRowHeader: true,
      database: "analytics",
    });
  });
});
