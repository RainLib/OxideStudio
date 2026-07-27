/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LspConnectionSyncer } from "@/components/lsp";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

const mocks = vi.hoisted(() => ({
  updateConfiguration: vi.fn(async () => undefined),
  getDatabaseCapabilities: vi.fn(),
  getTables: vi.fn(async () => []),
  getDatabaseTables: vi.fn(async () => []),
  getCollections: vi.fn(async () => []),
  getCollectionsPage: vi.fn(async () => ({
    items: [],
    nextCursor: null,
    total: 0,
  })),
  getColumns: vi.fn(async () => []),
  getDatabaseColumns: vi.fn(async () => []),
  getIndexes: vi.fn(async () => []),
  getDatabaseIndexes: vi.fn(async () => []),
  getConstraints: vi.fn(async () => []),
  getDatabaseConstraints: vi.fn(async () => []),
  getFunctions: vi.fn(async () => []),
  getDatabaseFunctions: vi.fn(async () => []),
  getResources: vi.fn(async () => []),
  saveResources: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/useLspClient", () => ({
  useLspClient: () => ({
    isReady: true,
    error: null,
    client: { updateConfiguration: mocks.updateConfiguration },
  }),
}));

vi.mock("@/services/lsp", () => ({
  lspClient: {
    updateConfiguration: mocks.updateConfiguration,
  },
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
  },
  schemaService: {
    getTables: mocks.getTables,
    getDatabaseTables: mocks.getDatabaseTables,
    getCollections: mocks.getCollections,
    getCollectionsPage: mocks.getCollectionsPage,
    getColumns: mocks.getColumns,
    getDatabaseColumns: mocks.getDatabaseColumns,
    getIndexes: mocks.getIndexes,
    getDatabaseIndexes: mocks.getDatabaseIndexes,
    getConstraints: mocks.getConstraints,
    getDatabaseConstraints: mocks.getDatabaseConstraints,
    getFunctions: mocks.getFunctions,
    getDatabaseFunctions: mocks.getDatabaseFunctions,
  },
  storeService: {
    getResources: mocks.getResources,
    saveResources: mocks.saveResources,
  },
}));

async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe("LspConnectionSyncer render integration", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();

    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("postgres")
    );
    mocks.getTables.mockResolvedValue([
      {
        name: "users",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    mocks.getColumns.mockResolvedValue([
      {
        name: "id",
        data_type: "integer",
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
        comment: null,
      },
    ]);
    mocks.getDatabaseTables.mockResolvedValue([
      {
        name: "events",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    mocks.getDatabaseColumns.mockResolvedValue([
      {
        name: "event_id",
        data_type: "bigint",
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
        comment: null,
      },
    ]);
    mocks.getIndexes.mockResolvedValue([]);
    mocks.getConstraints.mockResolvedValue([]);
    mocks.getFunctions.mockResolvedValue([]);
    mocks.getDatabaseIndexes.mockResolvedValue([]);
    mocks.getDatabaseConstraints.mockResolvedValue([]);
    mocks.getDatabaseFunctions.mockResolvedValue([]);
    mocks.getCollections.mockResolvedValue([]);
    mocks.getCollectionsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    });
    mocks.getResources.mockResolvedValue([]);
    mocks.saveResources.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/postgres",
          database: "public",
        },
      ],
      activeConnectionId: "postgres-1",
      isConnected: true,
      isLoading: false,
      selectedConnection: null,
    });
    useSchemaStore.setState({
      schemas: ["public"],
      tables: [],
      collections: [],
      functions: [],
      pinnedTables: [],
      currentSchema: "public",
      defaultSchema: null,
      selectedTable: null,
      lastLoadedConnectionId: null,
      isLoading: false,
      isCollectionsLoading: false,
      isFunctionsLoading: false,
      metadataVersion: 1,
    });
    useTabStore.setState({
      activeTabId: "query-1",
      tabs: [
        {
          id: "query-1",
          title: "Query #1",
          type: "query",
          sql: "SELECT * FROM users",
          connectionId: "postgres-1",
          targetSchema: "public",
          schemaName: "public",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
      closedTabsStack: [],
    });

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    vi.useRealTimers();
  });

  it("sends store-derived schema configuration through the LSP client", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getTables).toHaveBeenCalledWith("postgres-1", "public");
    expect(mocks.getColumns).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users"
    );
    expect(mocks.updateConfiguration).toHaveBeenCalledTimes(1);

    const config = mocks.updateConfiguration.mock.calls[0][0];
    expect(config).toMatchObject({
      defaultDialect: "postgres",
      fileDialects: {
        "oxide://query/query-1.postgres.postgres": "postgres",
      },
      schemas: [
        {
          database: "public",
          tables: [
            {
              name: "users",
              columns: [
                {
                  name: "id",
                  data_type: "integer",
                  primary_key: true,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(
      config.fileSchemas["oxide://query/query-1.postgres.postgres"]
    ).toEqual(config.schemas[0].id);
  });

  it("publishes every table and function before enriching a large catalog", async () => {
    mocks.getTables.mockResolvedValue(
      Array.from({ length: 205 }, (_, index) => ({
        name: `table_${index}`,
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      }))
    );
    mocks.getFunctions.mockResolvedValue(
      Array.from({ length: 230 }, (_, index) => ({
        name: `function_${index}`,
        routine_type: "FUNCTION",
        parameters: [],
        return_type: "integer",
        description: null,
      }))
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.updateConfiguration).toHaveBeenCalled();
    const firstConfig = mocks.updateConfiguration.mock.calls[0][0];
    expect(firstConfig.schemas[0].tables).toHaveLength(205);
    expect(firstConfig.schemas[0].functions).toHaveLength(230);
    expect(firstConfig.schemas[0].tables[204].name).toBe("table_204");
  });

  it("uses database-scoped metadata and schema ids for a PostgreSQL catalog tab", async () => {
    useTabStore.setState({
      activeTabId: "analytics-query",
      tabs: [
        {
          id: "analytics-query",
          title: "Analytics",
          type: "query",
          sql: "SELECT event_id FROM events",
          connectionId: "postgres-1",
          databaseName: "analytics",
          targetSchema: "public",
          schemaName: "public",
          tableName: "events",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getDatabaseTables).toHaveBeenCalledWith(
      "postgres-1",
      "analytics",
      "public"
    );
    expect(mocks.getDatabaseColumns).toHaveBeenCalledWith(
      "postgres-1",
      "analytics",
      "public",
      "events"
    );
    expect(mocks.getTables).not.toHaveBeenCalled();

    const config = mocks.updateConfiguration.mock.calls.at(-1)?.[0];
    expect(config.schemas).toEqual([
      expect.objectContaining({
        catalog: "analytics",
        database: "public",
        tables: [
          expect.objectContaining({
            name: "events",
            columns: [expect.objectContaining({ name: "event_id" })],
          }),
        ],
      }),
    ]);
    expect(
      config.fileSchemas[
        "oxide://query/analytics-query.postgres.postgres"
      ]
    ).toBe(config.schemas[0].id);
    expect(config.schemas[0].id).toBe(
      localStorage.getItem(
        `oxide-lsp-schema-id:v2:${encodeURIComponent(
          JSON.stringify(["postgres-1", "postgres", "analytics", "public"])
        )}`
      )
    );
  });

  it("publishes every collection instead of truncating document catalogs", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("mongodb")
    );
    mocks.getCollections.mockResolvedValue(
      Array.from({ length: 505 }, (_, index) => ({
        name: `collection_${index}`,
        type: "collection",
        documentCount: index,
      }))
    );
    useConnectionStore.setState({
      connections: [
        {
          id: "mongo-1",
          name: "MongoDB",
          driver: "mongodb",
          url: "mongodb://localhost/app",
          database: "app",
        },
      ],
      activeConnectionId: "mongo-1",
    });
    useSchemaStore.setState({
      schemas: ["app"],
      currentSchema: "app",
    });
    useTabStore.setState({
      activeTabId: "query-1",
      tabs: [
        {
          id: "query-1",
          title: "Query #1",
          type: "query",
          sql: "db.collection_504.find({})",
          connectionId: "mongo-1",
          targetSchema: "app",
          schemaName: "app",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.updateConfiguration).toHaveBeenCalled();
    const firstConfig = mocks.updateConfiguration.mock.calls[0][0];
    expect(firstConfig.schemas[0].tables).toHaveLength(505);
    expect(
      firstConfig.schemas[0].tables.some(
        (table: { name: string }) => table.name === "collection_504"
      )
    ).toBe(true);
  });

  it("does not introspect Redis when no query tab targets the connection", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue(
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
    });
    useSchemaStore.setState({ schemas: ["0"], currentSchema: "0" });
    useTabStore.setState({ tabs: [], activeTabId: null });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getCollections).not.toHaveBeenCalled();
    expect(mocks.getCollectionsPage).not.toHaveBeenCalled();
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
  });

  it("syncs a bounded Redis key page into the active LSP session", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("redis")
    );
    mocks.getCollections.mockResolvedValue([
      {
        name: "user:1",
        type: "hash",
        documentCount: 3,
      },
      {
        name: "session:1",
        type: "string",
        documentCount: 1,
      },
    ]);
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
    });
    useSchemaStore.setState({ schemas: ["0"], currentSchema: "0" });
    useTabStore.setState({
      activeTabId: "redis-query",
      tabs: [
        {
          id: "redis-query",
          title: "Redis",
          type: "query",
          sql: "GET key:1",
          connectionId: "redis-1",
          targetSchema: "0",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getCollections).toHaveBeenCalledWith("redis-1", "0");
    expect(mocks.getCollectionsPage).not.toHaveBeenCalled();
    expect(mocks.updateConfiguration).toHaveBeenCalledTimes(1);
    const config = mocks.updateConfiguration.mock.calls[0][0];
    expect(config).toMatchObject({
      defaultDialect: "redis",
      fileDialects: {
        "oxide://query/redis-query.redis.redis": "redis",
      },
      schemas: [
        {
          database: "0",
          tables: [
            {
              name: "user:1",
              object_type: "hash",
              columns: [
                { name: "key", data_type: "string" },
                { name: "type", data_type: "hash" },
                { name: "value", data_type: "json" },
              ],
            },
            {
              name: "session:1",
              object_type: "string",
            },
          ],
        },
      ],
    });
    expect(config.schemas[0].tables[0].source_location[0]).toContain(
      "oxide://database-object/object"
    );
  });
});
