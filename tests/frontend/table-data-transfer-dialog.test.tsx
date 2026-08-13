/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canRetryTableDataTransferReport,
  canExecuteTableDataTransfer,
  supportsBoundedTableDataTransfer,
  supportsTableDataTransferUpsert,
  TableDataTransferDialog,
} from "@/components/workspace/TableDataTransferDialog";
import type {
  TableDataTransferPreview,
  TableDataTransferReport,
} from "@/services/tauri/types";
import transferReportFixture from "../fixtures/table-data-transfer-report.json";
import transferPreviewFixture from "../fixtures/table-data-transfer-preview.json";

const mocks = vi.hoisted(() => ({
  ensureConnectionReady: vi.fn(),
  getDatabaseCapabilities: vi.fn(),
  getDatabases: vi.fn(),
  getSchemas: vi.fn(),
  getDatabaseSchemas: vi.fn(),
  getTables: vi.fn(),
  getDatabaseTables: vi.fn(),
  previewTableDataTransfer: vi.fn(),
  previewTableDataTransferTarget: vi.fn(),
  createTableDataTransferTarget: vi.fn(),
  executeTableDataTransfer: vi.fn(),
  cancelTableDataTransfer: vi.fn(),
  listTableDataTransferReports: vi.fn(),
  listenTableDataTransferProgress: vi.fn(),
}));

vi.mock("@/store/useConnectionStore", () => ({
  ensureConnectionReady: mocks.ensureConnectionReady,
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
  },
  schemaService: {
    getDatabases: mocks.getDatabases,
    getSchemas: mocks.getSchemas,
    getDatabaseSchemas: mocks.getDatabaseSchemas,
    getTables: mocks.getTables,
    getDatabaseTables: mocks.getDatabaseTables,
  },
  tableService: {
    previewTableDataTransfer: mocks.previewTableDataTransfer,
    previewTableDataTransferTarget: mocks.previewTableDataTransferTarget,
    createTableDataTransferTarget: mocks.createTableDataTransferTarget,
    executeTableDataTransfer: mocks.executeTableDataTransfer,
    cancelTableDataTransfer: mocks.cancelTableDataTransfer,
    listTableDataTransferReports: mocks.listTableDataTransferReports,
    listenTableDataTransferProgress: mocks.listenTableDataTransferProgress,
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("TableDataTransferDialog", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureConnectionReady.mockResolvedValue({ status: "ready" });
    mocks.getDatabases.mockResolvedValue(["default", "archive"]);
    mocks.getDatabaseSchemas.mockResolvedValue(["public"]);
    mocks.getDatabaseTables.mockResolvedValue([
      { name: "users_copy", type: "BASE TABLE" },
    ]);
    mocks.getSchemas.mockResolvedValue(["public"]);
    mocks.getTables.mockResolvedValue([{ name: "users_copy", type: "BASE TABLE" }]);
    mocks.listenTableDataTransferProgress.mockResolvedValue(vi.fn());
    mocks.listTableDataTransferReports.mockResolvedValue([]);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("uses the selected catalog before discovering target schemas and tables", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue({
      driver: "duckdb",
      supportsDatabaseCatalogs: true,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataTransferDialog
          open
          source={{
            connectionId: "source",
            driver: "postgres",
            database: "archive",
            schema: "public",
            table: "users",
          }}
          connections={[
            { id: "source", name: "Source", driver: "postgres", url: "postgres://source" },
            {
              id: "target",
              name: "Target",
              driver: "duckdb",
              url: "duckdb:///tmp/target.duckdb",
              driverPackageVersion: "1.0.0",
            },
          ]}
          onClose={vi.fn()}
          onTransferred={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(mocks.getDatabaseSchemas).toHaveBeenCalledWith("target", "archive");
      expect(mocks.getDatabaseTables).toHaveBeenCalledWith(
        "target",
        "archive",
        "public",
      );
    });
    expect(mocks.getDatabaseCapabilities).toHaveBeenCalledWith(
      "duckdb",
      "1.0.0",
    );
    expect(mocks.getSchemas).not.toHaveBeenCalled();
    expect(mocks.getTables).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Database");
    expect(document.body.textContent).toContain("Copy mode");
  });

  it("only advertises drivers with the backend's verified transfer dialect", () => {
    expect(supportsBoundedTableDataTransfer("postgresql")).toBe(true);
    expect(supportsBoundedTableDataTransfer("MariaDB")).toBe(true);
    expect(supportsBoundedTableDataTransfer("sqlite3")).toBe(true);
    expect(supportsBoundedTableDataTransfer("duckdb")).toBe(true);
    expect(supportsBoundedTableDataTransfer("sqlserver")).toBe(false);
    expect(supportsBoundedTableDataTransfer("jdbc")).toBe(false);
    expect(
      supportsBoundedTableDataTransfer("postgres", {
        supportsTableDataTransfer: false,
      } as NonNullable<Parameters<typeof supportsBoundedTableDataTransfer>[1]>),
    ).toBe(false);
    expect(
      supportsBoundedTableDataTransfer("warehouse", {
        supportsTableDataTransfer: true,
      } as NonNullable<Parameters<typeof supportsBoundedTableDataTransfer>[1]>),
    ).toBe(true);
  });

  it("never enables execution for a preview with unsupported mappings", () => {
    const preview = {
      confirmationToken: "TRANSFER A13F9C",
      canExecute: false,
    } as TableDataTransferPreview;

    expect(
      canExecuteTableDataTransfer(preview, "TRANSFER A13F9C", false),
    ).toBe(false);
  });

  it("keeps the reviewed preview contract bounded and refuses unsupported mappings", () => {
    const previews = transferPreviewFixture as {
      append: TableDataTransferPreview;
      unsupported: TableDataTransferPreview;
    };

    expect(previews.append.targetRowsBefore).toBe(41);
    expect(previews.append.identityReseedColumns).toEqual(["id"]);
    expect(previews.append.confirmationToken).toMatch(/^TRANSFER [A-Z0-9]+$/u);
    expect(previews.append.mappedColumns).toHaveLength(2);
    expect(previews.append.mappedColumns.every((column) => column.compatibility !== "unsupported")).toBe(true);
    expect(canExecuteTableDataTransfer(previews.append, previews.append.confirmationToken, false)).toBe(true);

    expect(previews.unsupported.canExecute).toBe(false);
    expect(previews.unsupported.mappedColumns[0]?.compatibility).toBe("unsupported");
    expect(canExecuteTableDataTransfer(
      previews.unsupported,
      previews.unsupported.confirmationToken,
      false,
    )).toBe(false);
    expect(JSON.stringify(previews)).not.toMatch(
      /password|credential|connectionString|\bsql\b|parameters|rows?Values/i,
    );
  });

  it("keeps the cross-layer transfer report fixture privacy-bounded and backward compatible", () => {
    const reports = transferReportFixture as {
      current: TableDataTransferReport;
      legacy: TableDataTransferReport;
    };

    expect(reports.current.targetRowsBefore).toBe(41);
    expect(reports.current.verification).toMatchObject({
      status: "verified",
      expectedRows: 43,
      observedRows: 43,
    });
    expect(reports.legacy.targetRowsBefore).toBeUndefined();
    expect(reports.legacy.verification).toBeUndefined();
    expect(JSON.stringify(reports)).not.toMatch(
      /password|credential|connectionString|\bsql\b|parameters|rows?Values/i,
    );
  });

  it("keeps upsert behind the bundled semantic SQL boundary", () => {
    expect(supportsTableDataTransferUpsert("bundled")).toBe(true);
    expect(supportsTableDataTransferUpsert("external")).toBe(false);
    expect(supportsTableDataTransferUpsert(null)).toBe(false);
  });

  it("only permits a report to seed a fresh retry for the same source relation", () => {
    const source = {
      connectionId: "source",
      driver: "postgres" as const,
      database: "app",
      schema: "public",
      table: "users",
    };
    const report = {
      id: "table-transfer-report-1",
      projectId: "project-a",
      transferId: "transfer-0001",
      source,
      target: {
        connectionId: "target",
        driver: "postgres",
        database: "archive",
        schema: "public",
        table: "users_copy",
      },
      mode: "append",
      planDigest: "a".repeat(64),
      maxRows: 100,
      rowsTransferred: 2,
      batches: 1,
      limitReached: false,
      status: "done",
      startedAt: 1,
      finishedAt: 2,
      error: null,
    } satisfies TableDataTransferReport;

    expect(canRetryTableDataTransferReport(report, source)).toBe(true);
    expect(
      canRetryTableDataTransferReport(report, { ...source, table: "admins" }),
    ).toBe(false);
    expect(
      canRetryTableDataTransferReport(report, { ...source, database: undefined }),
    ).toBe(false);
  });

  it("requires the exact current plan token and an idle request", () => {
    const preview = {
      confirmationToken: "TRANSFER A13F9C",
      canExecute: true,
    } as TableDataTransferPreview;

    expect(
      canExecuteTableDataTransfer(preview, "TRANSFER A13F9C", false),
    ).toBe(true);
    expect(
      canExecuteTableDataTransfer(preview, "TRANSFER A13F9D", false),
    ).toBe(false);
    expect(
      canExecuteTableDataTransfer(preview, "TRANSFER A13F9C", true),
    ).toBe(false);
  });

  it("retains the reviewed target baseline in recent transfer history", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue({
      driver: "postgres",
      supportsDatabaseCatalogs: false,
      supportsTableDataTransfer: true,
    });
    mocks.listTableDataTransferReports.mockResolvedValue([
      {
        id: "table-transfer-report-append",
        projectId: "project-a",
        transferId: "transfer-append",
        source: {
          connectionId: "source",
          driver: "postgres",
          schema: "public",
          table: "users",
        },
        target: {
          connectionId: "target",
          driver: "postgres",
          schema: "public",
          table: "users_copy",
        },
        mode: "append",
        planDigest: "b".repeat(64),
        maxRows: 100,
        rowsTransferred: 2,
        batches: 1,
        limitReached: false,
        targetRowsBefore: 41,
        status: "done",
        startedAt: 1,
        finishedAt: 2,
        error: null,
      } satisfies TableDataTransferReport,
    ]);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataTransferDialog
          open
          projectId="project-a"
          source={{
            connectionId: "source",
            driver: "postgres",
            schema: "public",
            table: "users",
          }}
          connections={[
            { id: "source", name: "Source", driver: "postgres", url: "postgres://source" },
            { id: "target", name: "Target", driver: "postgres", url: "postgres://target" },
          ]}
          onClose={vi.fn()}
          onTransferred={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("baseline 41");
    });
  });

  it("shows the reviewed target baseline for append transfer previews", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue({
      driver: "postgres",
      supportsDatabaseCatalogs: false,
      supportsTableDataTransfer: true,
    });
    mocks.previewTableDataTransfer.mockResolvedValue({
      mode: "append",
      mappedColumns: [],
      skippedSourceColumns: [],
      previewRows: 2,
      maxRows: 100,
      batchSize: 20,
      targetRowsBefore: 41,
      targetRowsToDelete: null,
      upsertKeyColumns: [],
      identityReseedColumns: [],
      canExecute: true,
      confirmationToken: "TRANSFER B4SELINE",
      warnings: [],
    } satisfies TableDataTransferPreview);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataTransferDialog
          open
          source={{
            connectionId: "source",
            driver: "postgres",
            schema: "public",
            table: "users",
          }}
          connections={[
            { id: "source", name: "Source", driver: "postgres", url: "postgres://source" },
            { id: "target", name: "Target", driver: "postgres", url: "postgres://target" },
          ]}
          onClose={vi.fn()}
          onTransferred={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent?.includes("Preview transfer"),
        )?.hasAttribute("disabled"),
      ).toBe(false);
    });
    const previewButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Preview transfer"),
    );
    await act(async () => previewButton?.click());
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("target baseline 41 row(s)");
    });
  });

  it("uses the regular schema path when the target driver has no catalog layer", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue({
      driver: "sqlite",
      supportsDatabaseCatalogs: false,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataTransferDialog
          open
          source={{
            connectionId: "source",
            driver: "postgres",
            schema: "public",
            table: "users",
          }}
          connections={[
            { id: "source", name: "Source", driver: "postgres", url: "postgres://source" },
            { id: "target", name: "Target", driver: "sqlite", url: "sqlite:///tmp/target.sqlite" },
          ]}
          onClose={vi.fn()}
          onTransferred={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(mocks.getSchemas).toHaveBeenCalledWith("target");
      expect(mocks.getTables).toHaveBeenCalledWith("target", "public");
    });
    expect(mocks.getDatabases).not.toHaveBeenCalled();
    expect(mocks.getDatabaseSchemas).not.toHaveBeenCalled();
  });

  it("opens schema-level transfers with every source table selected", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue({
      driver: "postgres",
      displayName: "PostgreSQL",
      supportsDatabaseCatalogs: false,
      supportsTableDataTransfer: true,
    });
    mocks.getTables.mockImplementation(async (connectionId: string) =>
      connectionId === "source"
        ? [
            { name: "orders", type: "BASE TABLE" },
            { name: "users", type: "BASE TABLE" },
            { name: "users_view", type: "VIEW" },
          ]
        : [
            { name: "orders", type: "BASE TABLE" },
            { name: "users", type: "BASE TABLE" },
          ],
    );

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataTransferDialog
          open
          initialSourceScope="schema"
          source={{
            connectionId: "source",
            driver: "postgres",
            schema: "public",
            table: "orders",
          }}
          sourceCapabilities={
            {
              displayName: "PostgreSQL",
              supportsTableDataTransfer: true,
            } as Parameters<typeof TableDataTransferDialog>[0]["sourceCapabilities"]
          }
          connections={[
            { id: "source", name: "Source", driver: "postgres", url: "postgres://source" },
            { id: "target", name: "Target", driver: "postgres", url: "postgres://target" },
          ]}
          onClose={vi.fn()}
          onTransferred={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Transfer schema data");
      expect(document.body.textContent).toContain("2 selected");
    });
    expect(document.body.textContent).not.toContain("users_view");
  });

  it("keeps database-level transfer scoped to one explicitly selected source schema", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue({
      driver: "postgres",
      displayName: "PostgreSQL",
      supportsDatabaseCatalogs: false,
      supportsTableDataTransfer: true,
    });
    mocks.getDatabaseSchemas.mockResolvedValue(["public", "audit"]);
    mocks.getDatabaseTables.mockImplementation(
      async (connectionId: string, _database: string, schema: string) =>
        connectionId === "source" && schema === "public"
          ? [
              { name: "orders", type: "BASE TABLE" },
              { name: "users", type: "BASE TABLE" },
            ]
          : [{ name: "target_table", type: "BASE TABLE" }],
    );

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataTransferDialog
          open
          initialSourceScope="database"
          sourceSchemas={["public", "audit"]}
          source={{
            connectionId: "source",
            driver: "postgres",
            database: "app",
            schema: "public",
            table: "orders",
          }}
          sourceCapabilities={
            {
              displayName: "PostgreSQL",
              supportsTableDataTransfer: true,
            } as Parameters<typeof TableDataTransferDialog>[0]["sourceCapabilities"]
          }
          connections={[
            { id: "source", name: "Source", driver: "postgres", url: "postgres://source" },
            { id: "target", name: "Target", driver: "postgres", url: "postgres://target" },
          ]}
          onClose={vi.fn()}
          onTransferred={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Transfer database data");
      expect(document.body.textContent).toContain("Source schema");
      expect(document.body.textContent).toContain("2 selected");
    });
    expect(mocks.getDatabaseTables).toHaveBeenCalledWith(
      "source",
      "app",
      "public",
    );
    expect(document.body.textContent).toContain(
      "Choose a schema, then review all its tables as one bounded batch.",
    );
  });
});
