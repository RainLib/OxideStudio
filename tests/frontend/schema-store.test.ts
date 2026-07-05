import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";

const mocks = vi.hoisted(() => ({
  setCurrentSchema: vi.fn(async () => "ok"),
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setCurrentSchema.mockResolvedValue("ok");
    useConnectionStore.setState({
      connections: [],
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
});
