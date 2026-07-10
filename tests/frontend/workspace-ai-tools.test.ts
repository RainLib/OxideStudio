import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import {
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools/defaultRegistry";
import {
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
} from "@/ai/tools/policy";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import type { DatabaseDriver } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => []),
  cancelQuery: vi.fn(async () => "cancelled"),
  getDatabaseCapabilities: vi.fn(),
  createDatabase: vi.fn(async () => undefined),
  dropDatabase: vi.fn(async () => undefined),
  getCollections: vi.fn(async () => []),
  getColumns: vi.fn(async () => []),
  getConstraints: vi.fn(async () => []),
  getFunctions: vi.fn(async () => []),
  getIndexes: vi.fn(async () => []),
  getTables: vi.fn(async () => []),
  setCurrentSchema: vi.fn(async () => undefined),
  mutateTableRows: vi.fn(async () => ({
    inserted: 0,
    updated: 0,
    deleted: 0,
    rowsAffected: 0,
  })),
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    loadConnections: vi.fn(async () => []),
    saveConnections: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  },
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
    createDatabase: mocks.createDatabase,
    dropDatabase: mocks.dropDatabase,
  },
  queryService: {
    executeQuery: mocks.executeQuery,
    cancelQuery: mocks.cancelQuery,
  },
  schemaService: {
    getCollections: mocks.getCollections,
    getColumns: mocks.getColumns,
    getConstraints: mocks.getConstraints,
    getFunctions: mocks.getFunctions,
    getIndexes: mocks.getIndexes,
    getTables: mocks.getTables,
    setCurrentSchema: mocks.setCurrentSchema,
  },
  storeService: {
    saveResources: vi.fn(async () => undefined),
    getResources: vi.fn(async () => []),
    replaceResources: vi.fn(async () => undefined),
    upsertResources: vi.fn(async () => undefined),
  },
  tableService: {
    mutateTableRows: mocks.mutateTableRows,
  },
}));

function setWorkspaceConnection(options: {
  id: string;
  driver: DatabaseDriver;
  name?: string;
  namespace: string;
  tab?: {
    id?: string;
    title?: string;
    sql?: string;
    schemaName?: string | null;
    tableName?: string | null;
    objectType?: string | null;
  };
}) {
  const tabId = options.tab?.id ?? "tab-1";
  useConnectionStore.setState({
    connections: [
      {
        id: options.id,
        name: options.name ?? options.driver,
        driver: options.driver,
        url: "mock://local",
      },
    ],
    activeConnectionId: options.id,
    isConnected: true,
    isLoading: false,
    selectedConnection: null,
  });
  useSchemaStore.setState({
    schemas: [options.namespace],
    currentSchema: options.namespace,
    tables: [],
    collections: [],
    functions: [],
  });
  useTabStore.setState({
    activeTabId: tabId,
    tabs: [
      {
        id: tabId,
        title: options.tab?.title ?? "Query",
        type: "query",
        sql: options.tab?.sql ?? "",
        connectionId: options.id,
        schemaName: options.tab?.schemaName ?? options.namespace,
        tableName: options.tab?.tableName ?? null,
        objectType: options.tab?.objectType ?? null,
        results: null,
        isExecuting: false,
        error: null,
        isPinned: false,
      },
    ],
    closedTabsStack: [],
  });
}

function approvedPolicy(toolName: string) {
  return approveAiToolForPolicy(DEFAULT_AI_TOOL_POLICY, toolName);
}

function waitForNextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("workspace AI tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseCapabilities.mockImplementation(
      async (driver: DatabaseDriver) => defaultDatabaseCapabilities(driver)
    );
    mocks.executeQuery.mockResolvedValue([]);
    mocks.cancelQuery.mockResolvedValue("cancelled");
    mocks.getCollections.mockResolvedValue([]);
    mocks.getColumns.mockResolvedValue([]);
    mocks.getConstraints.mockResolvedValue([]);
    mocks.getFunctions.mockResolvedValue([]);
    mocks.getIndexes.mockResolvedValue([]);
    mocks.getTables.mockResolvedValue([]);
    mocks.mutateTableRows.mockResolvedValue({
      inserted: 0,
      updated: 0,
      deleted: 0,
      rowsAffected: 0,
    });
    setWorkspaceConnection({
      id: "elasticsearch-1",
      name: "Elasticsearch",
      driver: "elasticsearch",
      namespace: "default",
      tab: {
        title: "Index: events-2026",
        sql: '{"query":{"match_all":{}}}',
        schemaName: "default",
        tableName: "events-2026",
        objectType: "index",
      },
    });
  });

  it("passes active search index context to read query execution", async () => {
    const registry = createWorkspaceAiToolRegistry();

    await registry.executeWithPolicy(
      "query.runReadOnly",
      {
        connectionId: "elasticsearch-1",
        query: '{"query":{"match_all":{}}}',
      },
      {
        requestId: "workspace-ai-test",
        activeConnectionId: "elasticsearch-1",
        activeDriver: "elasticsearch",
      },
      DEFAULT_AI_TOOL_POLICY
    );

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "elasticsearch-1",
      '{"query":{"match_all":{}}}',
      "events-2026"
    );
  });

  it("lets explicit tool namespace override active workspace context", async () => {
    const registry = createWorkspaceAiToolRegistry();

    await registry.executeWithPolicy(
      "query.runReadOnly",
      {
        connectionId: "elasticsearch-1",
        namespace: "manual-index",
        query: '{"query":{"match_all":{}}}',
      },
      {
        requestId: "workspace-ai-test",
        activeConnectionId: "elasticsearch-1",
        activeDriver: "elasticsearch",
      },
      DEFAULT_AI_TOOL_POLICY
    );

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "elasticsearch-1",
      '{"query":{"match_all":{}}}',
      "manual-index"
    );
  });

  it("passes cancellable query ids and cancels active AI read queries on abort", async () => {
    setWorkspaceConnection({
      id: "postgres-1",
      driver: "postgres",
      namespace: "public",
    });
    let resolveQuery: (value: any[]) => void = () => undefined;
    mocks.executeQuery.mockImplementationOnce(
      () =>
        new Promise<any[]>((resolve) => {
          resolveQuery = resolve;
        })
    );
    const controller = new AbortController();
    const registry = createWorkspaceAiToolRegistry();

    const run = registry.executeWithPolicy(
      "query.runReadOnly",
      {
        connectionId: "postgres-1",
        query: "SELECT pg_sleep(30)",
      },
      {
        requestId: "workspace-ai-abort",
        activeConnectionId: "postgres-1",
        activeDriver: "postgres",
        abortSignal: controller.signal,
      },
      DEFAULT_AI_TOOL_POLICY
    );
    await waitForNextTask();

    const queryId = mocks.executeQuery.mock.calls[0]?.[4];
    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "postgres-1",
      "SELECT pg_sleep(30)",
      "public",
      undefined,
      expect.stringMatching(/^workspace-ai-abort:query.runReadOnly:/)
    );

    controller.abort();

    expect(mocks.cancelQuery).toHaveBeenCalledWith(queryId);
    resolveQuery([]);
    await expect(run).resolves.toEqual([]);
  });

  it("does not start a workspace query when the AI context is already aborted", async () => {
    setWorkspaceConnection({
      id: "postgres-1",
      driver: "postgres",
      namespace: "public",
    });
    const controller = new AbortController();
    controller.abort();
    const registry = createWorkspaceAiToolRegistry();

    await expect(
      registry.executeWithPolicy(
        "query.runReadOnly",
        {
          connectionId: "postgres-1",
          query: "SELECT 1",
        },
        {
          requestId: "workspace-ai-abort",
          activeConnectionId: "postgres-1",
          activeDriver: "postgres",
          abortSignal: controller.signal,
        },
        DEFAULT_AI_TOOL_POLICY
      )
    ).rejects.toThrow("AI tool execution aborted");
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.cancelQuery).not.toHaveBeenCalled();
  });

  it("exposes active namespace and object context to assistant planners", () => {
    const context = createWorkspaceAiToolContext("workspace-ai-test");

    expect(context).toMatchObject({
      requestId: "workspace-ai-test",
      activeConnectionId: "elasticsearch-1",
      activeDriver: "elasticsearch",
      activeNamespace: "default",
      activeTab: {
        id: "tab-1",
        schemaName: "default",
        tableName: "events-2026",
        objectType: "index",
      },
    });
  });

  it("describes relational objects through workspace schema services", async () => {
    setWorkspaceConnection({
      id: "postgres-1",
      driver: "postgres",
      namespace: "public",
      tab: {
        title: "Query",
        sql: "SELECT * FROM users",
        schemaName: "public",
      },
    });
    mocks.getColumns.mockResolvedValueOnce([
      {
        name: "id",
        data_type: "integer",
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
      },
    ]);
    mocks.getIndexes.mockResolvedValueOnce([
      {
        name: "users_pkey",
        columns: ["id"],
        is_unique: true,
        is_primary: true,
      },
    ]);
    mocks.getConstraints.mockResolvedValueOnce([
      {
        name: "users_pkey",
        constraint_type: "PRIMARY KEY",
        columns: ["id"],
        referenced_columns: [],
      },
    ]);
    const registry = createWorkspaceAiToolRegistry();

    const result = await registry.execute<any>(
      "metadata.describeObject",
      { name: "users" },
      createWorkspaceAiToolContext("workspace-ai-test")
    );

    expect(mocks.getColumns).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users"
    );
    expect(mocks.getIndexes).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users"
    );
    expect(mocks.getConstraints).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users"
    );
    expect(result).toMatchObject({
      connectionId: "postgres-1",
      namespace: "public",
      name: "users",
      driver: "postgres",
      kind: "relation",
      previewQuery: 'SELECT * FROM "public"."users" LIMIT 100;',
    });
  });

  it("routes structured table row mutations through table service", async () => {
    setWorkspaceConnection({
      id: "postgres-1",
      driver: "postgres",
      namespace: "public",
      tab: {
        title: "Table: users",
        schemaName: "public",
        tableName: "users",
        objectType: "BASE TABLE",
      },
    });
    mocks.mutateTableRows.mockResolvedValueOnce({
      inserted: 1,
      updated: 0,
      deleted: 0,
      rowsAffected: 1,
    });
    const registry = createWorkspaceAiToolRegistry();

    await registry.executeWithPolicy(
      "table.insertRows",
      {
        table: "users",
        inserts: [{ name: "Ada" }],
      },
      createWorkspaceAiToolContext("workspace-ai-test"),
      approvedPolicy("table.insertRows")
    );

    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{ name: "Ada" }],
      [],
      []
    );
  });

  it("executes structured MongoDB, Redis, and Elasticsearch mutations through query service", async () => {
    const registry = createWorkspaceAiToolRegistry();

    setWorkspaceConnection({
      id: "mongodb-1",
      driver: "mongodb",
      namespace: "app",
    });
    await registry.executeWithPolicy(
      "document.insertDocuments",
      {
        collection: "users",
        documents: [{ name: "Ada" }],
      },
      createWorkspaceAiToolContext("workspace-ai-mongo"),
      approvedPolicy("document.insertDocuments")
    );

    setWorkspaceConnection({
      id: "redis-1",
      driver: "redis",
      namespace: "2",
    });
    await registry.executeWithPolicy(
      "key.setValue",
      {
        key: "session:1",
        value: { active: true },
        ttlSeconds: 30,
      },
      createWorkspaceAiToolContext("workspace-ai-redis"),
      approvedPolicy("key.setValue")
    );

    setWorkspaceConnection({
      id: "elasticsearch-1",
      driver: "elasticsearch",
      namespace: "default",
    });
    await registry.executeWithPolicy(
      "search.updateDocument",
      {
        index: "events",
        id: "1",
        document: { active: true },
        upsert: true,
      },
      createWorkspaceAiToolContext("workspace-ai-search"),
      approvedPolicy("search.updateDocument")
    );

    expect(mocks.executeQuery).toHaveBeenNthCalledWith(
      1,
      "mongodb-1",
      JSON.stringify({
        database: "app",
        collection: "users",
        insertMany: [{ name: "Ada" }],
      })
    );
    expect(mocks.executeQuery).toHaveBeenNthCalledWith(
      2,
      "redis-1",
      'SET session:1 "{\\"active\\":true}" EX 30',
      "2"
    );
    expect(mocks.executeQuery).toHaveBeenNthCalledWith(
      3,
      "elasticsearch-1",
      'POST /events/_update/1\n{"doc":{"active":true},"doc_as_upsert":true}'
    );
  });

  it("plans metadata description for the active object before listing objects", async () => {
    const runtime = createAssistantRuntime({
      registry: createWorkspaceAiToolRegistry(),
      createContext: () => createWorkspaceAiToolContext("workspace-ai-test"),
    });

    const turn = await runtime.prepareTurnAsync({
      message: "describe current index metadata",
    });

    expect(turn.suggestedPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "metadata-active-object",
          toolName: "metadata.describeObject",
          input: {
            name: "events-2026",
            namespace: "default",
          },
        }),
      ])
    );
  });

  it("plans and executes the active tab SQL when no editor text is selected", async () => {
    setWorkspaceConnection({
      id: "postgres-1",
      driver: "postgres",
      namespace: "public",
      tab: {
        title: "Query",
        sql: "SELECT * FROM users",
        schemaName: "public",
      },
    });
    const queryResult = {
      columns: [{ name: "id", dataType: "integer" }],
      rows: [[1]],
      statementType: "SELECT",
    };
    mocks.executeQuery.mockResolvedValueOnce([queryResult]);
    const runtime = createAssistantRuntime({
      registry: createWorkspaceAiToolRegistry(),
      createContext: () => createWorkspaceAiToolContext("workspace-ai-test"),
    });

    const turn = await runtime.prepareTurnAsync({
      message: "run current query",
    });
    const step = turn.suggestedPlan.find(
      (candidate) => candidate.id === "query-execution"
    );

    expect(step).toMatchObject({
      toolName: "query.runReadOnly",
      input: { query: "SELECT * FROM users" },
      requiresApproval: false,
    });

    const results = await runtime.executeToolCalls(
      [
        {
          id: step?.id || "query-execution",
          toolName: step?.toolName || "query.runReadOnly",
          input: step?.input,
        },
      ],
      turn.context
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: "success",
        output: [queryResult],
      }),
    ]);
    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "postgres-1",
      "SELECT * FROM users",
      "public"
    );
  });

  it("plans and executes MongoDB reads from active collection context", async () => {
    setWorkspaceConnection({
      id: "mongodb-1",
      driver: "mongodb",
      namespace: "app",
      tab: {
        title: "Collection: users",
        tableName: "users",
        objectType: "collection",
      },
    });
    const queryResult = {
      columns: [{ name: "name", dataType: "string" }],
      rows: [["Ada"]],
      statementType: "FIND",
    };
    mocks.executeQuery.mockResolvedValueOnce([queryResult]);
    const runtime = createAssistantRuntime({
      registry: createWorkspaceAiToolRegistry(),
      createContext: () => createWorkspaceAiToolContext("workspace-ai-mongo"),
    });

    const turn = await runtime.prepareTurnAsync({
      message: "find current collection limit 5",
    });
    const step = turn.suggestedPlan.find(
      (candidate) => candidate.id === "query-execution"
    );
    const expectedQuery = JSON.stringify({
      collection: "users",
      find: {},
      limit: 5,
    });

    expect(step).toMatchObject({
      toolName: "query.runReadOnly",
      input: {
        namespace: "app",
        query: expectedQuery,
        limit: 5,
      },
      requiresApproval: false,
    });

    const results = await runtime.executeToolCalls(
      [
        {
          id: step?.id || "query-execution",
          toolName: step?.toolName || "query.runReadOnly",
          input: step?.input,
        },
      ],
      turn.context
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: "success",
        output: [queryResult],
      }),
    ]);
    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "mongodb-1",
      expectedQuery,
      "app"
    );
  });

  it("plans and executes Elasticsearch searches from active index context", async () => {
    setWorkspaceConnection({
      id: "elasticsearch-1",
      driver: "elasticsearch",
      namespace: "default",
      tab: {
        title: "Index: events",
        tableName: "events",
        objectType: "index",
      },
    });
    const queryResult = {
      columns: [{ name: "_id", dataType: "keyword" }],
      rows: [["1"]],
      statementType: "SEARCH",
    };
    mocks.executeQuery.mockResolvedValueOnce([queryResult]);
    const runtime = createAssistantRuntime({
      registry: createWorkspaceAiToolRegistry(),
      createContext: () => createWorkspaceAiToolContext("workspace-ai-search"),
    });

    const turn = await runtime.prepareTurnAsync({
      message: "search current index limit 5",
    });
    const step = turn.suggestedPlan.find(
      (candidate) => candidate.id === "query-execution"
    );
    const expectedQuery = JSON.stringify({
      size: 5,
      query: {
        match_all: {},
      },
    });

    expect(step).toMatchObject({
      toolName: "query.runReadOnly",
      input: {
        namespace: "events",
        query: expectedQuery,
        limit: 5,
      },
      requiresApproval: false,
    });

    const results = await runtime.executeToolCalls(
      [
        {
          id: step?.id || "query-execution",
          toolName: step?.toolName || "query.runReadOnly",
          input: step?.input,
        },
      ],
      turn.context
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: "success",
        output: [queryResult],
      }),
    ]);
    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "elasticsearch-1",
      expectedQuery,
      "events"
    );
  });
});
