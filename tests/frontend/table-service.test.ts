import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableService } from "@/services/tauri/table.service";
import type { TableDataTransferBatchPlan } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
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
      {
        exportId: "table-export-test",
        projectId: "project-1",
        encoding: "utf8",
      },
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
      undefined,
      undefined,
      {
        importId: "table-import-test",
        projectId: "project-1",
      },
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "export_table_data", {
      connectionId: "postgres-1",
      exportId: "table-export-test",
      projectId: "project-1",
      encoding: "utf8",
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
      importId: "table-import-test",
      projectId: "project-1",
      driver: "postgres",
      schema: "public",
      table: "users",
      filePath: "/tmp/users.json",
      format: "json",
      mode: "append",
      firstRowHeader: true,
      database: "analytics",
      csvOptions: undefined,
      expectedFileDigest: undefined,
    });
  });

  it("passes an explicit reviewed CSV plan to the native streaming importer", async () => {
    await tableService.importTableData(
      "postgres-1",
      "postgres",
      "public",
      "users",
      "/tmp/users.csv",
      "csv",
      true,
      "analytics",
      {
        delimiter: ";",
        firstRowHeader: true,
        columnMapping: [
          { sourceIndex: 0, targetColumn: "id" },
          { sourceIndex: 1, targetColumn: null },
        ],
        emptyFieldsAsNull: true,
      },
      "sha256:test",
      {
        importId: "table-import-csv-test",
        projectId: "project-1",
      },
    );

    expect(mocks.invoke).toHaveBeenCalledWith("import_table_data", {
      connectionId: "postgres-1",
      importId: "table-import-csv-test",
      projectId: "project-1",
      driver: "postgres",
      schema: "public",
      table: "users",
      filePath: "/tmp/users.csv",
      format: "csv",
      mode: "append",
      firstRowHeader: true,
      database: "analytics",
      csvOptions: {
        delimiter: ";",
        firstRowHeader: true,
        columnMapping: [
          { sourceIndex: 0, targetColumn: "id" },
          { sourceIndex: 1, targetColumn: null },
        ],
        emptyFieldsAsNull: true,
      },
      expectedFileDigest: "sha256:test",
    });
  });

  it("requests a bounded native CSV preview before a reviewed streaming import", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        fileName: "users.csv",
        bytes: [101, 109, 97, 105, 108],
        totalBytes: 5,
        truncated: false,
      },
    });

    await tableService.previewTableCsvImport("/tmp/users.csv");

    expect(mocks.invoke).toHaveBeenCalledWith("preview_table_csv_import", {
      filePath: "/tmp/users.csv",
    });
  });

  it("requests a structured JSON preview before a reviewed import", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        fileName: "users.json",
        totalBytes: 32,
        sourceColumns: ["id", "email"],
        sampleRows: [{ id: 1, email: "reader@example.test" }],
        totalRows: 1,
        truncated: false,
      },
    });

    await tableService.previewTableJsonImport("/tmp/users.json");

    expect(mocks.invoke).toHaveBeenCalledWith("preview_table_json_import", {
      filePath: "/tmp/users.json",
    });
  });

  it("requests a structured XLSX preview before a reviewed import", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        fileName: "users.xlsx",
        totalBytes: 128,
        sheetName: "Users",
        sourceColumns: ["id", "email"],
        sampleRows: [{ id: 1, email: "reader@example.test" }],
        totalRows: 1,
        truncated: false,
      },
    });

    await tableService.previewTableXlsxImport("/tmp/users.xlsx");

    expect(mocks.invoke).toHaveBeenCalledWith("preview_table_xlsx_import", {
      filePath: "/tmp/users.xlsx",
    });
  });

  it("keeps database-to-database copies behind an explicit preview and confirmation token", async () => {
    const request = {
      projectId: "project-a",
      transferId: "transfer-test-0001",
      source: {
        connectionId: "source",
        driver: "postgres" as const,
        schema: "public",
        table: "users",
      },
      target: {
        connectionId: "target",
        driver: "mysql" as const,
        schema: "app",
        table: "users_copy",
      },
      maxRows: 500,
      batchSize: 100,
      mode: "overwrite" as const,
    };
    mocks.invoke
      .mockResolvedValueOnce({
        success: true,
        data: { confirmationToken: "TRANSFER A13F9C", mappedColumns: [] },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { rowsTransferred: 2, batches: 1, limitReached: false },
      });

    await tableService.previewTableDataTransfer(request);
    await tableService.executeTableDataTransfer(request, "TRANSFER A13F9C");

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "preview_table_data_transfer",
      { request },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "execute_table_data_transfer",
      { request, confirmationToken: "TRANSFER A13F9C" },
    );
  });

  it("reviews and confirms creation of an empty transfer target separately from row copying", async () => {
    const request = {
      source: {
        connectionId: "source",
        driver: "postgres" as const,
        database: "source_db",
        schema: "public",
        table: "users",
      },
      target: {
        connectionId: "target",
        driver: "mysql" as const,
        database: "target_db",
        schema: "app",
        table: "users_copy",
      },
    };
    mocks.invoke
      .mockResolvedValueOnce({
        success: true,
        data: {
          confirmationToken: "CREATE A13F9C21",
          columns: [],
          statements: ["CREATE TABLE `app`.`users_copy` (`id` BIGINT);"],
          warnings: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          table: "users_copy",
          statements: ["CREATE TABLE `app`.`users_copy` (`id` BIGINT);"],
        },
      });

    await tableService.previewTableDataTransferTarget(request);
    await tableService.createTableDataTransferTarget(
      request,
      "CREATE A13F9C21",
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "preview_table_data_transfer_target",
      { request },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "create_table_data_transfer_target",
      { request, confirmationToken: "CREATE A13F9C21" },
    );
  });

  it("cancels a transfer by its stable id and filters progress payloads in the caller", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: "Transfer cancellation requested",
    });
    const unlisten = vi.fn();
    mocks.listen.mockResolvedValueOnce(unlisten);
    const progress = vi.fn();

    await tableService.cancelTableDataTransfer("transfer-test-0001");
    const stop = await tableService.listenTableDataTransferProgress(progress);

    expect(mocks.invoke).toHaveBeenCalledWith("cancel_table_data_transfer", {
      transferId: "transfer-test-0001",
    });
    expect(mocks.listen).toHaveBeenCalledWith(
      "table-data-transfer://progress",
      expect.any(Function),
    );
    const eventListener = mocks.listen.mock.calls[0]?.[1] as
      | ((event: { payload: unknown }) => void)
      | undefined;
    eventListener?.({
      payload: {
        transferId: "transfer-test-0001",
        rowsTransferred: 250,
        maxRows: 1000,
        batches: 1,
        status: "running",
        terminal: false,
      },
    });
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ rowsTransferred: 250, status: "running" }),
    );
    expect(stop).toBe(unlisten);
  });

  it("previews create-table SQL without a connection or execution request", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: ["CREATE TABLE public.users (id INT);"],
    });
    const columns = [
      {
        name: "id",
        dataType: "INT",
        length: null,
        isPrimaryKey: true,
        isNotNull: true,
        isAutoIncrement: false,
        comment: null,
      },
    ];

    await expect(
      tableService.previewCreateTable("postgres", "public", "users", columns),
    ).resolves.toEqual(["CREATE TABLE public.users (id INT);"]);
    expect(mocks.invoke).toHaveBeenCalledWith("preview_create_table", {
      driver: "postgres",
      schema: "public",
      table: "users",
      columns,
    });
  });

  it("asks the backend for one FK-ordered multi-table plan instead of looping table writes in the UI", async () => {
    const request = {
      sourceConnectionId: "source",
      sourceDriver: "postgres" as const,
      sourceSchema: "public",
      targetConnectionId: "target",
      targetDriver: "postgres" as const,
      targetSchema: "archive",
      tables: ["users", "orders"],
      mode: "append" as const,
    };
    const plan = {
      orderedTables: ["users", "orders"],
      dependencies: [{ prerequisiteTable: "users", dependentTable: "orders", constraintName: "orders_user_fk" }],
      cyclicTables: [],
      tablePreflights: [
        { table: "users", canExecute: true, mappedColumns: 2, warnings: [] },
        { table: "orders", canExecute: true, mappedColumns: 3, warnings: [] },
      ],
      canExecute: true,
      confirmationToken: "BATCH TRANSFER 12345678",
      warnings: [],
    } satisfies TableDataTransferBatchPlan;
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: plan,
    });

    const result = await tableService.previewTableDataTransferBatchPlan(request);

    expect(mocks.invoke).toHaveBeenCalledWith(
      "preview_table_data_transfer_batch_plan",
      { request },
    );
    expect(result.tablePreflights).toEqual(plan.tablePreflights);
  });

  it("loads privacy-bounded terminal reports from the target connection history", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: [{
        id: "table-transfer-report-transfer-test-0001",
        projectId: "project-a",
        transferId: "transfer-test-0001",
        source: { connectionId: "source", driver: "postgres", schema: "public", table: "users" },
        target: { connectionId: "target", driver: "mysql", schema: "app", table: "users_copy" },
        mode: "append",
        planDigest: "a".repeat(64),
        maxRows: 1000,
        rowsTransferred: 2,
        batches: 1,
        limitReached: false,
        status: "done",
        startedAt: 1,
        finishedAt: 2,
        error: null,
      }],
    });

    const reports = await tableService.listTableDataTransferReports("project-a", "target", 10);

    expect(reports).toHaveLength(1);
    expect(mocks.invoke).toHaveBeenCalledWith("list_table_data_transfer_reports", {
      projectId: "project-a",
      connectionId: "target",
      limit: 10,
    });
  });
});
