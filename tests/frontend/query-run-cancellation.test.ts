import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { ApiError } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => []),
  explainQuery: vi.fn(async (request: { queryId: string }) => ({
    id: request.queryId,
    driver: "postgres",
    mode: "estimate",
    format: "json",
    generatedInMs: 2.5,
    totalCost: 1,
    estimatedRows: 1,
    root: { id: "node-0", nodeType: "Result", children: [] },
    rawPlan: {},
    warnings: [],
  })),
  cancelQuery: vi.fn(async () => "Query cancellation requested"),
  getDatabaseCapabilities: vi.fn(async () => {
    throw new Error("use fallback capabilities");
  }),
  connect: vi.fn(async () => undefined),
  saveHistoryEntries: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri/query-history.service", () => ({
  queryHistoryService: {
    saveEntries: mocks.saveHistoryEntries,
  },
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    connect: mocks.connect,
  },
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
  },
  queryService: {
    executeQuery: mocks.executeQuery,
    explainQuery: mocks.explainQuery,
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
    connectedConnectionIds: ["postgres-1"],
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
    mocks.explainQuery.mockClear();
    mocks.cancelQuery.mockClear();
    mocks.getDatabaseCapabilities.mockClear();
    mocks.connect.mockClear();
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
      undefined,
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
    mocks.executeQuery.mockRejectedValueOnce(
      new Error("syntax error near FROM"),
    );

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

  it("keeps trusted PostgreSQL diagnostics and maps the statement position into the editor", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          sql: "SELECT 1;\nSELECT FROM users",
        },
      ],
    });
    mocks.executeQuery.mockRejectedValueOnce(
      new ApiError("syntax error at or near FROM", "QUERY_EXECUTION_FAILED", null, {
        retryable: false,
        category: "query",
        context: {
          databaseError: {
            driver: "postgres",
            sqlState: "42601",
            severity: "ERROR",
            position: 8,
          },
        },
      }),
    );

    await useTabStore
      .getState()
      .runTabQuery(
        "tab-1",
        "postgres-1",
        "SELECT FROM users",
        undefined,
        10,
      );

    expect(useTabStore.getState().tabs[0]).toMatchObject({
      error: "syntax error at or near FROM",
      queryError: {
        code: "QUERY_EXECUTION_FAILED",
        retryable: false,
        database: {
          driver: "postgres",
          sqlState: "42601",
          position: 8,
          executionLine: 1,
          executionColumn: 8,
          documentOffset: 17,
          documentLine: 2,
          documentColumn: 8,
        },
      },
    });
  });

  it("restores a missing backend session and retries the query once", async () => {
    mocks.executeQuery
      .mockRejectedValueOnce(
        new Error("Connection not found: internal-connection-id"),
      )
      .mockResolvedValueOnce([]);

    await useTabStore.getState().runTabQuery("tab-1", "postgres-1");

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.executeQuery).toHaveBeenCalledTimes(2);
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      isExecuting: false,
      runningQueryId: null,
      error: null,
    });
  });

  it("keeps the previous result mounted while a query reruns", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          results: [
            {
              columns: [{ name: "value", data_type: "integer" }],
              rows: [[1]],
            },
          ],
        },
      ],
    });
    mocks.executeQuery.mockImplementationOnce(async () => {
      expect(useTabStore.getState().tabs[0]?.results?.[0]?.rows).toEqual([
        [1],
      ]);
      return [
        {
          columns: [{ name: "value", data_type: "integer" }],
          rows: [[2]],
        },
      ];
    });

    await useTabStore.getState().runTabQuery("tab-1", "postgres-1");

    expect(useTabStore.getState().tabs[0]?.results?.[0]?.rows).toEqual([[2]]);
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
      "analytics",
    );
  });

  it("stores a database-scoped Explain Plan without replacing query results", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          databaseName: "analytics",
          results: [
            {
              columns: [{ name: "value", data_type: "int4" }],
              rows: [[1]],
            },
          ],
        },
      ],
    });

    await useTabStore
      .getState()
      .runExplainPlan("tab-1", "postgres-1", "SELECT * FROM users");

    expect(mocks.explainQuery).toHaveBeenCalledWith({
      connectionId: "postgres-1",
      sql: "SELECT * FROM users",
      schema: undefined,
      database: "analytics",
      queryId: expect.stringMatching(/^tab-1:plan:/),
      mode: "estimate",
    });
    const tab = useTabStore.getState().tabs[0]!;
    expect(tab.isExecuting).toBe(false);
    expect(tab.queryOutputView).toBe("plan");
    expect(tab.explainPlan?.root.nodeType).toBe("Result");
    expect(tab.results?.[0]?.rows).toEqual([[1]]);
  });

  it("refreshes Redis keys and follows SELECT database changes after writes", async () => {
    const loadSchemas = vi.fn(async () => undefined);
    const loadCollections = vi.fn(async () => undefined);
    const setCurrentSchema = vi.fn(async () => undefined);
    const bumpMetadataVersion = vi.fn();
    mocks.getDatabaseCapabilities.mockResolvedValueOnce(
      defaultDatabaseCapabilities("redis"),
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
      connectedConnectionIds: ["redis-1"],
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
      undefined,
    );
    expect(setCurrentSchema).toHaveBeenCalledWith("2");
    expect(loadCollections).toHaveBeenCalledWith("redis-1", "2", true);
    expect(loadSchemas).not.toHaveBeenCalled();
    expect(bumpMetadataVersion).toHaveBeenCalled();
  });
});
