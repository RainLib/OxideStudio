import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";

const mocks = vi.hoisted(() => ({
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
    refreshSchemas: vi.fn(async () => []),
    refreshTables: vi.fn(async () => []),
    setCurrentSchema: mocks.setCurrentSchema,
  },
  storeService: {
    getResources: vi.fn(async () => []),
    replaceResources: vi.fn(async () => undefined),
  },
}));

describe("schema store", () => {
  let localStorageMock: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock = createStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);
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
      isLoading: false,
      isCollectionsLoading: true,
      isFunctionsLoading: true,
      metadataVersion: 0,
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
      "oxide-studio-default-schema:conn-1:postgres",
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
});
