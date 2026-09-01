import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore, type TabData } from "./useTabStore";

function tab(id: string, isPinned = false): TabData {
  return {
    id,
    title: id,
    type: "query",
    createdAt: 1,
    sql: "",
    results: null,
    isExecuting: false,
    error: null,
    isPinned,
  };
}

describe("tab store organization actions", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      closedTabsStack: [],
    });
  });

  it("reorders tabs before and after a visible target", () => {
    useTabStore.setState({ tabs: [tab("a"), tab("b"), tab("c")] });

    expect(useTabStore.getState().reorderTab("c", "a", "before")).toBe(true);
    expect(useTabStore.getState().tabs.map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(useTabStore.getState().reorderTab("c", "b", "after")).toBe(true);
    expect(useTabStore.getState().tabs.map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not move a tab across the pinned boundary", () => {
    useTabStore.setState({ tabs: [tab("pinned", true), tab("regular")] });

    expect(
      useTabStore.getState().reorderTab("regular", "pinned", "before"),
    ).toBe(false);
    expect(useTabStore.getState().tabs.map((item) => item.id)).toEqual([
      "pinned",
      "regular",
    ]);
  });

  it("closes an exact visual subset once and preserves pinned tabs", () => {
    useTabStore.setState({
      tabs: [tab("pinned", true), tab("left"), tab("active"), tab("right")],
      activeTabId: "active",
    });

    useTabStore
      .getState()
      .closeTabsByIds(["pinned", "left", "active"], "right");

    expect(useTabStore.getState().tabs.map((item) => item.id)).toEqual([
      "pinned",
      "right",
    ]);
    expect(useTabStore.getState().activeTabId).toBe("right");
    expect(
      useTabStore.getState().closedTabsStack.map((item) => item.id),
    ).toEqual(["active", "left"]);
  });

  it("releases result payloads instead of retaining them in closed-tab history", () => {
    const result = {
      columns: [{ name: "payload", data_type: "text" }],
      rows: [["large value"]],
      message: "done",
      responseMeta: {
        requestMethod: "POST",
        requestPath: "/_search",
        status: 200,
        durationMs: 1,
        rawResponse: { hits: ["large value"] },
      },
    };
    useTabStore.setState({
      tabs: [{ ...tab("query"), results: [result] }],
      activeTabId: "query",
    });

    useTabStore.getState().closeTab("query");

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.message).toBeUndefined();
    expect(result.responseMeta).toBeUndefined();
    expect(useTabStore.getState().closedTabsStack[0]?.results).toBeNull();

    useTabStore.getState().reopenTab();
    expect(useTabStore.getState().tabs[0]?.results).toBeNull();
  });

  it("isolates local grid filters for each query result and keeps them aligned after closing one", () => {
    const result = (name: string) => ({
      columns: [{ name, data_type: "text" }],
      rows: [[name]],
    });
    useTabStore.setState({
      tabs: [
        {
          ...tab("query"),
          results: [result("first"), result("second"), result("third")],
          activeResultIndex: 0,
        },
      ],
      activeTabId: "query",
    });

    const store = useTabStore.getState();
    store.setGridFilter("query", "first", { operator: "equals", value: "one" });
    store.setActiveResultIndex("query", 1);
    expect(useTabStore.getState().tabs[0]?.gridState).toBeUndefined();

    store.setGridFilter("query", "second", {
      operator: "contains",
      value: "two",
    });
    store.setActiveResultIndex("query", 0);
    expect(useTabStore.getState().tabs[0]?.gridState?.columnFilters).toEqual({
      first: { operator: "equals", value: "one" },
    });

    store.closeResultAt("query", 0);
    const current = useTabStore.getState().tabs[0];
    expect(current?.activeResultIndex).toBe(0);
    expect(current?.gridState?.columnFilters).toEqual({
      second: { operator: "contains", value: "two" },
    });
    expect(current?.resultGridStates?.[0]?.columnFilters).toEqual({
      second: { operator: "contains", value: "two" },
    });
  });
});
