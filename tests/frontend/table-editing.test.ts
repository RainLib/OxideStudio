import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import type { ColumnInfo, IndexInfo } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  mutateTableRows: vi.fn(async () => ({
    inserted: 0,
    updated: 0,
    deleted: 0,
    rowsAffected: 0,
  })),
  getColumns: vi.fn(async () => []),
  getIndexes: vi.fn(async () => []),
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
    getIndexes: mocks.getIndexes,
  },
  tableService: {
    mutateTableRows: mocks.mutateTableRows,
    previewTablePage: mocks.previewTablePage,
  },
}));

vi.mock("@/services/tauri/schema.service", () => ({
  schemaService: {
    getColumns: mocks.getColumns,
    getIndexes: mocks.getIndexes,
  },
}));

function column(
  name: string,
  options: { primary?: boolean; unique?: boolean; nullable?: boolean } = {}
): ColumnInfo {
  const primary = options.primary || false;
  return {
    name,
    data_type: "text",
    is_nullable: options.nullable ?? !primary,
    is_primary_key: primary,
    is_unique: primary || Boolean(options.unique),
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
    mocks.getIndexes.mockClear();
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

  it("resets persisted column widths and order", () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          columnWidths: { email: 280 },
          columnOrder: ["email"],
          hiddenColumns: ["email"],
        },
      ],
    });

    useTabStore.getState().resetColumnLayout("tab-1");

    const tab = useTabStore.getState().tabs.find((item) => item.id === "tab-1");
    expect(tab?.columnWidths).toEqual({});
    expect(tab?.columnOrder).toEqual([]);
    expect(tab?.hiddenColumns).toEqual([]);
  });

  it("tracks column visibility per table tab", () => {
    useTabStore.getState().setColumnHidden("tab-1", "email", true);
    expect(useTabStore.getState().tabs[0]?.hiddenColumns).toEqual(["email"]);

    useTabStore.getState().showAllColumns("tab-1");
    expect(useTabStore.getState().tabs[0]?.hiddenColumns).toEqual([]);
  });

  it("surfaces a tab error when deleting rows without a primary key", async () => {
    await useTabStore.getState().deleteRows("tab-1", [0]);

    const tab = useTabStore.getState().tabs.find((item) => item.id === "tab-1");
    expect(mocks.mutateTableRows).not.toHaveBeenCalled();
    expect(tab?.error).toContain("no primary key");
  });

  it("uses a unique index to update rows when no primary key exists", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [column("email"), column("name")],
          tableIndexes: [
            {
              name: "users_email_key",
              columns: ["email"],
              is_unique: true,
              is_primary: false,
            },
          ],
          results: [
            {
              columns: [
                { name: "email", data_type: "text" },
                { name: "name", data_type: "text" },
              ],
              rows: [["old@example.test", "Old Name"]],
            },
          ],
          pendingEdits: new Map([["0:1", "New Name"]]),
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [{ key: { email: "old@example.test" }, values: { name: "New Name" } }],
      []
    );
  });

  it("fetches missing index metadata before saving existing row edits", async () => {
    const columns = [column("email"), column("name")];
    mocks.getColumns.mockResolvedValueOnce(columns);
    mocks.getIndexes.mockResolvedValueOnce([
      {
        name: "users_email_key",
        columns: ["email"],
        is_unique: true,
        is_primary: false,
      },
    ]);

    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: columns,
          tableIndexes: undefined,
          results: [
            {
              columns: [
                { name: "email", data_type: "text" },
                { name: "name", data_type: "text" },
              ],
              rows: [["old@example.test", "Old Name"]],
            },
          ],
          pendingEdits: new Map([["0:1", "New Name"]]),
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    expect(mocks.getIndexes).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users"
    );
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [{ key: { email: "old@example.test" }, values: { name: "New Name" } }],
      []
    );
  });

  it("uses a unique index to delete rows when no primary key exists", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [column("email"), column("name")],
          tableIndexes: [
            {
              name: "users_email_key",
              columns: ["email"],
              is_unique: true,
              is_primary: false,
            },
          ],
          results: [
            {
              columns: [
                { name: "email", data_type: "text" },
                { name: "name", data_type: "text" },
              ],
              rows: [["old@example.test", "Old Name"]],
            },
          ],
        },
      ],
    });

    await useTabStore.getState().deleteRows("tab-1", [0]);

    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [],
      [{ key: { email: "old@example.test" } }]
    );
  });

  it("refreshes open table tabs with fresh metadata after structure changes", async () => {
    const columns = [column("id", { primary: true }), column("email")];
    const indexes: IndexInfo[] = [
      {
        name: "users_pkey",
        columns: ["id"],
        is_unique: true,
        is_primary: true,
      },
    ];
    mocks.getColumns.mockResolvedValueOnce(columns);
    mocks.getIndexes.mockResolvedValueOnce(indexes);
    mocks.previewTablePage.mockResolvedValueOnce({
      result: {
        columns: [
          { name: "id", data_type: "int4" },
          { name: "email", data_type: "text" },
        ],
        rows: [[1, "new@example.test"]],
      },
      page: 2,
      pageSize: 500,
      totalRows: 1,
    });

    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [column("legacy_email")],
          tableIndexes: [],
          tablePage: 2,
          tableFilterSql: "email is not null",
          pendingEdits: new Map([["0:0", "draft@example.test"]]),
          newRowsCount: 1,
        },
      ],
    });

    await useTabStore
      .getState()
      .refreshTableTabs("postgres-1", "public", "users");

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.getColumns).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users"
    );
    expect(mocks.getIndexes).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users"
    );
    expect(mocks.previewTablePage).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      2,
      500,
      "email is not null",
      undefined,
      undefined
    );
    expect(tab.tableColumns).toEqual(columns);
    expect(tab.tableIndexes).toEqual(indexes);
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
    expect(tab.results?.[0]?.columns.map((item) => item.name)).toEqual([
      "id",
      "email",
    ]);
  });

  it("clears stale pending edits when a table page is replaced", async () => {
    mocks.previewTablePage.mockResolvedValueOnce({
      result: {
        columns: [{ name: "email", data_type: "text" }],
        rows: [["fresh@example.test"]],
      },
      page: 1,
      pageSize: 500,
      totalRows: 1,
    });

    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          newRowsCount: 1,
          pendingEdits: new Map([["0:0", "draft@example.test"]]),
        },
      ],
    });

    await useTabStore.getState().loadTablePage("tab-1", 1);

    const tab = useTabStore.getState().tabs[0]!;
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
    expect(tab.results?.[0]?.rows).toEqual([["fresh@example.test"]]);
  });

  it("clears stale pending edits after deleting rows and reloading table data", async () => {
    mocks.previewTablePage.mockResolvedValueOnce({
      result: {
        columns: [
          { name: "id", data_type: "int4" },
          { name: "email", data_type: "text" },
        ],
        rows: [],
      },
      page: 0,
      pageSize: 500,
      totalRows: 0,
    });

    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [column("id", { primary: true }), column("email")],
          tableIndexes: [
            {
              name: "users_pkey",
              columns: ["id"],
              is_unique: true,
              is_primary: true,
            },
          ],
          results: [
            {
              columns: [
                { name: "id", data_type: "int4" },
                { name: "email", data_type: "text" },
              ],
              rows: [[1, "old@example.test"]],
            },
          ],
          newRowsCount: 1,
          pendingEdits: new Map([["0:1", "draft@example.test"]]),
        },
      ],
    });

    await useTabStore.getState().deleteRows("tab-1", [0]);

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [],
      [{ key: { id: 1 } }]
    );
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
  });
});
