import { describe, expect, it, vi } from "vitest";
import {
  createDeferred,
  fixture,
  getConnectionMetadataNodeKey,
  getSchemaMetadataNodeKey,
  mocksForTests as mocks,
  useConnectionStore,
  useSchemaStore,
} from "./harness";

describe("schema store: project scope races and metadata cleanup", () => {
  it("ignores a stale schema refresh after the project changes", async () => {
    mocks.getResources.mockResolvedValueOnce([]);
    const refresh = createDeferred<string[]>();
    mocks.refreshSchemas.mockReturnValueOnce(refresh.promise);

    const loading = useSchemaStore.getState().loadSchemas("conn-1", true);
    await vi.waitFor(() => expect(mocks.refreshSchemas).toHaveBeenCalled());
    fixture.localStorageMock.setItem("oxide-studio-active-project", "other");
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
    fixture.localStorageMock.setItem("oxide-studio-active-project", "other");
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

    fixture.localStorageMock.setItem("oxide-studio-active-project", "other");
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
    fixture.localStorageMock.setItem("oxide-studio-active-project", "other");
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
