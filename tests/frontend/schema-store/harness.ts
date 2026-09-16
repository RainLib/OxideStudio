import { beforeEach, vi } from "vitest";
import { useConnectionStore as connectionStore } from "@/store/useConnectionStore";
import {
  getConnectionMetadataNodeKey as connectionMetadataNodeKey,
  getSchemaMetadataNodeKey as schemaMetadataNodeKey,
  getSchemaObjectMetadataSnapshotKey as schemaObjectMetadataSnapshotKey,
  useSchemaStore as schemaStore,
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

export function createDeferred<T>() {
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

let storageMock: ReturnType<typeof createStorageMock>;

export const fixture = {
  get localStorageMock() {
    return storageMock;
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock = createStorageMock();
  vi.stubGlobal("localStorage", storageMock);
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
  connectionStore.setState({
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
  schemaStore.setState({
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

export const mocksForTests = mocks;
export const useConnectionStore = connectionStore;
export const useSchemaStore = schemaStore;
export const getConnectionMetadataNodeKey = connectionMetadataNodeKey;
export const getSchemaMetadataNodeKey = schemaMetadataNodeKey;
export const getSchemaObjectMetadataSnapshotKey =
  schemaObjectMetadataSnapshotKey;
