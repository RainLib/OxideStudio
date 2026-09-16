/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { column, mocksForTests as mocks, useTabStore } from "./harness";

describe("table editing store: row identity and table layout", () => {
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
      [],
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
        "analytics",
      );
    const archiveTab = useTabStore
      .getState()
      .findOrCreateTableTab(
        "postgres-1",
        "public",
        "users",
        "BASE TABLE",
        "archive",
      );
    const reusedAnalyticsTab = useTabStore
      .getState()
      .findOrCreateTableTab(
        "postgres-1",
        "public",
        "users",
        "VIEW",
        "analytics",
      );

    expect(archiveTab).not.toBe(analyticsTab);
    expect(reusedAnalyticsTab).toBe(analyticsTab);
    expect(useTabStore.getState().tabs).toHaveLength(2);
    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === analyticsTab),
    ).toMatchObject({
      title: "users · analytics",
      databaseName: "analytics",
      objectType: "VIEW",
    });
    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === archiveTab),
    ).toMatchObject({ title: "users · archive", databaseName: "archive" });
  });
});
