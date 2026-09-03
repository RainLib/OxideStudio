import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import {
  getConnectionMetadataNodeKey,
  getSchemaMetadataNodeKey,
  getSchemaObjectMetadataSnapshotKey,
  useSchemaStore,
} from "@/store/useSchemaStore";

const mocks = vi.hoisted(() => ({
  getResources: vi.fn(async () => []),
  refreshSchemas: vi.fn(async () => []),
  refreshTables: vi.fn(async () => []),
  getTables: vi.fn(async () => []),
  replaceResources: vi.fn(async () => undefined),
  saveResources: vi.fn(async () => undefined),
  deleteResources: vi.fn(async () => undefined),
  setCurrentSchema: vi.fn(async () => "ok"),
  getCollections: vi.fn(async () => []),
  getFunctions: vi.fn(async () => []),
  getCollectionsPage: vi.fn(async () => ({
    items: [],
    nextCursor: null,
    total: 0,
  })),
}));

function createStorageMock() {
  const storage = new Map<string, string>();

  return {
    clear: vi.fn(() => storage.clear()),
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

vi.mock("@/services/tauri", () => ({
  connectionService: {
    loadConnections: vi.fn(async () => []),
    saveConnections: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => undefined),
  },
  schemaService: {
    getCollections: mocks.getCollections,
    getCollectionsPage: mocks.getCollectionsPage,
    getFunctions: mocks.getFunctions,
    refreshSchemas: mocks.refreshSchemas,
    refreshTables: mocks.refreshTables,
    getTables: mocks.getTables,
    setCurrentSchema: mocks.setCurrentSchema,
  },
  storeService: {
    saveResources: mocks.saveResources,
    getResources: mocks.getResources,
    replaceResources: mocks.replaceResources,
    deleteResources: mocks.deleteResources,
  },
}));

describe("schema store", () => {
  let localStorageMock: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock = createStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);
    mocks.getResources.mockResolvedValue([]);
    mocks.refreshSchemas.mockResolvedValue([]);
    mocks.refreshTables.mockResolvedValue([]);
    mocks.getTables.mockResolvedValue([]);
    mocks.replaceResources.mockResolvedValue(undefined);
    mocks.saveResources.mockResolvedValue(undefined);
    mocks.deleteResources.mockResolvedValue(undefined);
    mocks.setCurrentSchema.mockResolvedValue("ok");
    mocks.getCollections.mockResolvedValue([]);
    mocks.getFunctions.mockResolvedValue([]);
    mocks.getCollectionsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    });
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "Main",
          driver: "postgres",
          url: "postgres://localhost/app",
          database: "public",
        },
      ],
      activeConnectionId: "conn-1",
      connectedConnectionIds: ["conn-1"],
      isConnected: true,
      isLoading: false,
      selectedConnection: null,
    });
    useSchemaStore.setState({
      schemas: ["public", "audit"],
      tables: [
        {
          name: "users",
          schema: "public",
          type: "BASE TABLE",
          comment: null,
        },
      ],
      collections: [
        {
          name: "events",
          namespace: "public",
          type: "collection",
          documentCount: 1,
        },
      ],
      collectionNextCursor: null,
      collectionTotal: null,
      functions: [
        {
          name: "calculate_score",
          schema: "public",
          type: "FUNCTION",
          returnType: "integer",
          parameters: [],
        },
      ],
      pinnedTables: [],
      currentSchema: "public",
      defaultSchema: null,
      selectedTable: "users",
      lastLoadedConnectionId: null,
      lastLoadedObjectKey: null,
      isLoading: false,
      isCollectionsLoading: true,
      isFunctionsLoading: true,
      metadataVersion: 0,
      connectionSnapshots: {},
      objectSnapshots: {},
      metadataNodeStates: {},
    });
  });

  it("revalidates an empty cached MongoDB collection snapshot", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "mongo-1",
          name: "MongoDB",
          driver: "mongodb",
          url: "mongodb://localhost:27017/app",
          database: "app",
        },
      ],
      activeConnectionId: "mongo-1",
      connectedConnectionIds: ["mongo-1"],
      isConnected: true,
    });
    useSchemaStore.setState({
      currentSchema: "app",
      collections: [],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
      lastLoadedObjectKey: "sqls:mongo-1:mongodb:app:collections",
    });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "mongo-1:mongodb:app:COLLECTION_CACHE",
        connection_id: "mongo-1",
        parent_id: "mongo-1:mongodb:app",
        kind: "COLLECTION_CACHE",
        name: "COLLECTION_CACHE",
        metadata: { driver: "mongodb" },
        last_updated: Date.now(),
      },
    ]);
    mocks.getCollections.mockResolvedValueOnce([
      {
        name: "messages",
        namespace: "app",
        type: "collection",
        documentCount: 12,
      },
    ]);

    await useSchemaStore
      .getState()
      .loadCollections("mongo-1", "app", false, "", true);

    expect(mocks.getCollections).toHaveBeenCalledWith("mongo-1", "app");
    expect(useSchemaStore.getState()).toMatchObject({
      collections: [expect.objectContaining({ name: "messages" })],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
  });

  it("loads a collapsed schema for search without replacing the active schema", async () => {
    mocks.getTables.mockResolvedValueOnce([
      {
        name: "audit_log",
        schema: "audit",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    mocks.getFunctions.mockResolvedValueOnce([
      {
        name: "audit_entry",
        schema: "audit",
        type: "FUNCTION",
        returnType: "void",
        parameters: [],
      },
    ]);

    const loaded = await useSchemaStore
      .getState()
      .loadSchemaObjectsForSearch("conn-1", "audit");

    expect(loaded).toBe(true);
    expect(useSchemaStore.getState().currentSchema).toBe("public");
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual([
      "users",
    ]);
    const snapshot =
      useSchemaStore.getState().objectSnapshots[
        getSchemaObjectMetadataSnapshotKey("conn-1", "postgres", "audit")
      ];
    expect(snapshot?.tables.map((table) => table.name)).toEqual(["audit_log"]);
    expect(snapshot?.functions.map((routine) => routine.name)).toEqual([
      "audit_entry",
    ]);
  });

  it("keeps usable collapsed search metadata when an optional catalog fails", async () => {
    mocks.getTables.mockResolvedValueOnce([
      {
        name: "audit_log",
        schema: "audit",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    mocks.getFunctions.mockRejectedValueOnce(new Error("not supported"));

    expect(
      await useSchemaStore
        .getState()
        .loadSchemaObjectsForSearch("conn-1", "audit"),
    ).toBe(true);
    const snapshot =
      useSchemaStore.getState().objectSnapshots[
        getSchemaObjectMetadataSnapshotKey("conn-1", "postgres", "audit")
      ];
    expect(snapshot?.tables.map((table) => table.name)).toEqual(["audit_log"]);
    expect(snapshot?.functions).toEqual([]);
  });

  it("keeps cached MongoDB collections when background revalidation fails", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "mongo-1",
          name: "MongoDB",
          driver: "mongodb",
          url: "mongodb://localhost:27017/app",
          database: "app",
        },
      ],
      activeConnectionId: "mongo-1",
      connectedConnectionIds: ["mongo-1"],
      isConnected: true,
    });
    useSchemaStore.setState({
      currentSchema: "app",
      collections: [],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
      lastLoadedObjectKey: null,
    });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "mongo-1:mongodb:app:events",
        connection_id: "mongo-1",
        parent_id: "mongo-1:mongodb:app",
        kind: "COLLECTION",
        name: "events",
        metadata: {
          driver: "mongodb",
          namespace: "app",
          type: "collection",
        },
        last_updated: Date.now(),
      },
      {
        id: "mongo-1:mongodb:app:COLLECTION_CACHE",
        connection_id: "mongo-1",
        parent_id: "mongo-1:mongodb:app",
        kind: "COLLECTION_CACHE",
        name: "COLLECTION_CACHE",
        metadata: { driver: "mongodb" },
        last_updated: Date.now(),
      },
    ]);
    mocks.getCollections.mockRejectedValueOnce(new Error("offline"));

    await useSchemaStore
      .getState()
      .loadCollections("mongo-1", "app", false, "", true);

    expect(useSchemaStore.getState()).toMatchObject({
      collections: [expect.objectContaining({ name: "events" })],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
  });

  it("revalidates cached Elasticsearch indices in the background", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "elastic-1",
          name: "Elasticsearch",
          driver: "elasticsearch",
          url: "http://localhost:9200",
          database: "default",
        },
      ],
      activeConnectionId: "elastic-1",
      connectedConnectionIds: ["elastic-1"],
      isConnected: true,
    });
    useSchemaStore.setState({
      currentSchema: "default",
      collections: [],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
      lastLoadedObjectKey: "sqls:elastic-1:elasticsearch:default:collections",
    });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "elastic-1:elasticsearch:default:COLLECTION_CACHE",
        connection_id: "elastic-1",
        parent_id: "elastic-1:elasticsearch:default",
        kind: "COLLECTION_CACHE",
        name: "COLLECTION_CACHE",
        metadata: { driver: "elasticsearch" },
        last_updated: Date.now(),
      },
    ]);
    mocks.getCollections.mockResolvedValueOnce([
      {
        name: "events-2026",
        namespace: "default",
        type: "index",
        documentCount: 42,
      },
    ]);

    await useSchemaStore
      .getState()
      .loadCollections("elastic-1", "default", false, "", true);

    expect(useSchemaStore.getState().collections).toEqual([
      expect.objectContaining({ name: "events-2026", type: "index" }),
    ]);
    expect(mocks.replaceResources).toHaveBeenCalledWith(
      "elastic-1",
      "elastic-1:elasticsearch:default",
      "COLLECTION",
      expect.any(Array),
      "sqls",
    );
  });

  it("loads Redis keys in bounded cursor pages", async () => {
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
    useSchemaStore.setState({
      currentSchema: "0",
      collections: [],
      lastLoadedObjectKey: null,
      collectionNextCursor: null,
      collectionTotal: null,
      isCollectionsLoading: false,
    });
    mocks.getCollectionsPage
      .mockResolvedValueOnce({
        items: [{ name: "key:1", namespace: "0", type: "string" }],
        nextCursor: "42",
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ name: "key:2", namespace: "0", type: "hash" }],
        nextCursor: null,
        total: 2,
      });

    await useSchemaStore.getState().loadCollections("redis-1", "0", true);
    expect(useSchemaStore.getState()).toMatchObject({
      collectionNextCursor: "42",
      collectionTotal: 2,
    });
    expect(mocks.saveResources).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          connection_id: "redis-1",
          kind: "REDIS_KEY_COUNT_CACHE",
          name: "0",
          metadata: expect.objectContaining({ total: 2, loadedCount: 1 }),
        }),
      ],
      "sqls",
    );
    await useSchemaStore.getState().loadMoreCollections("redis-1", "0");

    expect(
      useSchemaStore.getState().collections.map((item) => item.name),
    ).toEqual(["key:1", "key:2"]);
    expect(useSchemaStore.getState().collectionNextCursor).toBeNull();
    expect(mocks.getCollectionsPage).toHaveBeenNthCalledWith(
      2,
      "redis-1",
      "0",
      "42",
      100,
      null,
    );
  });

  it("coalesces concurrent Redis first-page loads", async () => {
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
    useSchemaStore.setState({
      currentSchema: "0",
      collections: [],
      lastLoadedObjectKey: null,
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
    let resolvePage:
      | ((page: {
          items: Array<{ name: string; namespace: string; type: string }>;
          nextCursor: null;
          total: number;
        }) => void)
      | undefined;
    mocks.getCollectionsPage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
    );

    const first = useSchemaStore
      .getState()
      .loadCollections("redis-1", "0", true);
    const second = useSchemaStore
      .getState()
      .loadCollections("redis-1", "0", true);

    expect(mocks.getCollectionsPage).toHaveBeenCalledTimes(1);
    resolvePage?.({
      items: [{ name: "key:1", namespace: "0", type: "string" }],
      nextCursor: null,
      total: 1,
    });
    await Promise.all([first, second]);

    expect(useSchemaStore.getState().collections).toHaveLength(1);
    expect(useSchemaStore.getState().collectionLoadingKey).toBeNull();
  });

  it("passes Redis key filters through cursor pagination", async () => {
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
    useSchemaStore.setState({
      currentSchema: "0",
      lastLoadedObjectKey: null,
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
    mocks.getCollectionsPage
      .mockResolvedValueOnce({
        items: [{ name: "user:42", namespace: "0", type: "hash" }],
        nextCursor: "filtered-next",
        total: null,
      })
      .mockResolvedValueOnce({
        items: [{ name: "user:43", namespace: "0", type: "string" }],
        nextCursor: null,
        total: null,
      });

    await useSchemaStore
      .getState()
      .loadCollections("redis-1", "0", true, " user:42 ");

    expect(mocks.getCollectionsPage).toHaveBeenCalledWith(
      "redis-1",
      "0",
      null,
      100,
      "user:42",
    );
    expect(useSchemaStore.getState()).toMatchObject({
      collectionFilter: "user:42",
      collectionNextCursor: "filtered-next",
      collectionTotal: null,
    });

    await useSchemaStore.getState().loadMoreCollections("redis-1", "0");

    expect(mocks.getCollectionsPage).toHaveBeenNthCalledWith(
      2,
      "redis-1",
      "0",
      "filtered-next",
      100,
      "user:42",
    );
    expect(
      useSchemaStore.getState().collections.map((item) => item.name),
    ).toEqual(["user:42", "user:43"]);
  });

  it("ignores stale Redis key pages after the filter changes", async () => {
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
    useSchemaStore.setState({
      currentSchema: "0",
      collections: [],
      lastLoadedObjectKey: null,
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
    let resolveStalePage:
      | ((page: {
          items: Array<{ name: string; namespace: string; type: string }>;
          nextCursor: null;
          total: null;
        }) => void)
      | undefined;
    mocks.getCollectionsPage
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStalePage = resolve;
        }),
      )
      .mockResolvedValueOnce({
        items: [{ name: "new:1", namespace: "0", type: "string" }],
        nextCursor: null,
        total: null,
      });

    const staleLoad = useSchemaStore
      .getState()
      .loadCollections("redis-1", "0", true, "old:");
    await useSchemaStore
      .getState()
      .loadCollections("redis-1", "0", true, "new:");
    resolveStalePage?.({
      items: [{ name: "old:1", namespace: "0", type: "string" }],
      nextCursor: null,
      total: null,
    });
    await staleLoad;

    expect(useSchemaStore.getState()).toMatchObject({
      collectionFilter: "new:",
      isCollectionsLoading: false,
      collectionLoadingKey: null,
    });
    expect(
      useSchemaStore.getState().collections.map((item) => item.name),
    ).toEqual(["new:1"]);
  });

  it("caps retained Redis keys after loading more pages", async () => {
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
    useSchemaStore.setState({
      currentSchema: "0",
      collections: Array.from({ length: 500 }, (_, index) => ({
        name: `old:${index}`,
        namespace: "0",
        type: "string",
      })),
      collectionNextCursor: "next",
      collectionFilter: "",
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
    mocks.getCollectionsPage.mockResolvedValueOnce({
      items: Array.from({ length: 100 }, (_, index) => ({
        name: `new:${index}`,
        namespace: "0",
        type: "string",
      })),
      nextCursor: "more",
      total: 100_000,
    });

    await useSchemaStore.getState().loadMoreCollections("redis-1", "0");

    expect(useSchemaStore.getState().collections).toHaveLength(500);
    expect(useSchemaStore.getState().collections.at(-1)?.name).toBe("new:99");
  });

  it("bounds restored and persisted Redis key snapshots", async () => {
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
    const legacyKeys = Array.from({ length: 10_000 }, (_, index) => ({
      name: `key:${index}`,
      namespace: "0",
      type: "string",
    }));
    useSchemaStore.setState({
      connectionSnapshots: {
        "sqls:redis-1:redis": {
          schemas: ["0"],
          tables: [],
          collections: legacyKeys,
          functions: [],
          pinnedTables: [],
          currentSchema: "0",
          defaultSchema: null,
          selectedTable: null,
          lastLoadedConnectionId: "sqls:redis-1:redis",
          lastLoadedObjectKey: "sqls:redis-1:redis:0:collections",
          metadataVersion: 1,
        },
      },
    });

    expect(useSchemaStore.getState().restoreConnectionSnapshot("redis-1")).toBe(
      true,
    );
    expect(useSchemaStore.getState().collections).toHaveLength(500);
    expect(useSchemaStore.getState().collections[0]?.name).toBe("key:9500");
    expect(useSchemaStore.getState().lastLoadedObjectKey).toBe(
      "sqls:redis-1:redis:0:collections",
    );

    useSchemaStore.setState({ collections: legacyKeys });
    useSchemaStore.getState().snapshotActiveMetadata();
    expect(
      useSchemaStore.getState().connectionSnapshots["sqls:redis-1:redis"]
        ?.collections,
    ).toHaveLength(500);

    mocks.getResources.mockResolvedValueOnce([
      {
        id: "redis-1:redis:0",
        connection_id: "redis-1",
        parent_id: null,
        kind: "DATABASE",
        name: "0",
        metadata: { driver: "redis" },
        last_updated: Date.now(),
      },
    ]);
    useSchemaStore.setState({
      collections: legacyKeys,
      lastLoadedConnectionId: null,
      isLoading: false,
    });
    await useSchemaStore.getState().loadSchemas("redis-1");
    expect(
      useSchemaStore.getState().connectionSnapshots["sqls:redis-1:redis"]
        ?.collections,
    ).toHaveLength(500);
  });

  it("hydrates the previous Redis key total from SQLite metadata", async () => {
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
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "redis-1:redis:0",
        connection_id: "redis-1",
        kind: "DATABASE",
        name: "0",
        metadata: { driver: "redis" },
        last_updated: Date.now(),
      },
      {
        id: "redis-1:redis:0:REDIS_KEY_COUNT_CACHE",
        connection_id: "redis-1",
        kind: "REDIS_KEY_COUNT_CACHE",
        name: "0",
        metadata: { driver: "redis", total: 12_345, loadedCount: 100 },
        last_updated: Date.now(),
      },
    ]);

    await expect(
      useSchemaStore.getState().hydrateConnectionMetadataFromCache("redis-1"),
    ).resolves.toBe(true);

    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "0",
      collectionTotal: 12_345,
      collections: [],
    });
  });

  it("never reads legacy Redis key resources from the metadata cache", async () => {
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
    const legacyKeys = Array.from({ length: 10_000 }, (_, index) => ({
      name: `legacy:${index}`,
      namespace: "0",
      type: "string",
    }));
    useSchemaStore.setState({
      currentSchema: "0",
      collections: legacyKeys,
      objectSnapshots: {
        "sqls:redis-1:redis:0": {
          tables: [],
          collections: legacyKeys,
          functions: [],
          pinnedTables: [],
          selectedTable: null,
          lastLoadedObjectKey: "sqls:redis-1:redis:0:collections",
        },
      },
    });
    mocks.getResources.mockClear();

    await expect(
      useSchemaStore.getState().hydrateSchemaObjectsFromCache("redis-1", "0"),
    ).resolves.toBe(false);

    expect(mocks.getResources).not.toHaveBeenCalled();
    expect(useSchemaStore.getState().collections).toEqual([]);
    expect(
      useSchemaStore.getState().objectSnapshots["sqls:redis-1:redis:0"],
    ).toBeUndefined();
  });

  it("clears stale object state after activating a backend schema", async () => {
    await useSchemaStore.getState().setCurrentSchema("audit");

    expect(mocks.setCurrentSchema).toHaveBeenCalledWith("conn-1", "audit");
    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "audit",
      selectedTable: null,
      tables: [],
      collections: [],
      functions: [],
      isCollectionsLoading: false,
      isFunctionsLoading: false,
    });
  });

  it("selects a namespace before cached children finish hydrating", async () => {
    const cacheRead = createDeferred<never[]>();
    mocks.getResources.mockReturnValueOnce(cacheRead.promise);

    const switching = useSchemaStore.getState().setCurrentSchema("audit");

    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "audit",
      selectedTable: null,
      tables: [],
    });
    expect(mocks.setCurrentSchema).not.toHaveBeenCalled();

    cacheRead.resolve([]);
    await switching;
    expect(mocks.setCurrentSchema).toHaveBeenCalledWith("conn-1", "audit");
  });

  it("ignores a stale namespace cache read after a newer selection", async () => {
    const auditCacheRead = createDeferred<never[]>();
    mocks.getResources
      .mockReturnValueOnce(auditCacheRead.promise)
      .mockResolvedValueOnce([]);

    const selectAudit = useSchemaStore.getState().setCurrentSchema("audit");
    const selectPublic = useSchemaStore.getState().setCurrentSchema("public");
    await selectPublic;
    auditCacheRead.resolve([]);
    await selectAudit;

    expect(useSchemaStore.getState().currentSchema).toBe("public");
    expect(mocks.setCurrentSchema).toHaveBeenCalledTimes(1);
    expect(mocks.setCurrentSchema).toHaveBeenCalledWith("conn-1", "public");
  });

  it("rolls back schema state when backend activation fails", async () => {
    mocks.setCurrentSchema.mockRejectedValueOnce(new Error("schema missing"));

    await expect(
      useSchemaStore.getState().setCurrentSchema("missing"),
    ).rejects.toThrow("schema missing");

    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "public",
      selectedTable: "users",
      isCollectionsLoading: true,
      isFunctionsLoading: true,
    });
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual(
      ["users"],
    );
    expect(
      useSchemaStore
        .getState()
        .collections.map((collection) => collection.name),
    ).toEqual(["events"]);
    expect(
      useSchemaStore.getState().functions.map((func) => func.name),
    ).toEqual(["calculate_score"]);
  });

  it("updates local schema state without backend activation when disconnected", async () => {
    useConnectionStore.setState({
      activeConnectionId: null,
      isConnected: false,
    });

    await useSchemaStore.getState().setCurrentSchema("audit");

    expect(mocks.setCurrentSchema).not.toHaveBeenCalled();
    expect(useSchemaStore.getState().currentSchema).toBe("audit");
  });

  it("activates backend schema before persisting a default schema", async () => {
    await useSchemaStore.getState().setDefaultSchema("audit");

    expect(mocks.setCurrentSchema).toHaveBeenCalledWith("conn-1", "audit");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "oxide-studio-default-schema:sqls:conn-1:postgres",
      "audit",
    );
    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "audit",
      defaultSchema: "audit",
      selectedTable: null,
      tables: [],
      collections: [],
      functions: [],
    });
  });

  it("does not persist a default schema when backend activation fails", async () => {
    mocks.setCurrentSchema.mockRejectedValueOnce(new Error("schema missing"));

    await expect(
      useSchemaStore.getState().setDefaultSchema("missing"),
    ).rejects.toThrow("schema missing");

    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "public",
      defaultSchema: null,
      selectedTable: "users",
    });
  });

  it("uses an empty table cache marker without refreshing tables", async () => {
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:public:TABLE_CACHE",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:public",
        kind: "TABLE_CACHE",
        name: "TABLE_CACHE",
        metadata: { driver: "postgres", cached: true },
        last_updated: Date.now(),
      },
    ]);

    await useSchemaStore.getState().loadTables("conn-1", "public");

    expect(mocks.refreshTables).not.toHaveBeenCalled();
    expect(useSchemaStore.getState()).toMatchObject({
      tables: [],
      isLoading: false,
      lastLoadedObjectKey: "sqls:conn-1:postgres:public:tables",
    });
  });

  it("hydrates connection schemas from MetaStore without refreshing remotely", async () => {
    useConnectionStore.setState({
      activeConnectionId: "conn-1",
      connectedConnectionIds: [],
      isConnected: false,
    });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:audit",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE",
        name: "audit",
        metadata: { driver: "postgres" },
        last_updated: Date.now(),
      },
      {
        id: "conn-1:postgres:root:DATABASE_CACHE",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE_CACHE",
        name: "DATABASE_CACHE",
        metadata: { driver: "postgres", cached: true },
        last_updated: Date.now(),
      },
    ]);

    const hydrated = await useSchemaStore
      .getState()
      .hydrateConnectionMetadataFromCache("conn-1");

    expect(hydrated).toBe(true);
    expect(mocks.refreshSchemas).not.toHaveBeenCalled();
    expect(useSchemaStore.getState()).toMatchObject({
      schemas: ["audit"],
      currentSchema: "audit",
      isLoading: false,
    });
    expect(
      useSchemaStore.getState().connectionSnapshots["sqls:conn-1:postgres"],
    ).toMatchObject({
      schemas: ["audit"],
      currentSchema: "audit",
      lastLoadedConnectionId: "sqls:conn-1:postgres",
    });
    expect(
      useSchemaStore.getState().metadataNodeStates[
        getConnectionMetadataNodeKey("conn-1", "postgres")
      ],
    ).toMatchObject({
      status: "ready",
      source: "cache",
    });
  });

  it("restores cached schemas into the active view while connected", async () => {
    useSchemaStore.getState().clearActiveMetadata();
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:audit",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE",
        name: "audit",
        metadata: { driver: "postgres" },
        last_updated: Date.now(),
      },
      {
        id: "conn-1:postgres:root:DATABASE_CACHE",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE_CACHE",
        name: "DATABASE_CACHE",
        metadata: { driver: "postgres", cached: true },
        last_updated: Date.now(),
      },
    ]);

    const hydrated = await useSchemaStore
      .getState()
      .hydrateConnectionMetadataFromCache("conn-1");

    expect(hydrated).toBe(true);
    expect(useConnectionStore.getState().connectedConnectionIds).toContain(
      "conn-1",
    );
    expect(useSchemaStore.getState()).toMatchObject({
      schemas: ["audit"],
      currentSchema: "audit",
      isLoading: false,
    });
  });

  it("shows cached schemas before backend schema activation completes", async () => {
    useSchemaStore.setState({
      schemas: [],
      currentSchema: null,
      lastLoadedConnectionId: null,
      isLoading: false,
    });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:audit",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE",
        name: "audit",
        metadata: { driver: "postgres" },
        last_updated: Date.now(),
      },
      {
        id: "conn-1:postgres:root:DATABASE_CACHE",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE_CACHE",
        name: "DATABASE_CACHE",
        metadata: { driver: "postgres", cached: true },
        last_updated: Date.now(),
      },
    ]);
    const activation = createDeferred<string>();
    mocks.setCurrentSchema.mockReturnValueOnce(activation.promise);
    mocks.refreshSchemas.mockResolvedValueOnce(["audit"]);

    const loading = useSchemaStore.getState().loadSchemas("conn-1", true);
    await vi.waitFor(() =>
      expect(mocks.setCurrentSchema).toHaveBeenCalledWith("conn-1", "audit"),
    );

    expect(mocks.getResources).toHaveBeenCalledWith(
      "conn-1",
      undefined,
      "sqls",
    );
    expect(mocks.refreshSchemas).not.toHaveBeenCalled();
    expect(useSchemaStore.getState()).toMatchObject({
      schemas: ["audit"],
      currentSchema: "audit",
      isLoading: false,
    });

    activation.resolve("ok");
    await loading;
  });

  it("marks cached schemas stale when a manual remote refresh fails", async () => {
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:public",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE",
        name: "public",
        metadata: { driver: "postgres" },
        last_updated: Date.now(),
      },
      {
        id: "conn-1:postgres:root:DATABASE_CACHE",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE_CACHE",
        name: "DATABASE_CACHE",
        metadata: { driver: "postgres", cached: true },
        last_updated: Date.now(),
      },
    ]);
    mocks.refreshSchemas.mockRejectedValueOnce(new Error("network down"));

    await useSchemaStore.getState().loadSchemas("conn-1", true);

    expect(useSchemaStore.getState().schemas).toEqual(["public"]);
    expect(useSchemaStore.getState().isLoading).toBe(false);
    expect(
      useSchemaStore.getState().metadataNodeStates[
        getConnectionMetadataNodeKey("conn-1", "postgres")
      ],
    ).toMatchObject({
      status: "stale",
      source: "cache",
      message: expect.stringContaining("network down"),
    });
  });

  it("replaces a stale single namespace with the complete PostgreSQL refresh", async () => {
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:default",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE",
        name: "default",
        metadata: { driver: "postgres" },
        last_updated: Date.now(),
      },
    ]);
    mocks.refreshSchemas.mockResolvedValueOnce([
      "public",
      "audit",
      "reporting",
    ]);

    await useSchemaStore.getState().loadSchemas("conn-1", true);

    expect(mocks.refreshSchemas).toHaveBeenCalledWith("conn-1");
    expect(useSchemaStore.getState().schemas).toEqual([
      "public",
      "audit",
      "reporting",
    ]);
    expect(useSchemaStore.getState().currentSchema).toBe("public");
    expect(mocks.getResources).toHaveBeenCalledWith(
      "conn-1",
      undefined,
      "sqls",
    );
    expect(mocks.replaceResources).toHaveBeenCalledWith(
      "conn-1",
      undefined,
      "DATABASE",
      expect.any(Array),
      "sqls",
    );
    expect(mocks.saveResources).toHaveBeenCalledWith(expect.any(Array), "sqls");
  });

  it("coalesces concurrent schema refreshes for one project connection", async () => {
    mocks.getResources.mockResolvedValueOnce([]);
    const refresh = createDeferred<string[]>();
    mocks.refreshSchemas.mockReturnValueOnce(refresh.promise);

    const first = useSchemaStore.getState().loadSchemas("conn-1", true);
    await vi.waitFor(() => expect(mocks.refreshSchemas).toHaveBeenCalledOnce());
    const second = useSchemaStore.getState().loadSchemas("conn-1", true);

    expect(mocks.getResources).toHaveBeenCalledOnce();
    expect(mocks.refreshSchemas).toHaveBeenCalledOnce();
    refresh.resolve(["public"]);
    await Promise.all([first, second]);
  });

  it("serializes a forced schema refresh behind an in-flight cache read", async () => {
    useSchemaStore.setState({
      schemas: [],
      currentSchema: null,
      lastLoadedConnectionId: null,
    });
    const cachedResources = [
      {
        id: "conn-1:postgres:cached",
        connection_id: "conn-1",
        parent_id: null,
        kind: "DATABASE",
        name: "cached",
        metadata: { driver: "postgres" },
        last_updated: Date.now(),
      },
    ];
    const cacheRead = createDeferred<typeof cachedResources>();
    mocks.getResources
      .mockReturnValueOnce(cacheRead.promise)
      .mockResolvedValueOnce(cachedResources);
    mocks.refreshSchemas.mockResolvedValueOnce(["fresh"]);

    const cachedLoad = useSchemaStore.getState().loadSchemas("conn-1");
    const forcedLoad = useSchemaStore.getState().loadSchemas("conn-1", true);

    expect(mocks.getResources).toHaveBeenCalledOnce();
    expect(mocks.refreshSchemas).not.toHaveBeenCalled();
    cacheRead.resolve(cachedResources);
    await Promise.all([cachedLoad, forcedLoad]);

    expect(mocks.getResources).toHaveBeenCalledTimes(2);
    expect(mocks.refreshSchemas).toHaveBeenCalledOnce();
    expect(useSchemaStore.getState().schemas).toEqual(["fresh"]);
  });

  it("hydrates schema objects from MetaStore when switching schemas", async () => {
    localStorageMock.setItem(
      "oxide-studio-pinned-tables:sqls:conn-1:postgres:audit",
      JSON.stringify(["audit_log"]),
    );
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:audit:audit_log",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:audit",
        kind: "TABLE",
        name: "audit_log",
        metadata: {
          driver: "postgres",
          type: "BASE TABLE",
          comment: null,
        },
        last_updated: Date.now(),
      },
      {
        id: "conn-1:postgres:audit:TABLE_CACHE",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:audit",
        kind: "TABLE_CACHE",
        name: "TABLE_CACHE",
        metadata: { driver: "postgres", cached: true },
        last_updated: Date.now(),
      },
    ]);

    await useSchemaStore.getState().setCurrentSchema("audit");

    expect(mocks.setCurrentSchema).toHaveBeenCalledWith("conn-1", "audit");
    expect(mocks.refreshTables).not.toHaveBeenCalled();
    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "audit",
      pinnedTables: ["audit_log"],
      lastLoadedObjectKey: "sqls:conn-1:postgres:audit:tables",
    });
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual(
      ["audit_log"],
    );
    expect(
      useSchemaStore.getState().objectSnapshots["sqls:conn-1:postgres:audit"]
        .tables,
    ).toHaveLength(1);
  });

  it("refreshes tables and writes a cache marker only when forced", async () => {
    mocks.refreshTables.mockResolvedValueOnce([
      {
        name: "audit_log",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);

    await useSchemaStore.getState().loadTables("conn-1", "public", true);

    expect(mocks.refreshTables).toHaveBeenCalledWith("conn-1", "public");
    expect(mocks.replaceResources).toHaveBeenCalledWith(
      "conn-1",
      "conn-1:postgres:public",
      "TABLE",
      expect.arrayContaining([
        expect.objectContaining({
          kind: "TABLE",
          name: "audit_log",
        }),
      ]),
      "sqls",
    );
    expect(mocks.saveResources).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          kind: "TABLE_CACHE",
          parent_id: "conn-1:postgres:public",
        }),
      ],
      "sqls",
    );
  });

  it("coalesces concurrent table refreshes for one project schema", async () => {
    useSchemaStore.setState({ tables: [], lastLoadedObjectKey: null });
    mocks.getResources.mockResolvedValueOnce([]);
    const refresh = createDeferred<
      Array<{
        name: string;
        schema: string;
        type: string;
        comment: null;
      }>
    >();
    mocks.refreshTables.mockReturnValueOnce(refresh.promise);

    const first = useSchemaStore
      .getState()
      .loadTables("conn-1", "public", true);
    await vi.waitFor(() => expect(mocks.refreshTables).toHaveBeenCalledOnce());
    const second = useSchemaStore
      .getState()
      .loadTables("conn-1", "public", true);

    expect(mocks.getResources).toHaveBeenCalledOnce();
    expect(mocks.refreshTables).toHaveBeenCalledOnce();
    refresh.resolve([
      {
        name: "users",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    await Promise.all([first, second]);
  });

  it("serializes a forced table refresh behind an in-flight cache read", async () => {
    useSchemaStore.setState({
      tables: [],
      currentSchema: "public",
      lastLoadedObjectKey: null,
    });
    const cachedResources = [
      {
        id: "conn-1:postgres:public:cached_users",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:public",
        kind: "TABLE",
        name: "cached_users",
        metadata: {
          driver: "postgres",
          type: "BASE TABLE",
          comment: null,
        },
        last_updated: Date.now(),
      },
    ];
    const cacheRead = createDeferred<typeof cachedResources>();
    mocks.getResources
      .mockReturnValueOnce(cacheRead.promise)
      .mockResolvedValueOnce(cachedResources);
    mocks.refreshTables.mockResolvedValueOnce([
      {
        name: "fresh_users",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);

    const cachedLoad = useSchemaStore.getState().loadTables("conn-1", "public");
    const forcedLoad = useSchemaStore
      .getState()
      .loadTables("conn-1", "public", true);

    expect(mocks.getResources).toHaveBeenCalledOnce();
    expect(mocks.refreshTables).not.toHaveBeenCalled();
    cacheRead.resolve(cachedResources);
    await Promise.all([cachedLoad, forcedLoad]);

    expect(mocks.getResources).toHaveBeenCalledTimes(2);
    expect(mocks.refreshTables).toHaveBeenCalledOnce();
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual(
      ["fresh_users"],
    );
  });

  it("keeps cached tables visible during a forced background refresh", async () => {
    useSchemaStore.setState({ tables: [], isLoading: false });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:public:users",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:public",
        kind: "TABLE",
        name: "users",
        metadata: {
          driver: "postgres",
          type: "BASE TABLE",
          comment: null,
        },
        last_updated: Date.now(),
      },
      {
        id: "conn-1:postgres:public:TABLE_CACHE",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:public",
        kind: "TABLE_CACHE",
        name: "TABLE_CACHE",
        metadata: { driver: "postgres", cached: true },
        last_updated: Date.now(),
      },
    ]);
    const refresh = createDeferred<
      Array<{
        name: string;
        schema: string;
        type: string;
        comment: null;
      }>
    >();
    mocks.refreshTables.mockReturnValueOnce(refresh.promise);

    const loading = useSchemaStore
      .getState()
      .loadTables("conn-1", "public", true);
    await vi.waitFor(() => expect(mocks.refreshTables).toHaveBeenCalled());

    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual(
      ["users"],
    );
    expect(useSchemaStore.getState().isLoading).toBe(false);
    expect(
      useSchemaStore.getState().metadataNodeStates[
        getSchemaMetadataNodeKey("conn-1", "postgres", "public")
      ],
    ).toMatchObject({
      status: "ready",
      source: "cache",
      message: expect.stringContaining("background"),
    });

    refresh.resolve([
      {
        name: "users",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    await loading;
  });

  it("marks cached tables stale when a manual table refresh fails", async () => {
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "conn-1:postgres:public:users",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:public",
        kind: "TABLE",
        name: "users",
        metadata: {
          driver: "postgres",
          type: "BASE TABLE",
          comment: null,
        },
        last_updated: Date.now(),
      },
      {
        id: "conn-1:postgres:public:TABLE_CACHE",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:public",
        kind: "TABLE_CACHE",
        name: "TABLE_CACHE",
        metadata: { driver: "postgres", cached: true },
        last_updated: Date.now(),
      },
    ]);
    mocks.refreshTables.mockRejectedValueOnce(new Error("permission denied"));

    await useSchemaStore.getState().loadTables("conn-1", "public", true);

    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual(
      ["users"],
    );
    expect(useSchemaStore.getState().isLoading).toBe(false);
    expect(
      useSchemaStore.getState().metadataNodeStates[
        getSchemaMetadataNodeKey("conn-1", "postgres", "public")
      ],
    ).toMatchObject({
      status: "stale",
      source: "cache",
      message: expect.stringContaining("permission denied"),
    });
  });

  it("ignores a stale schema refresh after the project changes", async () => {
    mocks.getResources.mockResolvedValueOnce([]);
    const refresh = createDeferred<string[]>();
    mocks.refreshSchemas.mockReturnValueOnce(refresh.promise);

    const loading = useSchemaStore.getState().loadSchemas("conn-1", true);
    await vi.waitFor(() => expect(mocks.refreshSchemas).toHaveBeenCalled());
    localStorageMock.setItem("oxide-studio-active-project", "other");
    useSchemaStore.getState().reset();

    refresh.resolve(["stale_schema"]);
    await loading;

    expect(useSchemaStore.getState()).toMatchObject({
      schemas: [],
      isLoading: false,
    });
    expect(mocks.replaceResources).not.toHaveBeenCalled();
    expect(mocks.saveResources).not.toHaveBeenCalled();
  });

  it("ignores a stale table refresh after the project changes", async () => {
    mocks.getResources.mockResolvedValueOnce([]);
    const refresh = createDeferred<
      Array<{
        name: string;
        schema: string;
        type: string;
        comment: null;
      }>
    >();
    mocks.refreshTables.mockReturnValueOnce(refresh.promise);

    const loading = useSchemaStore
      .getState()
      .loadTables("conn-1", "public", true);
    await vi.waitFor(() => expect(mocks.refreshTables).toHaveBeenCalled());
    localStorageMock.setItem("oxide-studio-active-project", "other");
    useSchemaStore.getState().reset();

    refresh.resolve([
      {
        name: "stale_table",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    await loading;

    expect(useSchemaStore.getState()).toMatchObject({
      tables: [],
      isLoading: false,
    });
    expect(mocks.replaceResources).not.toHaveBeenCalled();
    expect(mocks.saveResources).not.toHaveBeenCalled();
  });

  it("ignores stale function, collection, and object-cache results after a project change", async () => {
    const functionResult = createDeferred<
      Array<{
        name: string;
        parameters: [];
        return_type: string;
      }>
    >();
    const collectionResult = createDeferred<
      Array<{
        name: string;
        namespace: string;
        type: string;
      }>
    >();
    mocks.getFunctions.mockReturnValueOnce(functionResult.promise);
    mocks.getCollections.mockReturnValueOnce(collectionResult.promise);

    const functionLoad = useSchemaStore
      .getState()
      .loadFunctions("conn-1", "public", true);
    await vi.waitFor(() => expect(mocks.getFunctions).toHaveBeenCalled());
    const collectionLoad = useSchemaStore
      .getState()
      .loadCollections("conn-1", "public", true);
    await vi.waitFor(() => expect(mocks.getCollections).toHaveBeenCalled());

    const hydrationResult = createDeferred<
      Array<{
        id: string;
        connection_id: string;
        parent_id: string;
        kind: string;
        name: string;
        metadata: { driver: string; type: string };
        last_updated: number;
      }>
    >();
    mocks.getResources.mockReturnValueOnce(hydrationResult.promise);
    const hydrationLoad = useSchemaStore
      .getState()
      .hydrateSchemaObjectsFromCache("conn-1", "public");
    await vi.waitFor(() => expect(mocks.getResources).toHaveBeenCalledTimes(3));

    expect(mocks.getResources).toHaveBeenNthCalledWith(
      1,
      "conn-1",
      "conn-1:postgres:public",
      "sqls",
    );
    expect(mocks.getResources).toHaveBeenNthCalledWith(
      2,
      "conn-1",
      "conn-1:postgres:public",
      "sqls",
    );
    expect(mocks.getResources).toHaveBeenNthCalledWith(
      3,
      "conn-1",
      "conn-1:postgres:public",
      "sqls",
    );

    localStorageMock.setItem("oxide-studio-active-project", "other");
    useSchemaStore.getState().reset();
    functionResult.resolve([
      { name: "stale_function", parameters: [], return_type: "integer" },
    ]);
    collectionResult.resolve([
      { name: "stale_collection", namespace: "public", type: "collection" },
    ]);
    hydrationResult.resolve([
      {
        id: "conn-1:postgres:public:stale_table",
        connection_id: "conn-1",
        parent_id: "conn-1:postgres:public",
        kind: "TABLE",
        name: "stale_table",
        metadata: { driver: "postgres", type: "BASE TABLE" },
        last_updated: Date.now(),
      },
    ]);

    await Promise.all([functionLoad, collectionLoad, hydrationLoad]);

    expect(useSchemaStore.getState()).toMatchObject({
      functions: [],
      collections: [],
      objectSnapshots: {},
      isFunctionsLoading: false,
      isCollectionsLoading: false,
    });
    expect(mocks.replaceResources).not.toHaveBeenCalled();
    expect(mocks.saveResources).not.toHaveBeenCalled();
  });

  it("ignores a stale Redis load-more page after a project change", async () => {
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
    useSchemaStore.setState({
      currentSchema: "0",
      collections: [{ name: "existing", namespace: "0", type: "string" }],
      collectionNextCursor: "next",
      collectionFilter: "",
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
    const pageResult = createDeferred<{
      items: Array<{ name: string; namespace: string; type: string }>;
      nextCursor: null;
      total: number;
    }>();
    mocks.getCollectionsPage.mockReturnValueOnce(pageResult.promise);

    const loading = useSchemaStore
      .getState()
      .loadMoreCollections("redis-1", "0");
    await vi.waitFor(() => expect(mocks.getCollectionsPage).toHaveBeenCalled());
    localStorageMock.setItem("oxide-studio-active-project", "other");
    useSchemaStore.getState().reset();

    pageResult.resolve({
      items: [{ name: "stale", namespace: "0", type: "string" }],
      nextCursor: null,
      total: 2,
    });
    await loading;

    expect(useSchemaStore.getState()).toMatchObject({
      collections: [],
      collectionNextCursor: null,
      isCollectionsLoading: false,
    });
  });

  it("forgets active connection metadata from SQLite and memory snapshots", async () => {
    useSchemaStore.setState({
      connectionSnapshots: {
        "sqls:conn-1:postgres": {
          schemas: ["public"],
          tables: [],
          collections: [],
          functions: [],
          pinnedTables: [],
          currentSchema: "public",
          defaultSchema: null,
          selectedTable: null,
          lastLoadedConnectionId: "sqls:conn-1:postgres",
          lastLoadedObjectKey: null,
          metadataVersion: 0,
        },
      },
      objectSnapshots: {
        "sqls:conn-1:postgres:public": {
          tables: [
            {
              name: "users",
              schema: "public",
              type: "BASE TABLE",
              comment: null,
            },
          ],
          collections: [],
          functions: [],
          pinnedTables: [],
          selectedTable: "users",
          lastLoadedObjectKey: "sqls:conn-1:postgres:public:tables",
        },
      },
      metadataNodeStates: {
        [getConnectionMetadataNodeKey("conn-1", "postgres")]: {
          status: "ready",
          source: "cache",
        },
        [getSchemaMetadataNodeKey("conn-1", "postgres", "public")]: {
          status: "ready",
          source: "cache",
        },
      },
    });

    await useSchemaStore.getState().forgetConnectionMetadata("conn-1");

    expect(mocks.deleteResources).toHaveBeenCalledWith("conn-1");
    expect(useSchemaStore.getState()).toMatchObject({
      schemas: [],
      tables: [],
      collections: [],
      functions: [],
      currentSchema: null,
      selectedTable: null,
      lastLoadedConnectionId: null,
      lastLoadedObjectKey: null,
    });
    expect(useSchemaStore.getState().connectionSnapshots).toEqual({});
    expect(useSchemaStore.getState().objectSnapshots).toEqual({});
    expect(useSchemaStore.getState().metadataNodeStates).toEqual({});
  });

  it("forgets one schema metadata without removing the schema list", async () => {
    useSchemaStore.setState({
      schemas: ["public", "audit"],
      currentSchema: "public",
      objectSnapshots: {
        "sqls:conn-1:postgres:public": {
          tables: [
            {
              name: "users",
              schema: "public",
              type: "BASE TABLE",
              comment: null,
            },
          ],
          collections: [],
          functions: [],
          pinnedTables: [],
          selectedTable: "users",
          lastLoadedObjectKey: "sqls:conn-1:postgres:public:tables",
        },
      },
      metadataNodeStates: {
        [getSchemaMetadataNodeKey("conn-1", "postgres", "public")]: {
          status: "ready",
          source: "cache",
        },
      },
    });

    await useSchemaStore.getState().forgetSchemaMetadata("conn-1", "public");

    expect(mocks.deleteResources).toHaveBeenCalledWith(
      "conn-1",
      "conn-1:postgres:public",
    );
    expect(useSchemaStore.getState()).toMatchObject({
      schemas: ["public", "audit"],
      currentSchema: "public",
      tables: [],
      selectedTable: null,
      lastLoadedObjectKey: null,
    });
    expect(useSchemaStore.getState().objectSnapshots).toEqual({});
    expect(useSchemaStore.getState().metadataNodeStates).toEqual({});
  });

  it("restores an opened schema from the in-memory snapshot without blanking", async () => {
    await useSchemaStore.getState().setCurrentSchema("audit");

    useSchemaStore.setState({
      tables: [
        {
          name: "audit_log",
          schema: "audit",
          type: "BASE TABLE",
          comment: null,
        },
      ],
      selectedTable: "audit_log",
      lastLoadedObjectKey: "sqls:conn-1:postgres:audit:tables",
    });

    await useSchemaStore.getState().setCurrentSchema("public");
    await useSchemaStore.getState().setCurrentSchema("audit");

    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "audit",
      selectedTable: "audit_log",
      lastLoadedObjectKey: "sqls:conn-1:postgres:audit:tables",
    });
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual(
      ["audit_log"],
    );
  });
});
