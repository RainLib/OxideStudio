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
});
