/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import {
  column,
  deferred,
  mocksForTests as mocks,
  useConnectionStore,
  useTabStore,
} from "./harness";

describe("table editing store: table loading and reconnect lifecycle", () => {
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
      "analytics",
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
      undefined,
    );
    expect(mocks.connect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.previewTablePage.mock.invocationCallOrder[0]!,
    );
    expect(useConnectionStore.getState().connectedConnectionIds).toContain(
      "postgres-1",
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
      "analytics",
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
          : tab,
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
      "analytics",
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
      "analytics",
    );

    useTabStore
      .getState()
      .retargetTableTabs(
        "postgres-1",
        "public",
        "users",
        "accounts",
        undefined,
        "analytics",
      );

    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === "analytics-tab")
        ?.tableName,
    ).toBe("accounts");
    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === "archive-tab")
        ?.tableName,
    ).toBe("users");
  });
});
