import { describe, expect, it } from "vitest";
import {
  createDeferred,
  fixture,
  getConnectionMetadataNodeKey,
  mocksForTests as mocks,
  useConnectionStore,
  useSchemaStore,
} from "./harness";

describe("schema store: namespace activation and cached schemas", () => {
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
    expect(fixture.localStorageMock.setItem).toHaveBeenCalledWith(
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

    expect(fixture.localStorageMock.setItem).not.toHaveBeenCalled();
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
});
