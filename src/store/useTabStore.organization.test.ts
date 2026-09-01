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
    expect(useTabStore.getState().closedTabsStack.map((item) => item.id)).toEqual([
      "active",
      "left",
    ]);
  });
});
