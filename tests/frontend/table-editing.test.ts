/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import type { ColumnInfo, IndexInfo } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
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
  connectionService: {
    connect: mocks.connect,
    disconnect: mocks.disconnect,
  },
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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("table editing store", () => {
  beforeEach(() => {
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    mocks.mutateTableRows.mockReset().mockResolvedValue({
      inserted: 0,
      updated: 0,
      deleted: 0,
      rowsAffected: 0,
    });
    mocks.getColumns.mockReset().mockResolvedValue([]);
    mocks.getIndexes.mockReset().mockResolvedValue([]);
    mocks.previewTablePage.mockReset().mockResolvedValue({
      result: { columns: [], rows: [] },
      page: 0,
      pageSize: 500,
      totalRows: 0,
    });
    vi.stubGlobal("confirm", vi.fn(() => true));

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
      connectedConnectionIds: ["postgres-1"],
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

  it("keeps same-named table tabs isolated by PostgreSQL database", () => {
    useTabStore.setState({ tabs: [], activeTabId: null });

    const analyticsTab = useTabStore
      .getState()
      .findOrCreateTableTab(
        "postgres-1",
        "public",
        "users",
        "BASE TABLE",
        "analytics"
      );
    const archiveTab = useTabStore
      .getState()
      .findOrCreateTableTab(
        "postgres-1",
        "public",
        "users",
        "BASE TABLE",
        "archive"
      );
    const reusedAnalyticsTab = useTabStore
      .getState()
      .findOrCreateTableTab(
        "postgres-1",
        "public",
        "users",
        "VIEW",
        "analytics"
      );

    expect(archiveTab).not.toBe(analyticsTab);
    expect(reusedAnalyticsTab).toBe(analyticsTab);
    expect(useTabStore.getState().tabs).toHaveLength(2);
    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === analyticsTab)
    ).toMatchObject({
      title: "users · analytics",
      databaseName: "analytics",
      objectType: "VIEW",
    });
    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === archiveTab)
    ).toMatchObject({ title: "users · archive", databaseName: "archive" });
  });

  it("honors table-tab reuse modes without discarding pending edits", () => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    const store = useTabStore.getState();
    const firstTab = store.findOrCreateTableTab(
      "postgres-1",
      "public",
      "users",
      "BASE TABLE",
      undefined,
      { reuseMode: "same-table" },
    );
    const secondTab = store.findOrCreateTableTab(
      "postgres-1",
      "public",
      "users",
      "BASE TABLE",
      undefined,
      { reuseMode: "always-new" },
    );
    expect(secondTab).not.toBe(firstTab);

    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === secondTab
          ? { ...tab, pendingEdits: new Map([["0:0", "draft"]]) }
          : tab,
      ),
      activeTabId: secondTab,
    }));
    const protectedTab = useTabStore.getState().findOrCreateTableTab(
      "postgres-1",
      "public",
      "orders",
      "BASE TABLE",
      undefined,
      { reuseMode: "active-tab" },
    );
    expect(protectedTab).not.toBe(secondTab);

    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === protectedTab ? { ...tab, pendingEdits: new Map() } : tab,
      ),
      activeTabId: protectedTab,
    }));
    const reusedTab = useTabStore.getState().findOrCreateTableTab(
      "postgres-1",
      "public",
      "audit_log",
      "BASE TABLE",
      undefined,
      { reuseMode: "active-tab" },
    );
    expect(reusedTab).toBe(protectedTab);
    expect(useTabStore.getState().tabs.find((tab) => tab.id === reusedTab)).toMatchObject({
      tableName: "audit_log",
      schemaName: "public",
      results: null,
    });
  });

  it("opens native database objects as reusable data tabs", () => {
    useTabStore.setState({ tabs: [], activeTabId: null });

    const firstTab = useTabStore.getState().findOrCreateObjectDataTab(
      "mongo-1",
      "app",
      "users",
      "collection",
      '{"database":"app","collection":"users","find":{},"limit":100}',
      "Collection: users",
    );
    const reusedTab = useTabStore.getState().findOrCreateObjectDataTab(
      "mongo-1",
      "app",
      "users",
      "collection",
      '{"database":"app","collection":"users","find":{"active":true},"limit":100}',
      "Collection: users",
    );

    expect(reusedTab).toBe(firstTab);
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      type: "table",
      connectionId: "mongo-1",
      schemaName: "app",
      tableName: "users",
      objectType: "collection",
      sql: expect.stringContaining('"active":true'),
    });
  });

  it("passes an explicit PostgreSQL database when loading a table page", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          databaseName: "analytics",
          pendingEdits: new Map(),
        },
      ],
    });

    await useTabStore.getState().loadTablePage("tab-1", 0);

    expect(mocks.previewTablePage).toHaveBeenCalledWith(
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
  });

  it("reconnects a restored project data source before loading table data", async () => {
    useConnectionStore.setState({
      connectedConnectionIds: [],
      isConnected: false,
    });

    const loaded = await useTabStore.getState().loadTablePage("tab-1", 0);

    expect(loaded).toBe(true);
    expect(mocks.connect).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      expect.stringContaining("postgres://localhost"),
      undefined
    );
    expect(mocks.connect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.previewTablePage.mock.invocationCallOrder[0]!
    );
    expect(useConnectionStore.getState().connectedConnectionIds).toContain(
      "postgres-1"
    );
  });

  it("shows a useful error and skips table loading when reconnecting fails", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("login failed"));
    useConnectionStore.setState({
      connectedConnectionIds: [],
      isConnected: false,
    });

    const loaded = await useTabStore.getState().loadTablePage("tab-1", 0);

    expect(loaded).toBe(false);
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      isExecuting: false,
      error: 'Could not connect to "Postgres": login failed',
    });
  });

  it("cancels a stale table load when the project changes during reconnect", async () => {
    const pendingConnection = deferred();
    mocks.connect.mockImplementationOnce(() => pendingConnection.promise);
    localStorage.setItem("oxide-studio-active-project", "project-a");
    useConnectionStore.setState((state) => ({
      connections: state.connections.map((connection) => ({
        ...connection,
        projectId: "project-a",
      })),
      connectedConnectionIds: [],
      isConnected: false,
    }));

    const load = useTabStore.getState().loadTablePage("tab-1", 0);
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());

    localStorage.setItem("oxide-studio-active-project", "project-b");
    useTabStore.setState({ tabs: [], activeTabId: null });
    useConnectionStore.setState({
      connections: [],
      activeConnectionId: null,
      connectedConnectionIds: [],
      isConnected: false,
    });
    pendingConnection.resolve();

    await expect(load).resolves.toBe(false);
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(useTabStore.getState().tabs).toEqual([]);
    expect(useConnectionStore.getState().connectedConnectionIds).toEqual([]);
  });

  it("routes save and delete mutations to the selected PostgreSQL database", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          databaseName: "analytics",
          tableColumns: [column("email", { primary: true })],
          tableIndexes: [],
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    expect(mocks.mutateTableRows).toHaveBeenNthCalledWith(
      1,
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [
        {
          key: { email: "old@example.test" },
          values: { email: "new@example.test" },
        },
      ],
      [],
      "analytics"
    );

    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === "tab-1"
          ? {
              ...tab,
              results: [
                {
                  columns: [{ name: "email", data_type: "text" }],
                  rows: [["new@example.test"]],
                },
              ],
              pendingEdits: new Map(),
            }
          : tab
      ),
    }));
    await useTabStore.getState().deleteRows("tab-1", [0]);

    expect(mocks.mutateTableRows).toHaveBeenNthCalledWith(
      2,
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [],
      [{ key: { email: "new@example.test" } }],
      "analytics"
    );
  });

  it("retargets and refreshes only table tabs in the requested database", async () => {
    const baseTab = useTabStore.getState().tabs[0]!;
    useTabStore.setState({
      tabs: [
        {
          ...baseTab,
          id: "analytics-tab",
          databaseName: "analytics",
          pendingEdits: new Map(),
        },
        {
          ...baseTab,
          id: "archive-tab",
          databaseName: "archive",
          pendingEdits: new Map(),
        },
      ],
    });

    await useTabStore
      .getState()
      .refreshTableTabs("postgres-1", "public", "users", false, "analytics");

    expect(mocks.previewTablePage).toHaveBeenCalledTimes(1);
    expect(mocks.previewTablePage).toHaveBeenCalledWith(
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

    useTabStore
      .getState()
      .retargetTableTabs(
        "postgres-1",
        "public",
        "users",
        "accounts",
        undefined,
        "analytics"
      );

    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === "analytics-tab")
        ?.tableName
    ).toBe("accounts");
    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === "archive-tab")
        ?.tableName
    ).toBe("users");
  });

  it("consumes inserted row drafts when saving succeeds but refreshing fails", async () => {
    mocks.previewTablePage.mockRejectedValueOnce(new Error("database timeout"));
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map([["-1:0", "created@example.test"]]),
          newRowsCount: 1,
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    let tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledTimes(1);
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{ email: "created@example.test" }],
      [],
      []
    );
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
    expect(tab.error).toContain("Changes were saved");
    expect(tab.error).toContain("Click Refresh");
    expect(tab.error).toContain("database timeout");
    expect(tab.error).not.toContain("Save failed");

    await useTabStore.getState().commitEdits("tab-1");

    tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledTimes(1);
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
  });

  it("inserts an untouched new row using database defaults", async () => {
    mocks.mutateTableRows.mockResolvedValueOnce({
      inserted: 1,
      updated: 0,
      deleted: 0,
      rowsAffected: 1,
    });
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map(),
          newRowsCount: 1,
          tableTotalRows: 10,
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{}],
      [],
      []
    );
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
  });

  it("submits edited and untouched new rows together", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map([["-1:0", "created@example.test"]]),
          newRowsCount: 2,
          tableTotalRows: 10,
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledTimes(1);
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{ email: "created@example.test" }, {}],
      [],
      []
    );
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
  });

  it("locks table drafts while a save mutation is in flight", async () => {
    let resolveMutation!: (value: {
      inserted: number;
      updated: number;
      deleted: number;
      rowsAffected: number;
    }) => void;
    mocks.mutateTableRows.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        })
    );
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map([["-1:0", "original@example.test"]]),
          newRowsCount: 1,
        },
      ],
    });

    const savePromise = useTabStore.getState().commitEdits("tab-1");
    expect(useTabStore.getState().tabs[0]?.isExecuting).toBe(true);

    useTabStore
      .getState()
      .setCellEdit("tab-1", -1, 0, "changed-during-save@example.test");
    expect(useTabStore.getState().tabs[0]?.pendingEdits).toEqual(
      new Map([["-1:0", "original@example.test"]])
    );

    resolveMutation({ inserted: 1, updated: 0, deleted: 0, rowsAffected: 1 });
    await savePromise;
    expect(useTabStore.getState().tabs[0]?.isExecuting).toBe(false);
  });

  it("keeps drafts retryable when the save mutation itself fails", async () => {
    mocks.mutateTableRows.mockRejectedValueOnce(new Error("write rejected"));
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map([["-1:0", "created@example.test"]]),
          newRowsCount: 1,
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(tab.pendingEdits).toEqual(
      new Map([["-1:0", "created@example.test"]])
    );
    expect(tab.newRowsCount).toBe(1);
    expect(tab.error).toBe("Save failed: write rejected");
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

  it("consumes deleted rows locally when deleting succeeds but refreshing fails", async () => {
    mocks.previewTablePage.mockRejectedValueOnce(new Error("network unavailable"));
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
              rows: [
                [1, "first@example.test"],
                [2, "second@example.test"],
              ],
            },
          ],
          tableTotalRows: 2,
          pendingEdits: new Map([["0:1", "deleted-row-draft@example.test"]]),
          newRowsCount: 0,
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
    expect(tab.results?.[0]?.rows).toEqual([[2, "second@example.test"]]);
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
    expect(tab.tableTotalRows).toBe(1);
    expect(tab.error).toContain("Rows were deleted");
    expect(tab.error).toContain("Click Refresh");
    expect(tab.error).toContain("network unavailable");
    expect(tab.error).not.toContain("Delete rows failed");
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
      { column: "id", direction: "asc" }
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

  it("keeps drafts and avoids loading when page replacement is declined", async () => {
    vi.mocked(confirm).mockReturnValueOnce(false);

    const loaded = await useTabStore.getState().loadTablePage("tab-1", 1);

    const tab = useTabStore.getState().tabs[0]!;
    expect(loaded).toBe(false);
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(tab.pendingEdits).toEqual(
      new Map([["0:0", "new@example.test"]])
    );
    expect(tab.tablePage).toBeUndefined();
    expect(vi.mocked(confirm).mock.calls[0]?.[0]).toContain("Submit Changes");
  });

  it("does not apply a server sort when discarding drafts is declined", async () => {
    vi.mocked(confirm).mockReturnValueOnce(false);

    const sorted = await useTabStore
      .getState()
      .setGridSort("tab-1", "email", "asc");

    const tab = useTabStore.getState().tabs[0]!;
    expect(sorted).toBe(false);
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(tab.gridState?.sortColumn).toBeUndefined();
    expect(tab.pendingEdits?.size).toBe(1);
  });

  it("protects table drafts when closing and does not restore discarded drafts", () => {
    vi.mocked(confirm).mockReturnValueOnce(false);
    useTabStore.getState().closeTab("tab-1");
    expect(useTabStore.getState().tabs).toHaveLength(1);

    vi.mocked(confirm).mockReturnValueOnce(true);
    useTabStore.getState().closeTab("tab-1");
    expect(useTabStore.getState().tabs).toHaveLength(0);
    expect(useTabStore.getState().closedTabsStack[0]?.pendingEdits?.size).toBe(0);

    useTabStore.getState().reopenTab();
    expect(useTabStore.getState().tabs[0]?.pendingEdits?.size).toBe(0);
  });

  it("preserves table drafts while switching between tabs", () => {
    useTabStore.setState((state) => ({
      tabs: [
        ...state.tabs,
        {
          id: "tab-2",
          title: "Query",
          type: "query",
          sql: "SELECT 1",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    }));

    useTabStore.getState().setActiveTab("tab-2");
    useTabStore.getState().setActiveTab("tab-1");

    expect(useTabStore.getState().tabs[0]?.pendingEdits).toEqual(
      new Map([["0:0", "new@example.test"]])
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps drafts when a table-wide metadata refresh is declined", async () => {
    vi.mocked(confirm).mockReturnValueOnce(false);

    await useTabStore
      .getState()
      .refreshTableTabs("postgres-1", "public", "users");

    expect(mocks.getColumns).not.toHaveBeenCalled();
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(useTabStore.getState().tabs[0]?.pendingEdits?.size).toBe(1);
  });

  it("preserves unrelated new rows after deleting existing rows", async () => {
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
    expect(tab.newRowsCount).toBe(1);
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(tab.error).toContain("Other unsaved table changes were preserved");
  });
});
