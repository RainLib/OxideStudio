import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import {
  getConnectionMetadataNodeKey,
  getSchemaMetadataNodeKey,
  useSchemaStore,
} from "@/store/useSchemaStore";

const mocks = vi.hoisted(() => ({
  getResources: vi.fn(async () => []),
  refreshSchemas: vi.fn(async () => []),
  refreshTables: vi.fn(async () => []),
  replaceResources: vi.fn(async () => undefined),
  saveResources: vi.fn(async () => undefined),
  deleteResources: vi.fn(async () => undefined),
  setCurrentSchema: vi.fn(async () => "ok"),
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

vi.mock("@/services/tauri", () => ({
  connectionService: {
    loadConnections: vi.fn(async () => []),
    saveConnections: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => undefined),
  },
  schemaService: {
    getCollections: vi.fn(async () => []),
    getFunctions: vi.fn(async () => []),
    refreshSchemas: mocks.refreshSchemas,
    refreshTables: mocks.refreshTables,
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
    mocks.replaceResources.mockResolvedValue(undefined);
    mocks.saveResources.mockResolvedValue(undefined);
    mocks.deleteResources.mockResolvedValue(undefined);
    mocks.setCurrentSchema.mockResolvedValue("ok");
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

  it("rolls back schema state when backend activation fails", async () => {
    mocks.setCurrentSchema.mockRejectedValueOnce(new Error("schema missing"));

    await expect(
      useSchemaStore.getState().setCurrentSchema("missing")
    ).rejects.toThrow("schema missing");

    expect(useSchemaStore.getState()).toMatchObject({
      currentSchema: "public",
      selectedTable: "users",
      isCollectionsLoading: true,
      isFunctionsLoading: true,
    });
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual([
      "users",
    ]);
    expect(
      useSchemaStore.getState().collections.map((collection) => collection.name)
    ).toEqual(["events"]);
    expect(
      useSchemaStore.getState().functions.map((func) => func.name)
    ).toEqual(["calculate_score"]);
  });

  it("updates local schema state without backend activation when disconnected", async () => {
    useConnectionStore.setState({ activeConnectionId: null, isConnected: false });

    await useSchemaStore.getState().setCurrentSchema("audit");

    expect(mocks.setCurrentSchema).not.toHaveBeenCalled();
    expect(useSchemaStore.getState().currentSchema).toBe("audit");
  });

  it("activates backend schema before persisting a default schema", async () => {
    await useSchemaStore.getState().setDefaultSchema("audit");

    expect(mocks.setCurrentSchema).toHaveBeenCalledWith("conn-1", "audit");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "oxide-studio-default-schema:sqls:conn-1:postgres",
      "audit"
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
      useSchemaStore.getState().setDefaultSchema("missing")
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
    expect(useSchemaStore.getState().connectionSnapshots["sqls:conn-1:postgres"])
      .toMatchObject({
        schemas: ["audit"],
        currentSchema: "audit",
        lastLoadedConnectionId: "sqls:conn-1:postgres",
      });
    expect(
      useSchemaStore.getState().metadataNodeStates[
        getConnectionMetadataNodeKey("conn-1", "postgres")
      ]
    ).toMatchObject({
      status: "ready",
      source: "cache",
    });
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
    expect(
      useSchemaStore.getState().metadataNodeStates[
        getConnectionMetadataNodeKey("conn-1", "postgres")
      ]
    ).toMatchObject({
      status: "stale",
      source: "cache",
      message: expect.stringContaining("network down"),
    });
  });

  it("hydrates schema objects from MetaStore when switching schemas", async () => {
    localStorageMock.setItem(
      "oxide-studio-pinned-tables:sqls:conn-1:postgres:audit",
      JSON.stringify(["audit_log"])
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
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual([
      "audit_log",
    ]);
    expect(
      useSchemaStore.getState().objectSnapshots["sqls:conn-1:postgres:audit"].tables
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
      ])
    );
    expect(mocks.saveResources).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "TABLE_CACHE",
        parent_id: "conn-1:postgres:public",
      }),
    ]);
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

    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual([
      "users",
    ]);
    expect(
      useSchemaStore.getState().metadataNodeStates[
        getSchemaMetadataNodeKey("conn-1", "postgres", "public")
      ]
    ).toMatchObject({
      status: "stale",
      source: "cache",
      message: expect.stringContaining("permission denied"),
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
      "conn-1:postgres:public"
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
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual([
      "audit_log",
    ]);
  });
});
