import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore } from "@/store/useTabStore";

describe("connection database browser tabs", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
  });

  it("reuses one browser per connection", () => {
    const first = useTabStore
      .getState()
      .openDatabaseBrowser("connection-1", "Analytics");
    const second = useTabStore
      .getState()
      .openDatabaseBrowser("connection-1", "Analytics");
    const other = useTabStore
      .getState()
      .openDatabaseBrowser("connection-2", "Archive");

    expect(second).toBe(first);
    expect(other).not.toBe(first);
    expect(useTabStore.getState().tabs).toMatchObject([
      {
        id: first,
        type: "database_browser",
        title: "Analytics databases",
        connectionId: "connection-1",
      },
      {
        id: other,
        type: "database_browser",
        title: "Archive databases",
        connectionId: "connection-2",
      },
    ]);
  });
});
