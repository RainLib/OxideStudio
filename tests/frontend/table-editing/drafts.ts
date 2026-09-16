/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { column, useTabStore } from "./harness";

describe("table editing store: draft paste and tab reuse", () => {
  it("atomically expands blank draft rows for a multi-row paste", () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [
            { ...column("email"), is_generated: false, is_hidden: false },
          ],
          newRowsCount: 5,
          newRowPlacements: [null, null, null, null, null],
          pendingEdits: new Map(),
        },
      ],
    });

    const applied = useTabStore.getState().applyNewRowPaste(
      "tab-1",
      -1,
      [-1, -2, -3, -4, -5],
      Array.from({ length: 10 }, (_, index) => [
        { columnIndex: 0, value: `user-${index + 1}@example.test` },
      ]),
    );

    const tab = useTabStore.getState().tabs[0]!;
    expect(applied).toBe(true);
    expect(tab.newRowsCount).toBe(10);
    expect(tab.newRowPlacements).toEqual(
      Array.from({ length: 10 }, () => null),
    );
    expect(tab.pendingEdits).toHaveLength(10);
    expect(tab.pendingEdits?.get("-1:0")).toBe("user-1@example.test");
    expect(tab.pendingEdits?.get("-10:0")).toBe("user-10@example.test");
  });

  it("reuses only the required rows and preserves extra blank drafts", () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [
            { ...column("email"), is_generated: false, is_hidden: false },
          ],
          newRowsCount: 10,
          newRowPlacements: Array.from({ length: 10 }, () => null),
          pendingEdits: new Map(),
        },
      ],
    });

    const applied = useTabStore.getState().applyNewRowPaste(
      "tab-1",
      -1,
      [-1, -2, -3, -4, -5],
      Array.from({ length: 5 }, (_, index) => [
        { columnIndex: 0, value: `user-${index + 1}@example.test` },
      ]),
    );

    const tab = useTabStore.getState().tabs[0]!;
    expect(applied).toBe(true);
    expect(tab.newRowsCount).toBe(10);
    expect(tab.pendingEdits).toHaveLength(5);
    expect(tab.pendingEdits?.has("-6:0")).toBe(false);
  });

  it("refuses stale, nonblank, readonly, and executing paste targets", () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [
            { ...column("email"), is_generated: false, is_hidden: false },
          ],
          newRowsCount: 2,
          newRowPlacements: [null, null],
          pendingEdits: new Map([["-2:0", "occupied@example.test"]]),
        },
      ],
    });
    const rows = [
      [{ columnIndex: 0, value: "a@example.test" }],
      [{ columnIndex: 0, value: "b@example.test" }],
    ];

    expect(
      useTabStore.getState().applyNewRowPaste("tab-1", -1, [-1, -2], rows),
    ).toBe(false);
    expect(
      useTabStore.getState().applyNewRowPaste("tab-1", -3, [-3], rows),
    ).toBe(false);

    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) => ({ ...tab, isExecuting: true })),
    }));
    expect(
      useTabStore.getState().applyNewRowPaste("tab-1", -1, [-1], rows),
    ).toBe(false);
  });

  it("refuses an all-blank expansion even when called outside the grid", () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [
            { ...column("email"), is_generated: false, is_hidden: false },
          ],
          newRowsCount: 1,
          newRowPlacements: [null],
          pendingEdits: new Map(),
        },
      ],
    });

    expect(
      useTabStore
        .getState()
        .applyNewRowPaste(
          "tab-1",
          -1,
          [-1],
          [[{ columnIndex: 0, value: "" }], [{ columnIndex: 0, value: " " }]],
        ),
    ).toBe(false);
    expect(useTabStore.getState().tabs[0]?.newRowsCount).toBe(1);
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
    const protectedTab = useTabStore
      .getState()
      .findOrCreateTableTab(
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
    const reusedTab = useTabStore
      .getState()
      .findOrCreateTableTab(
        "postgres-1",
        "public",
        "audit_log",
        "BASE TABLE",
        undefined,
        { reuseMode: "active-tab" },
      );
    expect(reusedTab).toBe(protectedTab);
    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === reusedTab),
    ).toMatchObject({
      tableName: "audit_log",
      schemaName: "public",
      results: null,
    });
  });

  it("opens native database objects as reusable data tabs", () => {
    useTabStore.setState({ tabs: [], activeTabId: null });

    const firstTab = useTabStore
      .getState()
      .findOrCreateObjectDataTab(
        "mongo-1",
        "app",
        "users",
        "collection",
        '{"database":"app","collection":"users","find":{},"limit":100}',
        "Collection: users",
      );
    const reusedTab = useTabStore
      .getState()
      .findOrCreateObjectDataTab(
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
});
