/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import type { IndexInfo } from "@/services/tauri/types";
import { column, mocksForTests as mocks, useTabStore } from "./harness";

describe("table editing store: metadata refresh and draft protection", () => {
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
      "users",
    );
    expect(mocks.getIndexes).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users",
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
      { column: "id", direction: "asc" },
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
    expect(tab.pendingEdits).toEqual(new Map([["0:0", "new@example.test"]]));
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
    expect(useTabStore.getState().closedTabsStack[0]?.pendingEdits?.size).toBe(
      0,
    );

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
      new Map([["0:0", "new@example.test"]]),
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
      [{ key: { id: 1 } }],
    );
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(1);
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(tab.error).toContain("Other unsaved table changes were preserved");
  });
});
