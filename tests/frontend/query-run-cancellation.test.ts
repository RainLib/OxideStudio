import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => []),
  cancelQuery: vi.fn(async () => "Query cancellation requested"),
  getDatabaseCapabilities: vi.fn(async () => {
    throw new Error("use fallback capabilities");
  }),
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
    resetWorkspaceState();
  });

  it("passes a stable query id to query execution and clears it on success", async () => {
    await useTabStore.getState().runTabQuery("tab-1", "postgres-1");

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "postgres-1",
      "SELECT 1",
      "public",
      undefined,
      expect.stringMatching(/^tab-1:/)
    );

    const tab = useTabStore.getState().tabs[0]!;
    expect(tab.isExecuting).toBe(false);
    expect(tab.runningQueryId).toBeNull();
    expect(tab.error).toBeNull();
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
});
