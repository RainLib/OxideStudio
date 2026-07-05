import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import type { ColumnInfo } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  mutateTableRows: vi.fn(async () => ({
    inserted: 0,
    updated: 0,
    deleted: 0,
    rowsAffected: 0,
  })),
  getColumns: vi.fn(async () => []),
  previewTablePage: vi.fn(async () => ({
    result: { columns: [], rows: [] },
    page: 0,
    pageSize: 500,
    totalRows: 0,
  })),
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: vi.fn(async () => ({})),
  },
  queryService: {
    executeQuery: vi.fn(async () => []),
  },
  schemaService: {
    getColumns: mocks.getColumns,
  },
  tableService: {
    mutateTableRows: mocks.mutateTableRows,
    previewTablePage: mocks.previewTablePage,
  },
}));

vi.mock("@/services/tauri/schema.service", () => ({
  schemaService: {
    getColumns: mocks.getColumns,
  },
}));

function column(name: string, primary = false): ColumnInfo {
  return {
    name,
    data_type: "text",
    is_nullable: !primary,
    is_primary_key: primary,
    is_unique: primary,
    is_indexed: primary,
    default_value: null,
    is_auto_increment: false,
    comment: null,
  };
}

describe("table editing store", () => {
  beforeEach(() => {
    mocks.mutateTableRows.mockClear();
    mocks.getColumns.mockClear();
    mocks.previewTablePage.mockClear();

    useConnectionStore.setState({
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/app",
        },
      ],
      activeConnectionId: "postgres-1",
      isConnected: true,
      isLoading: false,
      selectedConnection: null,
    });

    useTabStore.setState({
      activeTabId: "tab-1",
      closedTabsStack: [],
      tabs: [
        {
          id: "tab-1",
          title: "users",
          type: "table",
          sql: "",
          connectionId: "postgres-1",
          schemaName: "public",
          tableName: "users",
          tableColumns: [column("email")],
          results: [
            {
              columns: [{ name: "email", data_type: "text" }],
              rows: [["old@example.test"]],
            },
          ],
          pendingEdits: new Map([["0:0", "new@example.test"]]),
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });
  });

  it("surfaces a tab error when updating rows without a primary key", async () => {
    await useTabStore.getState().commitEdits("tab-1");

    const tab = useTabStore.getState().tabs.find((item) => item.id === "tab-1");
    expect(mocks.mutateTableRows).not.toHaveBeenCalled();
    expect(tab?.error).toContain("no primary key");
    expect(tab?.pendingEdits?.size).toBe(1);
  });

  it("surfaces a tab error when deleting rows without a primary key", async () => {
    await useTabStore.getState().deleteRows("tab-1", [0]);

    const tab = useTabStore.getState().tabs.find((item) => item.id === "tab-1");
    expect(mocks.mutateTableRows).not.toHaveBeenCalled();
    expect(tab?.error).toContain("no primary key");
  });
});
