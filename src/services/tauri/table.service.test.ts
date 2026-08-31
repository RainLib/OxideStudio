import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import {
  exportDatabaseSql,
  exportTableData,
  importTableData,
  preflightTableCsvImport,
} from "./table.service";

describe("exportTableData", () => {
  beforeEach(() => {
    invokeWithInterceptors.mockReset();
    invokeWithInterceptors.mockResolvedValue({
      exportId: "xlsx-export",
      filePath: "users.xlsx",
      rowsExported: 1,
      batches: 1,
      typeCoercions: [],
    });
  });

  it("forwards the reviewed XLSX auto-filter choice to the host", async () => {
    await exportTableData(
      "connection-1",
      "postgres",
      "public",
      "users",
      "xlsx",
      {
        exportId: "xlsx-export",
        encoding: "binary",
        xlsxAutoFilter: false,
      },
    );

    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "export_table_data",
      expect.objectContaining({
        connectionId: "connection-1",
        exportId: "xlsx-export",
        format: "xlsx",
        xlsxAutoFilter: false,
      }),
    );
  });
});

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

describe("table import write mode", () => {
  beforeEach(() => {
    invokeWithInterceptors.mockReset();
    invokeWithInterceptors.mockResolvedValue({
      importId: "table-import-test",
      filePath: "users.csv",
      rowsImported: 2,
      batches: 1,
    });
  });

  it("defaults imports to append and forwards an explicit transactional replace", async () => {
    await importTableData(
      "connection-1", "postgres", "public", "users", "users.csv", "csv",
    );
    expect(invokeWithInterceptors).toHaveBeenLastCalledWith(
      "import_table_data",
      expect.objectContaining({ mode: "append" }),
    );

    await importTableData(
      "connection-1", "postgres", "public", "users", "users.csv", "csv",
      true, undefined, undefined, "sha256", { mode: "truncate" },
    );
    expect(invokeWithInterceptors).toHaveBeenLastCalledWith(
      "import_table_data",
      expect.objectContaining({ mode: "truncate" }),
    );
  });

  it("binds the same mode into CSV preflight", async () => {
    await preflightTableCsvImport(
      "connection-1", "postgres", "public", "users", "users.csv",
      true, undefined, undefined, "sha256", "truncate",
    );
    expect(invokeWithInterceptors).toHaveBeenLastCalledWith(
      "preflight_table_csv_import",
      expect.objectContaining({ mode: "truncate" }),
    );
  });
});
