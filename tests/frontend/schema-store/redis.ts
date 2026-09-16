import { describe, expect, it } from "vitest";
import {
  mocksForTests as mocks,
  useConnectionStore,
  useSchemaStore,
} from "./harness";

describe("schema store: Redis pagination and cache limits", () => {
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
});
