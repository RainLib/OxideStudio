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

describe("schema store: connection and table cache refresh", () => {
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
    fixture.localStorageMock.setItem(
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
});
