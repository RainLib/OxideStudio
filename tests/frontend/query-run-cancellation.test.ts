import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => []),
  cancelQuery: vi.fn(async () => "Query cancellation requested"),
  getDatabaseCapabilities: vi.fn(async () => {
    throw new Error("use fallback capabilities");
  }),
  saveHistoryEntries: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri/query-history.service", () => ({
  queryHistoryService: {
    saveEntries: mocks.saveHistoryEntries,
  },
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
  },
  queryService: {
    executeQuery: mocks.executeQuery,
    cancelQuery: mocks.cancelQuery,
  },
  schemaService: {
    loadSchemas: vi.fn(async () => []),
    loadTables: vi.fn(async () => []),
    loadCollections: vi.fn(async () => []),
    loadFunctions: vi.fn(async () => []),
    setCurrentSchema: vi.fn(async () => undefined),
  },
  tableService: {},
}));

vi.mock("@/services/tauri/schema.service", () => ({
  schemaService: {
    loadSchemas: vi.fn(async () => []),
    loadTables: vi.fn(async () => []),
    loadCollections: vi.fn(async () => []),
    loadFunctions: vi.fn(async () => []),
    setCurrentSchema: vi.fn(async () => undefined),
  },
}));

function resetWorkspaceState() {
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

  useSchemaStore.setState({
    currentSchema: "public",
    schemas: ["public"],
    tables: [],
    collections: [],
    functions: [],
    metadataVersion: 0,
  });

  useTabStore.setState({
    activeTabId: "tab-1",
    closedTabsStack: [],
    tabs: [
      {
        id: "tab-1",
        title: "Query #1",
        type: "query",
        sql: "SELECT 1",
        connectionId: "postgres-1",
        results: null,
        isExecuting: false,
        runningQueryId: null,
        error: null,
        isPinned: false,
      },
    ],
  });
}

describe("query run cancellation store", () => {
  beforeEach(() => {
    mocks.executeQuery.mockClear();
    mocks.cancelQuery.mockClear();
    mocks.getDatabaseCapabilities.mockClear();
    mocks.saveHistoryEntries.mockClear();
    useHistoryStore.setState({
      projectId: "sqls",
      history: [],
      isLoading: false,
      error: null,
    });
    resetWorkspaceState();
  });

  it("passes a stable query id to query execution and clears it on success", async () => {
    await useTabStore.getState().runTabQuery("tab-1", "postgres-1");

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "postgres-1",
      "SELECT 1",
      "public",
      undefined,
      expect.stringMatching(/^tab-1:/),
      undefined
    );

    const tab = useTabStore.getState().tabs[0]!;
    expect(tab.isExecuting).toBe(false);
    expect(tab.runningQueryId).toBeNull();
    expect(tab.error).toBeNull();
    expect(useHistoryStore.getState().history[0]).toMatchObject({
      projectId: "sqls",
      connectionId: "postgres-1",
      connectionName: "Postgres",
      driver: "postgres",
      schemaName: "public",
      sql: "SELECT 1",
      status: "success",
      rowCount: 0,
      executionMode: "console",
    });
    expect(mocks.saveHistoryEntries).toHaveBeenCalledWith([
      expect.objectContaining({ status: "success", sql: "SELECT 1" }),
    ]);
  });

  it("records failed statement executions with their error and context", async () => {
    mocks.executeQuery.mockRejectedValueOnce(new Error("syntax error near FROM"));

    await useTabStore
      .getState()
      .runTabQuery("tab-1", "postgres-1", "SELECT FROM");

    expect(useHistoryStore.getState().history[0]).toMatchObject({
      connectionId: "postgres-1",
      schemaName: "public",
      sql: "SELECT FROM",
      status: "error",
      rowCount: null,
      errorMessage: "syntax error near FROM",
      executionMode: "statement",
    });
  });

  it("surfaces cancel invocation errors without clearing the running query id", async () => {
    mocks.cancelQuery.mockRejectedValueOnce(new Error("transport down"));
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          isExecuting: true,
          runningQueryId: "tab-1:running",
        },
      ],
    });

    await useTabStore.getState().cancelTabQuery("tab-1");

    expect(mocks.cancelQuery).toHaveBeenCalledWith("tab-1:running");
    const tab = useTabStore.getState().tabs[0]!;
    expect(tab.isExecuting).toBe(true);
    expect(tab.runningQueryId).toBe("tab-1:running");
    expect(tab.error).toContain("Failed to cancel query: transport down");
  });

  it("passes the selected PostgreSQL database to query execution", async () => {
    useTabStore.getState().setTargetDatabase("tab-1", "analytics");

    await useTabStore.getState().runTabQuery("tab-1", "postgres-1");

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "postgres-1",
      "SELECT 1",
      undefined,
      undefined,
      expect.stringMatching(/^tab-1:/),
      "analytics"
    );
  });

  it("refreshes Redis keys and follows SELECT database changes after writes", async () => {
    const loadSchemas = vi.fn(async () => undefined);
    const loadCollections = vi.fn(async () => undefined);
    const setCurrentSchema = vi.fn(async () => undefined);
    const bumpMetadataVersion = vi.fn();
    mocks.getDatabaseCapabilities.mockResolvedValueOnce(
      defaultDatabaseCapabilities("redis")
    );
    useConnectionStore.setState({
      connections: [
        {
          id: "redis-1",
          name: "Redis",
          driver: "redis",
          url: "redis://localhost:6379/0",
          database: "0",
        },
      ],
      activeConnectionId: "redis-1",
      isConnected: true,
    });
    useSchemaStore.setState({
      currentSchema: "0",
      schemas: ["0"],
      loadSchemas,
      loadCollections,
      setCurrentSchema,
      bumpMetadataVersion,
    });
    useTabStore.setState({
      activeTabId: "redis-tab",
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          id: "redis-tab",
          title: "Redis command",
          sql: "SELECT 2; SET user:1 Ada",
          connectionId: "redis-1",
          schemaName: "0",
        },
      ],
    });

    await useTabStore.getState().runTabQuery("redis-tab", "redis-1");
    for (let index = 0; index < 8; index += 1) await Promise.resolve();

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "redis-1",
      "SELECT 2; SET user:1 Ada",
      "0",
      undefined,
      expect.stringMatching(/^redis-tab:/),
      undefined
    );
    expect(setCurrentSchema).toHaveBeenCalledWith("2");
    expect(loadCollections).toHaveBeenCalledWith("redis-1", "2", true);
    expect(loadSchemas).not.toHaveBeenCalled();
    expect(bumpMetadataVersion).toHaveBeenCalled();
  });
});
