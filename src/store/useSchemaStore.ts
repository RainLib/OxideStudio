import { create } from "zustand";
import {
  schemaService,
  storeService,
  TableInfo,
  CollectionInfo,
  FunctionInfo,
  Resource,
} from "@/services/tauri";
import { useConnectionStore } from "./useConnectionStore";
import { useTaskStore } from "./useTaskStore";
import { selectPreferredNamespace } from "@/lib/databaseDialect";

interface SchemaState {
  schemas: string[];
  tables: TableInfo[];
  collections: CollectionInfo[];
  collectionNextCursor: string | null;
  collectionTotal: number | null;
  collectionLoadingKey: string | null;
  collectionFilter: string;
  functions: FunctionInfo[];
  pinnedTables: string[];
  currentSchema: string | null;
  defaultSchema: string | null; // User's preferred default
  selectedTable: string | null;
  lastLoadedConnectionId: string | null; // Guard for duplicate calls
  lastLoadedObjectKey: string | null;
  isLoading: boolean;
  isCollectionsLoading: boolean;
  isFunctionsLoading: boolean;
  metadataVersion: number;
  connectionSnapshots: Record<string, ConnectionMetadataSnapshot>;
  objectSnapshots: Record<string, SchemaObjectSnapshot>;
  metadataNodeStates: Record<string, MetadataNodeState>;

  loadSchemas: (connectionId: string, force?: boolean) => Promise<void>;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean
  ) => Promise<void>;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean,
    filter?: string
  ) => Promise<void>;
  loadMoreCollections: (
    connectionId: string,
    namespace: string
  ) => Promise<void>;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean
  ) => Promise<void>;
  bumpMetadataVersion: () => void;
  togglePinTable: (tableName: string) => void;
  setCurrentSchema: (schema: string) => Promise<void>;
  setDefaultSchema: (schema: string) => Promise<void>; // Persist user's choice
  selectTable: (table: string | null) => void;
  snapshotActiveMetadata: () => void;
  restoreConnectionSnapshot: (connectionId: string) => boolean;
  hydrateConnectionMetadataFromCache: (connectionId: string) => Promise<boolean>;
  hydrateSchemaObjectsFromCache: (
    connectionId: string,
    schema: string
  ) => Promise<boolean>;
  forgetConnectionMetadata: (connectionId: string) => Promise<void>;
  forgetSchemaMetadata: (connectionId: string, schema: string) => Promise<void>;
  setMetadataNodeState: (
    key: string,
    state: Partial<MetadataNodeState> & Pick<MetadataNodeState, "status">
  ) => void;
  markMetadataNodeStale: (key: string, message?: string) => void;
  clearMetadataNodeState: (key: string) => void;
  clearActiveMetadata: () => void;
  reset: () => void;
}

export type MetadataNodeStatus =
  | "idle"
  | "loading"
  | "ready"
  | "stale"
  | "error";

export interface MetadataNodeState {
  status: MetadataNodeStatus;
  message?: string | null;
  updatedAt?: number | null;
  source?: "cache" | "remote" | null;
}

interface ConnectionMetadataSnapshot {
  schemas: string[];
  tables: TableInfo[];
  collections: CollectionInfo[];
  collectionNextCursor?: string | null;
  collectionTotal?: number | null;
  collectionFilter?: string;
  functions: FunctionInfo[];
  pinnedTables: string[];
  currentSchema: string | null;
  defaultSchema: string | null;
  selectedTable: string | null;
  lastLoadedConnectionId: string | null;
  lastLoadedObjectKey: string | null;
  metadataVersion: number;
}

interface SchemaObjectSnapshot {
  tables: TableInfo[];
  collections: CollectionInfo[];
  functions: FunctionInfo[];
  pinnedTables: string[];
  selectedTable: string | null;
  lastLoadedObjectKey: string | null;
}

const LEGACY_STORAGE_KEY = "oxide-studio-default-schema";
const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";
const DEFAULT_PROJECT_ID = "sqls";
const getActiveProjectId = () =>
  readStorageItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
let metadataGeneration = 0;

interface MetadataLoadFlight {
  force: boolean;
  promise: Promise<void>;
}

const schemaLoadsInFlight = new Map<string, MetadataLoadFlight>();
const tableLoadsInFlight = new Map<string, MetadataLoadFlight>();

interface MetadataRequestContext {
  connectionId: string;
  generation: number;
  projectId: string;
}

const captureMetadataRequest = (
  connectionId: string
): MetadataRequestContext => ({
  connectionId,
  generation: metadataGeneration,
  projectId: getActiveProjectId(),
});

const isMetadataRequestCurrent = (request: MetadataRequestContext) =>
  request.generation === metadataGeneration &&
  request.projectId === getActiveProjectId() &&
  useConnectionStore.getState().activeConnectionId === request.connectionId;
const metadataRequestKey = (
  request: MetadataRequestContext,
  ...parts: string[]
) => [request.generation, request.projectId, request.connectionId, ...parts].join(":");
const projectScopedKey = (...parts: Array<string | null | undefined>) =>
  [getActiveProjectId(), ...parts.map((part) => part || "unknown")].join(":");
const getDefaultSchemaKey = (
  connId: string,
  driver: string | null | undefined
) => `oxide-studio-default-schema:${projectScopedKey(connId, driver)}`;
const getPinnedTablesKey = (
  connId: string,
  schema: string,
  driver: string | null | undefined
) => `oxide-studio-pinned-tables:${projectScopedKey(connId, driver, schema)}`;
const getConnectionDriver = (connectionId: string) =>
  useConnectionStore
    .getState()
    .connections.find((connection) => connection.id === connectionId)?.driver ||
  null;
const getSchemaResourceId = (
  connectionId: string,
  schema: string,
  driver: string | null | undefined
) => `${connectionId}:${driver || "unknown"}:${schema}`;
const getConnectionSnapshotKey = (
  connectionId: string,
  driver: string | null | undefined
) => projectScopedKey(connectionId, driver);
const getObjectSnapshotKey = (
  connectionId: string,
  driver: string | null | undefined,
  schema: string
) => projectScopedKey(connectionId, driver, schema);
const getLoadKey = (
  connectionId: string,
  driver: string | null | undefined
) => projectScopedKey(connectionId, driver);
const getObjectLoadKey = (
  connectionId: string,
  driver: string | null | undefined,
  schema: string,
  kind: string
) => projectScopedKey(connectionId, driver, schema, kind);
export const getConnectionMetadataSnapshotKey = getConnectionSnapshotKey;
export const getSchemaObjectMetadataSnapshotKey = getObjectSnapshotKey;
export const getConnectionMetadataNodeKey = (
  connectionId: string,
  driver: string | null | undefined
) => `connection:${getLoadKey(connectionId, driver)}`;
export const getSchemaMetadataNodeKey = (
  connectionId: string,
  driver: string | null | undefined,
  schema: string
) => `schema:${getObjectLoadKey(connectionId, driver, schema, "tables")}`;
const SCHEMA_CACHE_KIND = "DATABASE_CACHE";
const TABLE_CACHE_KIND = "TABLE_CACHE";
const COLLECTION_CACHE_KIND = "COLLECTION_CACHE";
const REDIS_KEY_COUNT_CACHE_KIND = "REDIS_KEY_COUNT_CACHE";
const FUNCTION_CACHE_KIND = "FUNCTION_CACHE";
export const REDIS_KEY_PAGE_SIZE = 100;
export const MAX_REDIS_KEYS_IN_MEMORY = 500;
const resourceMatchesDriver = (
  resource: Resource,
  driver: string | null | undefined
) => Boolean(driver && resource.metadata?.driver === driver);
const redisTotalFromResources = (
  resources: Resource[],
  namespace: string | null,
  driver: string | null | undefined
) => {
  if (driver !== "redis" || !namespace) return null;
  const total = resources.find(
    (resource) =>
      resource.kind === REDIS_KEY_COUNT_CACHE_KIND &&
      resourceMatchesDriver(resource, driver) &&
      resource.name === namespace
  )?.metadata?.total;
  return typeof total === "number" ? total : null;
};
const hasCacheMarker = (
  resources: Resource[],
  kind: string,
  driver: string | null | undefined
) =>
  resources.some(
    (resource) =>
      resource.kind === kind && resourceMatchesDriver(resource, driver)
  );
const createCacheMarker = (
  connectionId: string,
  parentId: string | undefined,
  kind: string,
  driver: string | null | undefined
): Resource => ({
  id: `${connectionId}:${driver || "unknown"}:${parentId || "root"}:${kind}`,
  connection_id: connectionId,
  parent_id: parentId,
  kind,
  name: kind,
  metadata: { driver, cached: true },
  last_updated: Date.now(),
});
const resourcesToTables = (
  resources: Resource[],
  schema: string,
  driver: string | null | undefined
): TableInfo[] =>
  resources
    .filter(
      (resource) =>
        resource.kind === "TABLE" && resourceMatchesDriver(resource, driver)
    )
    .map((resource) => ({
      name: resource.name,
      schema,
      type: resource.metadata?.type,
      comment: resource.metadata?.comment,
    }));
const resourcesToCollections = (
  resources: Resource[],
  namespace: string,
  driver: string | null | undefined
): CollectionInfo[] =>
  resources
    .filter(
      (resource) =>
        resource.kind === "COLLECTION" &&
        resourceMatchesDriver(resource, driver)
    )
    .map((resource) => ({
      name: resource.name,
      namespace:
        typeof resource.metadata?.namespace === "string"
          ? resource.metadata.namespace
          : namespace || null,
      type:
        typeof resource.metadata?.type === "string"
          ? resource.metadata.type
          : null,
      documentCount:
        typeof resource.metadata?.documentCount === "number"
          ? resource.metadata.documentCount
          : null,
    }));
const resourcesToFunctions = (
  resources: Resource[],
  driver: string | null | undefined
): FunctionInfo[] =>
  resources
    .filter(
      (resource) =>
        resource.kind === "FUNCTION" && resourceMatchesDriver(resource, driver)
    )
    .map((resource) => ({
      name: resource.name,
      routine_type:
        typeof resource.metadata?.routine_type === "string"
          ? resource.metadata.routine_type
          : null,
      parameters: Array.isArray(resource.metadata?.parameters)
        ? resource.metadata.parameters
        : [],
      return_type:
        typeof resource.metadata?.return_type === "string"
          ? resource.metadata.return_type
          : "",
      description:
        typeof resource.metadata?.description === "string"
          ? resource.metadata.description
          : null,
    }));
const getSavedDefaultSchema = (
  connectionId: string,
  driver: string | null | undefined
) =>
  readStorageItem(getDefaultSchemaKey(connectionId, driver)) ||
  (getActiveProjectId() === DEFAULT_PROJECT_ID
    ? readStorageItem(LEGACY_STORAGE_KEY)
    : null);

function readStorageItem(key: string) {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch (error) {
    console.warn("Store: Failed to read localStorage", error);
    return null;
  }
}

function writeStorageItem(key: string, value: string) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch (error) {
    console.warn("Store: Failed to write localStorage", error);
  }
}

const readPinnedTables = (
  connectionId: string,
  schema: string,
  driver: string | null | undefined
) => {
  try {
    const parsedPins = JSON.parse(
      readStorageItem(getPinnedTablesKey(connectionId, schema, driver)) || "[]"
    );
    return Array.isArray(parsedPins)
      ? parsedPins.filter((value): value is string => typeof value === "string")
      : [];
  } catch (error) {
    console.warn("Store: Failed to read pinned tables", error);
    return [];
  }
};

async function activateBackendSchema(connectionId: string, schema: string | null) {
  if (!schema) return true;

  try {
    await schemaService.setCurrentSchema(connectionId, schema);
    return true;
  } catch (error) {
    console.warn("Store: Failed to activate backend schema", error);
    return false;
  }
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  schemas: [],
  tables: [],
  collections: [],
  collectionNextCursor: null,
  collectionTotal: null,
  collectionLoadingKey: null,
  collectionFilter: "",
  functions: [],
  pinnedTables: [],
  currentSchema: null,
  defaultSchema: null,
  selectedTable: null,
  lastLoadedConnectionId: null,
  lastLoadedObjectKey: null,
  isLoading: false,
  isCollectionsLoading: false,
  isFunctionsLoading: false,
  metadataVersion: 0,
  connectionSnapshots: {},
  objectSnapshots: {},
  metadataNodeStates: {},

  setMetadataNodeState: (key, nodeState) => {
    set((state) => ({
      metadataNodeStates: {
        ...state.metadataNodeStates,
        [key]: {
          ...state.metadataNodeStates[key],
          ...nodeState,
          updatedAt: nodeState.updatedAt ?? Date.now(),
        },
      },
    }));
  },

  markMetadataNodeStale: (key, message) => {
    set((state) => ({
      metadataNodeStates: {
        ...state.metadataNodeStates,
        [key]: {
          ...state.metadataNodeStates[key],
          status: "stale",
          message: message || state.metadataNodeStates[key]?.message || null,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  clearMetadataNodeState: (key) => {
    set((state) => {
      const next = { ...state.metadataNodeStates };
      delete next[key];
      return { metadataNodeStates: next };
    });
  },

  clearActiveMetadata: () => {
    set({
      schemas: [],
      tables: [],
      collections: [],
      collectionNextCursor: null,
      collectionTotal: null,
      collectionLoadingKey: null,
      collectionFilter: "",
      functions: [],
      pinnedTables: [],
      currentSchema: null,
      selectedTable: null,
      lastLoadedConnectionId: null,
      lastLoadedObjectKey: null,
      isLoading: false,
      isCollectionsLoading: false,
      isFunctionsLoading: false,
      metadataVersion: 0,
    });
  },

  reset: () => {
    metadataGeneration += 1;
    set({
      schemas: [],
      tables: [],
      collections: [],
      collectionNextCursor: null,
      collectionTotal: null,
      collectionLoadingKey: null,
      collectionFilter: "",
      functions: [],
      pinnedTables: [],
      currentSchema: null,
      selectedTable: null,
      lastLoadedConnectionId: null,
      lastLoadedObjectKey: null,
      isLoading: false,
      isCollectionsLoading: false,
      isFunctionsLoading: false,
      metadataVersion: 0,
      connectionSnapshots: {},
      objectSnapshots: {},
      metadataNodeStates: {},
    });
  },

  snapshotActiveMetadata: () => {
    const { activeConnectionId } = useConnectionStore.getState();
    if (!activeConnectionId) return;

    const activeDriver = getConnectionDriver(activeConnectionId);
    const state = get();
    const snapshotCollections =
      activeDriver === "redis"
        ? state.collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
        : state.collections;
    const snapshotLastLoadedObjectKey = state.lastLoadedObjectKey;
    const connectionKey = getConnectionSnapshotKey(
      activeConnectionId,
      activeDriver
    );
    const nextConnectionSnapshots = {
      ...state.connectionSnapshots,
      [connectionKey]: {
        schemas: state.schemas,
        tables: state.tables,
        collections: snapshotCollections,
        collectionNextCursor: state.collectionNextCursor,
        collectionTotal: state.collectionTotal,
        collectionFilter: state.collectionFilter,
        functions: state.functions,
        pinnedTables: state.pinnedTables,
        currentSchema: state.currentSchema,
        defaultSchema: state.defaultSchema,
        selectedTable: state.selectedTable,
        lastLoadedConnectionId: state.lastLoadedConnectionId,
        lastLoadedObjectKey: snapshotLastLoadedObjectKey,
        metadataVersion: state.metadataVersion,
      },
    };

    let nextObjectSnapshots = state.objectSnapshots;
    if (state.currentSchema) {
      const objectKey = getObjectSnapshotKey(
        activeConnectionId,
        activeDriver,
        state.currentSchema
      );
      nextObjectSnapshots = {
        ...state.objectSnapshots,
        [objectKey]: {
          tables: state.tables,
          collections: snapshotCollections,
          functions: state.functions,
          pinnedTables: state.pinnedTables,
          selectedTable: state.selectedTable,
          lastLoadedObjectKey: snapshotLastLoadedObjectKey,
        },
      };
    }

    set({
      connectionSnapshots: nextConnectionSnapshots,
      objectSnapshots: nextObjectSnapshots,
    });
  },

  restoreConnectionSnapshot: (connectionId: string) => {
    const activeDriver = getConnectionDriver(connectionId);
    const connectionKey = getConnectionSnapshotKey(connectionId, activeDriver);
    const snapshot = get().connectionSnapshots[connectionKey];

    if (!snapshot) {
      get().clearActiveMetadata();
      return false;
    }

    set({
      schemas: snapshot.schemas,
      tables: snapshot.tables,
      // Legacy Redis snapshots may contain an unbounded key list. Retain only
      // the same safe window used by live pagination.
      collections:
        activeDriver === "redis"
          ? snapshot.collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
          : snapshot.collections,
      collectionNextCursor: snapshot.collectionNextCursor ?? null,
      collectionTotal: snapshot.collectionTotal ?? null,
      collectionLoadingKey: null,
      collectionFilter: snapshot.collectionFilter ?? "",
      functions: snapshot.functions,
      pinnedTables: snapshot.pinnedTables,
      currentSchema: snapshot.currentSchema,
      defaultSchema: snapshot.defaultSchema,
      selectedTable: snapshot.selectedTable,
      lastLoadedConnectionId: snapshot.lastLoadedConnectionId,
      lastLoadedObjectKey: snapshot.lastLoadedObjectKey,
      isLoading: false,
      isCollectionsLoading: false,
      isFunctionsLoading: false,
      metadataVersion: snapshot.metadataVersion,
    });

    return true;
  },

  hydrateConnectionMetadataFromCache: async (connectionId: string) => {
    const request = captureMetadataRequest(connectionId);
    if (!isMetadataRequestCurrent(request)) return false;
    const connections = useConnectionStore.getState().connections;
    const connection = connections.find((item) => item.id === connectionId);
    const activeDriver = connection?.driver || null;
    const configDefault = connection?.database;
    const savedDefault = getSavedDefaultSchema(connectionId, activeDriver);

    try {
      const cachedResources = await storeService.getResources(
        connectionId,
        undefined,
        request.projectId
      );
      if (!isMetadataRequestCurrent(request)) return false;
      const cachedSchemas = cachedResources
        .filter(
          (resource) =>
            resource.kind === "DATABASE" &&
            resourceMatchesDriver(resource, activeDriver)
        )
        .map((resource) => resource.name);
      const hasCachedSchemaGroup = hasCacheMarker(
        cachedResources,
        SCHEMA_CACHE_KIND,
        activeDriver
      );

      if (cachedSchemas.length === 0 && !hasCachedSchemaGroup) {
        return false;
      }

      const schemaToSelect = selectPreferredNamespace(activeDriver, cachedSchemas, [
        configDefault,
        savedDefault,
      ]);
      const cachedRedisTotal = redisTotalFromResources(
        cachedResources,
        schemaToSelect,
        activeDriver
      );
      const connectionKey = getConnectionSnapshotKey(connectionId, activeDriver);
      const loadKey = getLoadKey(connectionId, activeDriver);
      const nodeKey = getConnectionMetadataNodeKey(connectionId, activeDriver);
      set((state) => ({
        connectionSnapshots: {
          ...state.connectionSnapshots,
          [connectionKey]: {
            schemas: cachedSchemas,
            tables: [],
            collections: [],
            collectionNextCursor: null,
            collectionTotal: cachedRedisTotal,
            collectionFilter: "",
            functions: [],
            pinnedTables: schemaToSelect
              ? readPinnedTables(connectionId, schemaToSelect, activeDriver)
              : [],
            currentSchema: schemaToSelect,
            defaultSchema: savedDefault,
            selectedTable: null,
            lastLoadedConnectionId: loadKey,
            lastLoadedObjectKey: null,
            metadataVersion: state.metadataVersion,
          },
        },
        metadataNodeStates: {
          ...state.metadataNodeStates,
          [nodeKey]: {
            ...state.metadataNodeStates[nodeKey],
            status: "ready",
            source: "cache",
            message: `${cachedSchemas.length.toLocaleString()} ${cachedSchemas.length === 1 ? "schema" : "schemas"} from cache`,
            updatedAt: Date.now(),
          },
        },
      }));
      if (isMetadataRequestCurrent(request)) {
        get().restoreConnectionSnapshot(connectionId);
      }
      return true;
    } catch (error) {
      console.warn("Store: Failed to hydrate connection metadata from cache", error);
      return false;
    }
  },

  hydrateSchemaObjectsFromCache: async (connectionId: string, schema: string) => {
    if (!connectionId || !schema) return false;
    const request = captureMetadataRequest(connectionId);
    if (!isMetadataRequestCurrent(request)) return false;

    const activeDriver = getConnectionDriver(connectionId);
    if (activeDriver === "redis") {
      // Redis keys are cursor data, not durable metadata. Reading a legacy
      // SQLite child set here can deserialize every cached key on connection
      // expansion, defeating the bounded SCAN path.
      const objectKey = getObjectSnapshotKey(connectionId, activeDriver, schema);
      set((state) => {
        const objectSnapshots = { ...state.objectSnapshots };
        delete objectSnapshots[objectKey];
        const isActiveSchema =
          useConnectionStore.getState().activeConnectionId === connectionId &&
          state.currentSchema === schema;
        return {
          objectSnapshots,
          ...(isActiveSchema
            ? {
                collections: [],
                collectionNextCursor: null,
                collectionTotal: null,
                collectionLoadingKey: null,
                collectionFilter: "",
                lastLoadedObjectKey: null,
              }
            : {}),
        };
      });
      return false;
    }
    const schemaResourceId = getSchemaResourceId(
      connectionId,
      schema,
      activeDriver
    );
    const nodeKey = getSchemaMetadataNodeKey(connectionId, activeDriver, schema);

    try {
      const cachedResources = await storeService.getResources(
        connectionId,
        schemaResourceId,
        request.projectId
      );
      if (!isMetadataRequestCurrent(request)) return false;
      const cachedTables = resourcesToTables(
        cachedResources,
        schema,
        activeDriver
      );
      const cachedCollections = resourcesToCollections(
        cachedResources,
        schema,
        activeDriver
      );
      const cachedFunctions = resourcesToFunctions(
        cachedResources,
        activeDriver
      );
      const hasCachedTableGroup = hasCacheMarker(
        cachedResources,
        TABLE_CACHE_KIND,
        activeDriver
      );
      const hasCachedCollectionGroup = hasCacheMarker(
        cachedResources,
        COLLECTION_CACHE_KIND,
        activeDriver
      );
      const hasCachedFunctionGroup = hasCacheMarker(
        cachedResources,
        FUNCTION_CACHE_KIND,
        activeDriver
      );
      const hasAnyCachedObject =
        cachedTables.length > 0 ||
        cachedCollections.length > 0 ||
        cachedFunctions.length > 0 ||
        hasCachedTableGroup ||
        hasCachedCollectionGroup ||
        hasCachedFunctionGroup;

      if (!hasAnyCachedObject) {
        get().setMetadataNodeState(nodeKey, {
          status: "stale",
          source: "cache",
          message: "No cached object metadata. Use Refresh to introspect.",
        });
        return false;
      }

      const savedPins = readPinnedTables(connectionId, schema, activeDriver);
      const objectKey = getObjectSnapshotKey(connectionId, activeDriver, schema);
      const objectLoadKey =
        cachedTables.length > 0 || hasCachedTableGroup
          ? getObjectLoadKey(connectionId, activeDriver, schema, "tables")
          : cachedCollections.length > 0 || hasCachedCollectionGroup
            ? getObjectLoadKey(connectionId, activeDriver, schema, "collections")
            : getObjectLoadKey(connectionId, activeDriver, schema, "functions");

      set((state) => {
        const isActiveSchema =
          useConnectionStore.getState().activeConnectionId === connectionId &&
          state.currentSchema === schema;

        return {
          objectSnapshots: {
            ...state.objectSnapshots,
            [objectKey]: {
              tables: cachedTables,
              collections: cachedCollections,
              functions: cachedFunctions,
              pinnedTables: savedPins,
              selectedTable: isActiveSchema ? state.selectedTable : null,
              lastLoadedObjectKey: objectLoadKey,
            },
          },
          ...(isActiveSchema
            ? {
                tables: cachedTables,
                collections: cachedCollections,
                functions: cachedFunctions,
                pinnedTables: savedPins,
                lastLoadedObjectKey: objectLoadKey,
                isLoading: false,
                isCollectionsLoading: false,
                isFunctionsLoading: false,
              }
            : {}),
        };
      });
      get().setMetadataNodeState(nodeKey, {
        status: "ready",
        source: "cache",
        message: `${(
          cachedTables.length +
          cachedCollections.length +
          cachedFunctions.length
        ).toLocaleString()} objects from cache`,
      });
      return true;
    } catch (error) {
      if (!isMetadataRequestCurrent(request)) return false;
      console.warn("Store: Failed to hydrate schema objects from cache", error);
      get().setMetadataNodeState(nodeKey, {
        status: "error",
        source: "cache",
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },

  forgetConnectionMetadata: async (connectionId: string) => {
    const activeDriver = getConnectionDriver(connectionId);
    await storeService.deleteResources(connectionId);

    set((state) => {
      const connectionSnapshotKey = getConnectionSnapshotKey(
        connectionId,
        activeDriver
      );
      const snapshotPrefix = projectScopedKey(connectionId, activeDriver);
      const nodeConnectionPrefix = `connection:${snapshotPrefix}`;
      const nodeSchemaPrefix = `schema:${snapshotPrefix}:`;
      const nextConnectionSnapshots = { ...state.connectionSnapshots };
      const nextObjectSnapshots = { ...state.objectSnapshots };
      const nextNodeStates = { ...state.metadataNodeStates };

      delete nextConnectionSnapshots[connectionSnapshotKey];
      Object.keys(nextObjectSnapshots).forEach((key) => {
        if (key.startsWith(`${snapshotPrefix}:`)) {
          delete nextObjectSnapshots[key];
        }
      });
      Object.keys(nextNodeStates).forEach((key) => {
        if (key === nodeConnectionPrefix || key.startsWith(nodeSchemaPrefix)) {
          delete nextNodeStates[key];
        }
      });

      const isActiveConnection =
        useConnectionStore.getState().activeConnectionId === connectionId;

      return {
        connectionSnapshots: nextConnectionSnapshots,
        objectSnapshots: nextObjectSnapshots,
        metadataNodeStates: nextNodeStates,
        ...(isActiveConnection
          ? {
              schemas: [],
              tables: [],
              collections: [],
              functions: [],
              pinnedTables: [],
              currentSchema: null,
              selectedTable: null,
              lastLoadedConnectionId: null,
              lastLoadedObjectKey: null,
              isLoading: false,
              isCollectionsLoading: false,
              isFunctionsLoading: false,
              metadataVersion: state.metadataVersion + 1,
            }
          : {}),
      };
    });
  },

  forgetSchemaMetadata: async (connectionId: string, schema: string) => {
    const activeDriver = getConnectionDriver(connectionId);
    const schemaResourceId = getSchemaResourceId(
      connectionId,
      schema,
      activeDriver
    );
    const schemaResources = await storeService
      .getResources(connectionId, schemaResourceId)
      .catch(() => []);
    await Promise.all(
      schemaResources.map((resource) =>
        storeService.deleteResources(connectionId, resource.id)
      )
    );
    await storeService.deleteResources(connectionId, schemaResourceId);

    set((state) => {
      const objectKey = getObjectSnapshotKey(connectionId, activeDriver, schema);
      const nodeKey = getSchemaMetadataNodeKey(connectionId, activeDriver, schema);
      const nextObjectSnapshots = { ...state.objectSnapshots };
      const nextNodeStates = { ...state.metadataNodeStates };
      delete nextObjectSnapshots[objectKey];
      delete nextNodeStates[nodeKey];

      const isActiveSchema =
        useConnectionStore.getState().activeConnectionId === connectionId &&
        state.currentSchema === schema;

      return {
        objectSnapshots: nextObjectSnapshots,
        metadataNodeStates: nextNodeStates,
        ...(isActiveSchema
          ? {
              tables: [],
              collections: [],
              functions: [],
              pinnedTables: [],
              selectedTable: null,
              lastLoadedObjectKey: null,
              isLoading: false,
              isCollectionsLoading: false,
              isFunctionsLoading: false,
              metadataVersion: state.metadataVersion + 1,
            }
          : {}),
      };
    });
  },

  loadSchemas: async (connectionId: string, force = false) => {
    const request = captureMetadataRequest(connectionId);
    if (!isMetadataRequestCurrent(request)) return;
    const requestKey = metadataRequestKey(request, "schemas");
    const pendingLoad = schemaLoadsInFlight.get(requestKey);
    if (pendingLoad) {
      await pendingLoad.promise;
      if (
        force &&
        !pendingLoad.force &&
        isMetadataRequestCurrent(request)
      ) {
        await get().loadSchemas(connectionId, true);
      }
      return;
    }
    let completeLoad = () => {};
    const loadCompletion = new Promise<void>((resolve) => {
      completeLoad = resolve;
    });
    const loadFlight: MetadataLoadFlight = {
      force,
      promise: loadCompletion,
    };
    schemaLoadsInFlight.set(requestKey, loadFlight);

    try {
    const { lastLoadedConnectionId, isLoading } = get();
    const connections = useConnectionStore.getState().connections;
    const activeConn = connections.find((c) => c.id === connectionId);
    const activeDriver = activeConn?.driver || null;
    const configDefault = activeConn?.database;
    const savedDefault = getSavedDefaultSchema(connectionId, activeDriver);
    const loadKey = getLoadKey(connectionId, activeDriver);
    const nodeKey = getConnectionMetadataNodeKey(connectionId, activeDriver);

    // Prevent duplicate calls if we're already loading or if the connection hasn't changed (unless forced)
    if (
      (isLoading && lastLoadedConnectionId === loadKey) ||
      (lastLoadedConnectionId === loadKey && !force)
    ) {
      console.log("Store: loadSchemas skipped (redundant)");
      return;
    }

    console.log(
      "Store: loadSchemas called (MetaStore aware) for:",
      connectionId
    );
    set({
      lastLoadedConnectionId: loadKey,
    });

    let hasCachedSchemaSnapshot = false;

    // 1. Try MetaStore Cache First (SQLite)
    try {
      // Fetch DB resources (parent_id = null)
      const cachedResources = await storeService.getResources(
        connectionId,
        undefined,
        request.projectId
      );
      if (!isMetadataRequestCurrent(request)) return;
      const cachedSchemas = cachedResources
        .filter(
          (resource) =>
            resource.kind === "DATABASE" &&
            resourceMatchesDriver(resource, activeDriver)
        )
        .map((r) => r.name);

      if (
        (cachedSchemas && cachedSchemas.length > 0) ||
        hasCacheMarker(cachedResources, SCHEMA_CACHE_KIND, activeDriver)
      ) {
        hasCachedSchemaSnapshot = true;
        console.log(
          "Store: Loaded schemas from MetaStore",
          cachedSchemas.length
        );
        const currentSchema = get().currentSchema;
        const schemaToSelect = selectPreferredNamespace(activeDriver, cachedSchemas, [
          currentSchema,
          configDefault,
          savedDefault,
        ]);
        set({
          schemas: cachedSchemas,
          currentSchema: schemaToSelect,
          defaultSchema: savedDefault,
          ...(activeDriver === "redis"
            ? {
                collectionTotal:
                  redisTotalFromResources(
                    cachedResources,
                    schemaToSelect,
                    activeDriver
                  ) ?? get().collectionTotal,
              }
            : {}),
          // Cached metadata is usable immediately. A forced remote refresh is
          // represented by the node state and must not block cached children.
          isLoading: false,
        });
        get().setMetadataNodeState(nodeKey, {
          status: "ready",
          source: "cache",
          message: `${cachedSchemas.length.toLocaleString()} ${cachedSchemas.length === 1 ? "schema" : "schemas"} from cache`,
        });
        set((state) => ({
          connectionSnapshots: {
            ...state.connectionSnapshots,
            [getConnectionSnapshotKey(connectionId, activeDriver)]: {
              schemas: cachedSchemas,
              tables: state.tables,
              collections:
                activeDriver === "redis"
                  ? state.collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
                  : state.collections,
              collectionNextCursor: state.collectionNextCursor,
              collectionTotal: state.collectionTotal,
              collectionFilter: state.collectionFilter,
              functions: state.functions,
              pinnedTables: state.pinnedTables,
              currentSchema: schemaToSelect,
              defaultSchema: savedDefault,
              selectedTable: state.selectedTable,
              lastLoadedConnectionId: loadKey,
              lastLoadedObjectKey: state.lastLoadedObjectKey,
              metadataVersion: state.metadataVersion,
            },
          },
        }));

        const schemaActivated = await activateBackendSchema(
          connectionId,
          schemaToSelect
        );
        if (!isMetadataRequestCurrent(request)) return;
        if (!schemaActivated && !force) {
          throw new Error("Cached schema could not be activated on backend");
        }

        // If we found data, we rely on user to trigger explicit refresh if needed
        // OR we could background refresh. User requirement: "Update only when triggered".
        // So we STOP here if cache hit.
        if (!force) return;
      }
    } catch (e) {
      if (!isMetadataRequestCurrent(request)) return;
      console.warn("Store: MetaStore cache miss or error", e);
    }

    // 2. Refresh from Driver & Update MetaStore (Only if cache miss or forced)
    if (!isMetadataRequestCurrent(request)) return;
    set({ isLoading: !hasCachedSchemaSnapshot });
    get().setMetadataNodeState(nodeKey, {
      status: hasCachedSchemaSnapshot ? "ready" : "loading",
      source: hasCachedSchemaSnapshot ? "cache" : "remote",
      message: hasCachedSchemaSnapshot
        ? "Refreshing schemas in background"
        : "Refreshing schemas",
    });
    console.log("Store: Refreshing schemas from Driver...");
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "introspection",
      title: `Refresh ${activeConn?.name || "data source"}`,
      detail: "Schemas",
    });
    try {
      const schemas = await schemaService.refreshSchemas(connectionId);
      if (!isMetadataRequestCurrent(request)) {
        taskStore.cancelTask(taskId, "Metadata context changed");
        return;
      }
      console.log("Store: loadSchemas Refresh result:", schemas);

      if (schemas) {
        // Optimistically update UI first
        const currentSchema = get().currentSchema;
        const schemaToSelect = selectPreferredNamespace(activeDriver, schemas, [
          currentSchema,
          configDefault,
          savedDefault,
        ]);
        await activateBackendSchema(connectionId, schemaToSelect);
        if (!isMetadataRequestCurrent(request)) {
          taskStore.cancelTask(taskId, "Metadata context changed");
          return;
        }

        set({
          schemas: schemas,
          currentSchema: schemaToSelect || null,
          defaultSchema: savedDefault,
          isLoading: false,
          selectedTable: null,
          collections:
            activeDriver === "redis" && schemaToSelect === currentSchema
              ? get().collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
              : [],
          tables: currentSchema && schemas.includes(currentSchema) ? get().tables : [],
        });
        set((state) => ({
          connectionSnapshots: {
            ...state.connectionSnapshots,
            [getConnectionSnapshotKey(connectionId, activeDriver)]: {
              schemas,
              tables: state.tables,
              collections:
                activeDriver === "redis"
                  ? state.collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
                  : state.collections,
              collectionNextCursor: state.collectionNextCursor,
              collectionTotal: state.collectionTotal,
              collectionFilter: state.collectionFilter,
              functions: state.functions,
              pinnedTables: state.pinnedTables,
              currentSchema: schemaToSelect || null,
              defaultSchema: savedDefault,
              selectedTable: state.selectedTable,
              lastLoadedConnectionId: loadKey,
              lastLoadedObjectKey: state.lastLoadedObjectKey,
              metadataVersion: state.metadataVersion,
            },
          },
        }));
        get().setMetadataNodeState(nodeKey, {
          status: "ready",
          source: "remote",
          message: `${schemas.length.toLocaleString()} ${schemas.length === 1 ? "schema" : "schemas"}`,
        });

        // Save to MetaStore in background
        const newResources: Resource[] = schemas.map((name) => ({
          id: getSchemaResourceId(connectionId, name, activeDriver),
          connection_id: connectionId,
          kind: "DATABASE",
          name: name,
          metadata: { driver: activeDriver },
          last_updated: Date.now(),
        }));

        try {
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
          await storeService.replaceResources(
            connectionId,
            undefined,
            "DATABASE",
            newResources,
            request.projectId
          );
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
          await storeService.saveResources([
            createCacheMarker(
              connectionId,
              undefined,
              SCHEMA_CACHE_KIND,
              activeDriver
            ),
          ], request.projectId);
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
        } catch (err) {
          console.warn("Store: Failed to cache schemas to MetaStore", err);
        }
      }
      if (!isMetadataRequestCurrent(request)) {
        taskStore.cancelTask(taskId, "Metadata context changed");
        return;
      }
      taskStore.finishTask(taskId, `${schemas.length.toLocaleString()} schemas`);
    } catch (e) {
      if (!isMetadataRequestCurrent(request)) {
        taskStore.cancelTask(taskId, "Metadata context changed");
        return;
      }
      const errorMessage = e instanceof Error ? e.message : String(e);
      taskStore.failTask(taskId, errorMessage);
      const hasCachedSchemas =
        hasCachedSchemaSnapshot || get().schemas.length > 0;
      get().setMetadataNodeState(nodeKey, {
        status: hasCachedSchemas ? "stale" : "error",
        source: hasCachedSchemas ? "cache" : "remote",
        message: hasCachedSchemas
          ? `Refresh failed; showing cached schemas. ${errorMessage}`
          : errorMessage,
      });
      console.warn("Store: loadSchemas refresh failed", e);
      // A failed background refresh never hides or clears usable cache.
      set((state) => ({
        isLoading: false,
        ...(state.schemas.length === 0 ? { schemas: [] } : {}),
      }));
    }
    } finally {
      if (schemaLoadsInFlight.get(requestKey) === loadFlight) {
        schemaLoadsInFlight.delete(requestKey);
      }
      completeLoad();
    }
  },

  loadTables: async (connectionId: string, schema: string, force = false) => {
    const request = captureMetadataRequest(connectionId);
    if (!isMetadataRequestCurrent(request)) return;
    const requestKey = metadataRequestKey(request, "tables", schema);
    const pendingLoad = tableLoadsInFlight.get(requestKey);
    if (pendingLoad) {
      await pendingLoad.promise;
      if (
        force &&
        !pendingLoad.force &&
        isMetadataRequestCurrent(request) &&
        get().currentSchema === schema
      ) {
        await get().loadTables(connectionId, schema, true);
      }
      return;
    }
    let completeLoad = () => {};
    const loadCompletion = new Promise<void>((resolve) => {
      completeLoad = resolve;
    });
    const loadFlight: MetadataLoadFlight = {
      force,
      promise: loadCompletion,
    };
    tableLoadsInFlight.set(requestKey, loadFlight);

    try {
    console.log("Store: loadTables called (MetaStore aware)", {
      connectionId,
      schema,
      force,
    });
    const activeDriver = getConnectionDriver(connectionId);
    const nodeKey = getSchemaMetadataNodeKey(connectionId, activeDriver, schema);
    const objectLoadKey = getObjectLoadKey(
      connectionId,
      activeDriver,
      schema,
      "tables"
    );
    const { lastLoadedObjectKey, currentSchema } = get();
    if (
      !force &&
      lastLoadedObjectKey === objectLoadKey &&
      currentSchema === schema
    ) {
      console.log("Store: loadTables skipped (cached in state)");
      return;
    }

    // Load pinned tables for this context
    const pinKey = getPinnedTablesKey(connectionId, schema, activeDriver);
    const savedPins = JSON.parse(readStorageItem(pinKey) || "[]");
    set({ pinnedTables: savedPins });

    // Parent ID for tables is scoped by connection + driver + schema.
    const schemaResourceId = getSchemaResourceId(
      connectionId,
      schema,
      activeDriver
    );

    let hasCachedTableSnapshot = false;

    // 1. Try MetaStore Cache First
    try {
      const cachedResources = await storeService.getResources(
        connectionId,
        schemaResourceId,
        request.projectId
      );
      if (!isMetadataRequestCurrent(request)) return;

      const hasCachedTableGroup = hasCacheMarker(
        cachedResources,
        TABLE_CACHE_KIND,
        activeDriver
      );

      if (cachedResources.length > 0 || hasCachedTableGroup) {
        const cachedTables = resourcesToTables(
          cachedResources,
          schema,
          activeDriver
        );

        if (cachedTables.length === 0 && !hasCachedTableGroup) {
          throw new Error("Table cache is stale for active driver");
        }

        hasCachedTableSnapshot = true;
        console.log("Store: Loaded tables from MetaStore", cachedTables.length);
        get().setMetadataNodeState(nodeKey, {
          status: "ready",
          source: "cache",
          message: `${cachedTables.length.toLocaleString()} ${cachedTables.length === 1 ? "table" : "tables"} from cache`,
        });
        set((state) => {
          const objectKey = getObjectSnapshotKey(connectionId, activeDriver, schema);
          const existingSnapshot = state.objectSnapshots[objectKey];

          return {
            tables: cachedTables,
            isLoading: false,
            lastLoadedObjectKey: objectLoadKey,
            objectSnapshots: {
              ...state.objectSnapshots,
              [objectKey]: {
                tables: cachedTables,
                collections:
                  existingSnapshot?.collections ??
                  (state.currentSchema === schema ? state.collections : []),
                functions:
                  existingSnapshot?.functions ??
                  (state.currentSchema === schema ? state.functions : []),
                pinnedTables: savedPins,
                selectedTable:
                  existingSnapshot?.selectedTable ??
                  (state.currentSchema === schema ? state.selectedTable : null),
                lastLoadedObjectKey: objectLoadKey,
              },
            },
          };
        });
        if (!force) return;
      }
    } catch (e) {
      if (!isMetadataRequestCurrent(request)) return;
      console.warn("Store: Table MetaStore miss or error", e);
    }

    // 2. Refresh from Driver & Update MetaStore
    if (!isMetadataRequestCurrent(request)) return;
    const hasUsableTables =
      hasCachedTableSnapshot || get().tables.length > 0;
    set({ isLoading: !hasUsableTables });
    get().setMetadataNodeState(nodeKey, {
      status: hasUsableTables ? "ready" : "loading",
      source: hasUsableTables ? "cache" : "remote",
      message: hasUsableTables
        ? `Refreshing ${schema} in background`
        : `Refreshing ${schema}`,
    });
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "introspection",
      title: `Refresh ${schema}`,
      detail: "Tables",
    });
    try {
      const tables = await schemaService.refreshTables(connectionId, schema);
      if (!isMetadataRequestCurrent(request)) {
        taskStore.cancelTask(taskId, "Metadata context changed");
        return;
      }
      set((state) => {
        const objectKey = getObjectSnapshotKey(connectionId, activeDriver, schema);
        const existingSnapshot = state.objectSnapshots[objectKey];

        return {
          tables: tables,
          isLoading: false,
          lastLoadedObjectKey: objectLoadKey,
          metadataVersion: state.metadataVersion + 1,
          objectSnapshots: {
            ...state.objectSnapshots,
            [objectKey]: {
              tables,
              collections:
                existingSnapshot?.collections ??
                (state.currentSchema === schema ? state.collections : []),
              functions:
                existingSnapshot?.functions ??
                (state.currentSchema === schema ? state.functions : []),
              pinnedTables: savedPins,
              selectedTable:
                existingSnapshot?.selectedTable ??
                (state.currentSchema === schema ? state.selectedTable : null),
              lastLoadedObjectKey: objectLoadKey,
            },
          },
        };
      });
      get().setMetadataNodeState(nodeKey, {
        status: "ready",
        source: "remote",
        message: `${tables.length.toLocaleString()} ${tables.length === 1 ? "table" : "tables"}`,
      });

      // Save to MetaStore in background
      const newResources: Resource[] = tables.map((t) => ({
        id: `${schemaResourceId}:${t.name}`,
        connection_id: connectionId,
        parent_id: schemaResourceId,
        kind: "TABLE",
        name: t.name,
        metadata: { driver: activeDriver, type: t.type, comment: t.comment },
        last_updated: Date.now(),
      }));

      try {
        if (!isMetadataRequestCurrent(request)) {
          taskStore.cancelTask(taskId, "Metadata context changed");
          return;
        }
        await storeService.replaceResources(
          connectionId,
          schemaResourceId,
          "TABLE",
          newResources,
          request.projectId
        );
        if (!isMetadataRequestCurrent(request)) {
          taskStore.cancelTask(taskId, "Metadata context changed");
          return;
        }
        await storeService.saveResources(
          [
            createCacheMarker(
              connectionId,
              schemaResourceId,
              TABLE_CACHE_KIND,
              activeDriver
            ),
          ],
          request.projectId
        );
        if (!isMetadataRequestCurrent(request)) {
          taskStore.cancelTask(taskId, "Metadata context changed");
          return;
        }
      } catch (err) {
        console.warn("Store: Failed to cache tables to MetaStore", err);
      }
      if (!isMetadataRequestCurrent(request)) {
        taskStore.cancelTask(taskId, "Metadata context changed");
        return;
      }
      taskStore.finishTask(taskId, `${tables.length.toLocaleString()} tables`);
    } catch (e) {
      if (!isMetadataRequestCurrent(request)) {
        taskStore.cancelTask(taskId, "Metadata context changed");
        return;
      }
      const errorMessage = e instanceof Error ? e.message : String(e);
      taskStore.failTask(taskId, errorMessage);
      const hasCachedTables =
        hasCachedTableSnapshot || get().tables.length > 0;
      get().setMetadataNodeState(nodeKey, {
        status: hasCachedTables ? "stale" : "error",
        source: hasCachedTables ? "cache" : "remote",
        message: hasCachedTables
          ? `Refresh failed; showing cached tables. ${errorMessage}`
          : errorMessage,
      });
      console.warn("Store: loadTables refresh failed", e);
      set((state) => ({
        isLoading: false,
        ...(state.tables.length === 0 ? { tables: [] } : {}),
      }));
    }
    } finally {
      if (tableLoadsInFlight.get(requestKey) === loadFlight) {
        tableLoadsInFlight.delete(requestKey);
      }
      completeLoad();
    }
  },

  loadFunctions: async (connectionId: string, schema: string, force = false) => {
    if (!connectionId || !schema) {
      set({ functions: [], isFunctionsLoading: false });
      return;
    }
    const request = captureMetadataRequest(connectionId);
    if (!isMetadataRequestCurrent(request)) return;

    const activeDriver = getConnectionDriver(connectionId);
    const objectLoadKey = getObjectLoadKey(
      connectionId,
      activeDriver,
      schema,
      "functions"
    );
    const { lastLoadedObjectKey, currentSchema } = get();
    if (
      !force &&
      lastLoadedObjectKey === objectLoadKey &&
      currentSchema === schema
    ) {
      console.log("Store: loadFunctions skipped (cached in state)");
      return;
    }

    const schemaResourceId = getSchemaResourceId(
      connectionId,
      schema,
      activeDriver
    );

    try {
      const cachedResources = await storeService.getResources(
        connectionId,
        schemaResourceId,
        request.projectId
      );
      if (!isMetadataRequestCurrent(request)) return;
      const hasCachedFunctionGroup = hasCacheMarker(
        cachedResources,
        FUNCTION_CACHE_KIND,
        activeDriver
      );

      if (
        !force &&
        (cachedResources.length > 0 || hasCachedFunctionGroup)
      ) {
        const cachedFunctions = resourcesToFunctions(
          cachedResources,
          activeDriver
        );

        if (cachedFunctions.length === 0 && !hasCachedFunctionGroup) {
          throw new Error("Function cache is stale for active driver");
        }

        const currentSchema = get().currentSchema;
        if (!isMetadataRequestCurrent(request) || currentSchema !== schema) {
          return;
        }

        set((state) => {
          const objectKey = getObjectSnapshotKey(connectionId, activeDriver, schema);
          const existingSnapshot = state.objectSnapshots[objectKey];

          return {
            functions: cachedFunctions,
            isFunctionsLoading: false,
            lastLoadedObjectKey: objectLoadKey,
            objectSnapshots: {
              ...state.objectSnapshots,
              [objectKey]: {
                tables:
                  existingSnapshot?.tables ??
                  (state.currentSchema === schema ? state.tables : []),
                collections:
                  existingSnapshot?.collections ??
                  (state.currentSchema === schema ? state.collections : []),
                functions: cachedFunctions,
                pinnedTables:
                  existingSnapshot?.pinnedTables ??
                  (state.currentSchema === schema ? state.pinnedTables : []),
                selectedTable:
                  existingSnapshot?.selectedTable ??
                  (state.currentSchema === schema ? state.selectedTable : null),
                lastLoadedObjectKey: objectLoadKey,
              },
            },
          };
        });
        return;
      }
    } catch (e) {
      if (!isMetadataRequestCurrent(request)) return;
      console.warn("Store: Function MetaStore miss or error", e);
    }

    if (!isMetadataRequestCurrent(request)) return;
    set({ isFunctionsLoading: true });
    try {
      const functions = await schemaService.getFunctions(connectionId, schema);
      const currentSchema = get().currentSchema;
      if (!isMetadataRequestCurrent(request) || currentSchema !== schema) {
        return;
      }
      set((state) => {
        const objectKey = getObjectSnapshotKey(connectionId, activeDriver, schema);
        const existingSnapshot = state.objectSnapshots[objectKey];

        return {
          functions,
          isFunctionsLoading: false,
          lastLoadedObjectKey: objectLoadKey,
          objectSnapshots: {
            ...state.objectSnapshots,
            [objectKey]: {
              tables:
                existingSnapshot?.tables ??
                (state.currentSchema === schema ? state.tables : []),
              collections:
                existingSnapshot?.collections ??
                (state.currentSchema === schema ? state.collections : []),
              functions,
              pinnedTables:
                existingSnapshot?.pinnedTables ??
                (state.currentSchema === schema ? state.pinnedTables : []),
              selectedTable:
                existingSnapshot?.selectedTable ??
                (state.currentSchema === schema ? state.selectedTable : null),
              lastLoadedObjectKey: objectLoadKey,
            },
          },
        };
      });

      const newResources: Resource[] = functions.map((routine) => ({
        id: `${schemaResourceId}:${routine.name}`,
        connection_id: connectionId,
        parent_id: schemaResourceId,
        kind: "FUNCTION",
        name: routine.name,
        metadata: {
          driver: activeDriver,
          routine_type: routine.routine_type ?? null,
          parameters: routine.parameters ?? [],
          return_type: routine.return_type ?? "",
          description: routine.description ?? null,
        },
        last_updated: Date.now(),
      }));

      try {
        if (!isMetadataRequestCurrent(request)) return;
        await storeService.replaceResources(
          connectionId,
          schemaResourceId,
          "FUNCTION",
          newResources,
          request.projectId
        );
        if (!isMetadataRequestCurrent(request)) return;
        await storeService.saveResources(
          [
            createCacheMarker(
              connectionId,
              schemaResourceId,
              FUNCTION_CACHE_KIND,
              activeDriver
            ),
          ],
          request.projectId
        );
      } catch (err) {
        if (!isMetadataRequestCurrent(request)) return;
        console.warn("Store: Failed to cache functions to MetaStore", err);
      }
    } catch (e) {
      if (!isMetadataRequestCurrent(request)) return;
      console.warn("Store: loadFunctions failed", e);
      const currentSchema = get().currentSchema;
      if (currentSchema !== schema) {
        return;
      }
      set({ functions: [], isFunctionsLoading: false });
    }
  },

  loadCollections: async (
    connectionId: string,
    namespace: string,
    force = false,
    filter = ""
  ) => {
    if (!connectionId) {
      set({ collections: [], isCollectionsLoading: false });
      return;
    }
    const request = captureMetadataRequest(connectionId);
    if (!isMetadataRequestCurrent(request)) return;

    const activeDriver = getConnectionDriver(connectionId);
    const normalizedFilter =
      activeDriver === "redis" ? filter.trim() : "";
    const objectLoadKey = getObjectLoadKey(
      connectionId,
      activeDriver,
      namespace || "",
      activeDriver === "redis"
        ? `collections:${normalizedFilter}`
        : "collections"
    );
    const {
      lastLoadedObjectKey,
      currentSchema: activeNamespace,
    } = get();
    if (
      !force &&
      lastLoadedObjectKey === objectLoadKey &&
      (activeNamespace || "") === namespace
    ) {
      console.log("Store: loadCollections skipped (cached in state)");
      return;
    }
    const schemaResourceId = getSchemaResourceId(
      connectionId,
      namespace || "",
      activeDriver
    );
    if (
      activeDriver === "redis" &&
      get().collectionLoadingKey === objectLoadKey
    ) {
      return;
    }
    set({
      isCollectionsLoading: true,
      ...(activeDriver === "redis"
        ? { collectionLoadingKey: objectLoadKey }
        : {}),
    });

    if (activeDriver === "redis") {
      try {
        const page = await schemaService.getCollectionsPage(
          connectionId,
          namespace || "",
          null,
          REDIS_KEY_PAGE_SIZE,
          normalizedFilter || null
        );
        if (!isMetadataRequestCurrent(request)) return;
        const currentSchema = get().currentSchema;
        if (
          get().collectionLoadingKey !== objectLoadKey ||
          currentSchema !== namespace
        ) {
          set((state) =>
            state.collectionLoadingKey === objectLoadKey
              ? { isCollectionsLoading: false, collectionLoadingKey: null }
              : {}
          );
          return;
        }
        set({
          collections: page.items,
          collectionNextCursor: page.nextCursor || null,
          collectionTotal: page.total ?? null,
          collectionLoadingKey: null,
          collectionFilter: normalizedFilter,
          isCollectionsLoading: false,
          lastLoadedObjectKey: objectLoadKey,
        });
        if (!normalizedFilter && typeof page.total === "number") {
          try {
            await storeService.saveResources(
              [
                {
                  id: `${connectionId}:${activeDriver}:${namespace || "0"}:${REDIS_KEY_COUNT_CACHE_KIND}`,
                  connection_id: connectionId,
                  kind: REDIS_KEY_COUNT_CACHE_KIND,
                  name: namespace || "0",
                  metadata: {
                    driver: activeDriver,
                    total: page.total,
                    loadedCount: page.items.length,
                  },
                  last_updated: Date.now(),
                },
              ],
              request.projectId
            );
          } catch (cacheError) {
            console.warn("Store: Failed to cache Redis key count", cacheError);
          }
        }
      } catch (error) {
        if (!isMetadataRequestCurrent(request)) return;
        console.warn("Store: Redis key page failed", error);
        set((state) =>
          state.collectionLoadingKey === objectLoadKey
            ? {
                collections: [],
                collectionNextCursor: null,
                collectionTotal: null,
                collectionLoadingKey: null,
                collectionFilter: normalizedFilter,
                isCollectionsLoading: false,
              }
            : {}
        );
      }
      return;
    }

    try {
      const cachedResources = await storeService.getResources(
        connectionId,
        schemaResourceId,
        request.projectId
      );
      if (!isMetadataRequestCurrent(request)) return;

      const hasCachedCollectionGroup = hasCacheMarker(
        cachedResources,
        COLLECTION_CACHE_KIND,
        activeDriver
      );

      if (
        !force &&
        (cachedResources.length > 0 || hasCachedCollectionGroup)
      ) {
        const cachedCollections = resourcesToCollections(
          cachedResources,
          namespace,
          activeDriver
        );

        if (cachedCollections.length === 0 && !hasCachedCollectionGroup) {
          throw new Error("Collection cache is stale for active driver");
        }
        if (activeDriver === "redis" && cachedCollections.length === 0) {
          throw new Error("Redis key cache is empty; refresh from the server");
        }

        const currentSchema = get().currentSchema;
        if (!isMetadataRequestCurrent(request) || currentSchema !== namespace) {
          return;
        }

        set((state) => {
          const objectKey = getObjectSnapshotKey(
            connectionId,
            activeDriver,
            namespace || ""
          );
          const existingSnapshot = state.objectSnapshots[objectKey];

          return {
            collections: cachedCollections,
            isCollectionsLoading: false,
            lastLoadedObjectKey: objectLoadKey,
            objectSnapshots: {
              ...state.objectSnapshots,
              [objectKey]: {
                tables:
                  existingSnapshot?.tables ??
                  ((state.currentSchema || "") === namespace ? state.tables : []),
                collections: cachedCollections,
                functions:
                  existingSnapshot?.functions ??
                  ((state.currentSchema || "") === namespace ? state.functions : []),
                pinnedTables:
                  existingSnapshot?.pinnedTables ??
                  ((state.currentSchema || "") === namespace
                    ? state.pinnedTables
                    : []),
                selectedTable:
                  existingSnapshot?.selectedTable ??
                  ((state.currentSchema || "") === namespace
                    ? state.selectedTable
                    : null),
                lastLoadedObjectKey: objectLoadKey,
              },
            },
          };
        });
        return;
      }
    } catch (e) {
      if (!isMetadataRequestCurrent(request)) return;
      console.warn("Store: Collection MetaStore miss or error", e);
    }

    if (!isMetadataRequestCurrent(request)) return;
    try {
      const collections = await schemaService.getCollections(
        connectionId,
        namespace || ""
      );
      const currentSchema = get().currentSchema;
      if (!isMetadataRequestCurrent(request) || currentSchema !== namespace) {
        return;
      }
      set((state) => {
        const objectKey = getObjectSnapshotKey(
          connectionId,
          activeDriver,
          namespace || ""
        );
        const existingSnapshot = state.objectSnapshots[objectKey];

        return {
          collections,
          isCollectionsLoading: false,
          lastLoadedObjectKey: objectLoadKey,
          metadataVersion: state.metadataVersion + 1,
          objectSnapshots: {
            ...state.objectSnapshots,
            [objectKey]: {
              tables:
                existingSnapshot?.tables ??
                ((state.currentSchema || "") === namespace ? state.tables : []),
              collections,
              functions:
                existingSnapshot?.functions ??
                ((state.currentSchema || "") === namespace ? state.functions : []),
              pinnedTables:
                existingSnapshot?.pinnedTables ??
                ((state.currentSchema || "") === namespace
                  ? state.pinnedTables
                  : []),
              selectedTable:
                existingSnapshot?.selectedTable ??
                ((state.currentSchema || "") === namespace
                  ? state.selectedTable
                  : null),
              lastLoadedObjectKey: objectLoadKey,
            },
          },
        };
      });

      const newResources: Resource[] = collections.map((collection) => ({
        id: `${schemaResourceId}:${collection.name}`,
        connection_id: connectionId,
        parent_id: schemaResourceId,
        kind: "COLLECTION",
        name: collection.name,
        metadata: {
          driver: activeDriver,
          namespace: collection.namespace ?? (namespace || null),
          type: collection.type ?? null,
          documentCount: collection.documentCount ?? null,
        },
        last_updated: Date.now(),
      }));

      try {
        if (!isMetadataRequestCurrent(request)) return;
        await storeService.replaceResources(
          connectionId,
          schemaResourceId,
          "COLLECTION",
          newResources,
          request.projectId
        );
        if (!isMetadataRequestCurrent(request)) return;
        await storeService.saveResources(
          [
            createCacheMarker(
              connectionId,
              schemaResourceId,
              COLLECTION_CACHE_KIND,
              activeDriver
            ),
          ],
          request.projectId
        );
      } catch (err) {
        if (!isMetadataRequestCurrent(request)) return;
        console.warn("Store: Failed to cache collections to MetaStore", err);
      }
    } catch (e) {
      if (!isMetadataRequestCurrent(request)) return;
      console.warn("Store: loadCollections failed", e);
      const currentSchema = get().currentSchema;
      if (currentSchema !== namespace) {
        return;
      }
      set({ collections: [], isCollectionsLoading: false });
    }
  },

  loadMoreCollections: async (connectionId: string, namespace: string) => {
    const request = captureMetadataRequest(connectionId);
    if (!isMetadataRequestCurrent(request)) return;
    const {
      collectionNextCursor,
      collectionFilter,
      isCollectionsLoading,
    } = get();
    if (!collectionNextCursor || isCollectionsLoading) return;
    const activeDriver = getConnectionDriver(connectionId);
    if (activeDriver !== "redis") return;

    set({ isCollectionsLoading: true });
    try {
      const page = await schemaService.getCollectionsPage(
        connectionId,
        namespace || "",
        collectionNextCursor,
        REDIS_KEY_PAGE_SIZE,
        collectionFilter || null
      );
      if (!isMetadataRequestCurrent(request)) return;
      if (
        get().collectionLoadingKey !== null ||
        get().collectionFilter !== collectionFilter ||
        get().currentSchema !== namespace
      ) {
        return;
      }
      set((state) => {
        const byName = new Map(
          state.collections.map((collection) => [collection.name, collection])
        );
        page.items.forEach((collection) => byName.set(collection.name, collection));
        const collections = Array.from(byName.values());
        return {
          collections:
            collections.length > MAX_REDIS_KEYS_IN_MEMORY
              ? collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
              : collections,
          collectionNextCursor: page.nextCursor || null,
          collectionTotal: page.total ?? state.collectionTotal,
          isCollectionsLoading: false,
        };
      });
    } catch (error) {
      if (!isMetadataRequestCurrent(request)) return;
      console.warn("Store: Failed to load more Redis keys", error);
      set({ isCollectionsLoading: false });
    }
  },

  bumpMetadataVersion: () => {
    set((state) => ({ metadataVersion: state.metadataVersion + 1 }));
  },

  togglePinTable: (tableName: string) => {
    const { activeConnectionId } = useConnectionStore.getState();
    const { currentSchema, pinnedTables } = get();
    if (!activeConnectionId || !currentSchema) return;
    const activeDriver = getConnectionDriver(activeConnectionId);

    const pinKey = getPinnedTablesKey(
      activeConnectionId,
      currentSchema,
      activeDriver
    );
    const isPinned = pinnedTables.includes(tableName);
    const newPinned = isPinned
      ? pinnedTables.filter((t) => t !== tableName)
      : [...pinnedTables, tableName];

    writeStorageItem(pinKey, JSON.stringify(newPinned));
    set({ pinnedTables: newPinned });
  },

  setCurrentSchema: async (schema: string) => {
    const { activeConnectionId } = useConnectionStore.getState();
    const request = activeConnectionId
      ? captureMetadataRequest(activeConnectionId)
      : null;
    if (request && !isMetadataRequestCurrent(request)) return;
    const activeDriver = activeConnectionId
      ? getConnectionDriver(activeConnectionId)
      : null;
    const currentState = get();
    const previous = {
      currentSchema: currentState.currentSchema,
      selectedTable: currentState.selectedTable,
      tables: currentState.tables,
      collections: currentState.collections,
      functions: currentState.functions,
      pinnedTables: currentState.pinnedTables,
      lastLoadedObjectKey: currentState.lastLoadedObjectKey,
      isCollectionsLoading: currentState.isCollectionsLoading,
      isFunctionsLoading: currentState.isFunctionsLoading,
      objectSnapshots: currentState.objectSnapshots,
    };
    let nextObjectSnapshots = currentState.objectSnapshots;

    if (activeConnectionId && currentState.currentSchema) {
      const previousObjectKey = getObjectSnapshotKey(
        activeConnectionId,
        activeDriver,
        currentState.currentSchema
      );
      nextObjectSnapshots = {
        ...nextObjectSnapshots,
        [previousObjectKey]: {
          tables: currentState.tables,
          collections:
            activeDriver === "redis" ? [] : currentState.collections,
          functions: currentState.functions,
          pinnedTables: currentState.pinnedTables,
          selectedTable: currentState.selectedTable,
          lastLoadedObjectKey: currentState.lastLoadedObjectKey,
        },
      };
    }

    let targetObjectSnapshot =
      activeDriver !== "redis" && activeConnectionId && schema
        ? nextObjectSnapshots[
            getObjectSnapshotKey(activeConnectionId, activeDriver, schema)
          ] ?? null
        : null;

    if (
      activeConnectionId &&
      schema &&
      activeDriver !== "redis" &&
      !targetObjectSnapshot
    ) {
      try {
        const schemaResourceId = getSchemaResourceId(
          activeConnectionId,
          schema,
          activeDriver
        );
        const cachedResources = await storeService.getResources(
          activeConnectionId,
          schemaResourceId,
          request?.projectId
        );
        if (request && !isMetadataRequestCurrent(request)) return;
        const cachedTables = resourcesToTables(
          cachedResources,
          schema,
          activeDriver
        );
        const cachedCollections =
          activeDriver === "redis"
            ? []
            : resourcesToCollections(cachedResources, schema, activeDriver);
        const cachedFunctions = resourcesToFunctions(
          cachedResources,
          activeDriver
        );
        const hasCachedTableGroup = hasCacheMarker(
          cachedResources,
          TABLE_CACHE_KIND,
          activeDriver
        );
        const hasCachedCollectionGroup =
          activeDriver !== "redis" &&
          hasCacheMarker(
            cachedResources,
            COLLECTION_CACHE_KIND,
            activeDriver
          );
        const hasCachedFunctionGroup = hasCacheMarker(
          cachedResources,
          FUNCTION_CACHE_KIND,
          activeDriver
        );
        const hasAnyCachedObject =
          cachedTables.length > 0 ||
          cachedCollections.length > 0 ||
          cachedFunctions.length > 0 ||
          hasCachedTableGroup ||
          hasCachedCollectionGroup ||
          hasCachedFunctionGroup;

        if (hasAnyCachedObject) {
          const pinKey = getPinnedTablesKey(
            activeConnectionId,
            schema,
            activeDriver
          );
          const parsedPins = JSON.parse(readStorageItem(pinKey) || "[]");
          const savedPins = Array.isArray(parsedPins)
            ? parsedPins.filter((value): value is string => typeof value === "string")
            : [];
          const lastLoadedObjectKey =
            cachedTables.length > 0 || hasCachedTableGroup
              ? getObjectLoadKey(activeConnectionId, activeDriver, schema, "tables")
              : cachedCollections.length > 0 || hasCachedCollectionGroup
                ? getObjectLoadKey(
                    activeConnectionId,
                    activeDriver,
                    schema,
                    "collections"
                  )
                : cachedFunctions.length > 0 || hasCachedFunctionGroup
                  ? getObjectLoadKey(
                      activeConnectionId,
                      activeDriver,
                      schema,
                      "functions"
                    )
                  : currentState.lastLoadedObjectKey;
          const objectKey = getObjectSnapshotKey(
            activeConnectionId,
            activeDriver,
            schema
          );

          targetObjectSnapshot = {
            tables: cachedTables,
            collections: cachedCollections,
            functions: cachedFunctions,
            pinnedTables: savedPins,
            selectedTable: null,
            lastLoadedObjectKey,
          };
          nextObjectSnapshots = {
            ...nextObjectSnapshots,
            [objectKey]: targetObjectSnapshot,
          };
        }
      } catch (error) {
        if (request && !isMetadataRequestCurrent(request)) return;
        console.warn("Store: Failed to hydrate schema objects from MetaStore", error);
      }
    }

    if (request && !isMetadataRequestCurrent(request)) return;
    set({
      currentSchema: schema,
      selectedTable: targetObjectSnapshot?.selectedTable ?? null,
      tables: targetObjectSnapshot?.tables ?? [],
      collections: targetObjectSnapshot?.collections ?? [],
      collectionNextCursor: null,
      collectionTotal: null,
      collectionLoadingKey: null,
      collectionFilter: "",
      functions: targetObjectSnapshot?.functions ?? [],
      pinnedTables: targetObjectSnapshot?.pinnedTables ?? [],
      lastLoadedObjectKey:
        targetObjectSnapshot?.lastLoadedObjectKey ??
        currentState.lastLoadedObjectKey,
      isCollectionsLoading: false,
      isFunctionsLoading: false,
      objectSnapshots: nextObjectSnapshots,
    });

    if (activeConnectionId && schema) {
      try {
        await schemaService.setCurrentSchema(activeConnectionId, schema);
        if (request && !isMetadataRequestCurrent(request)) return;
      } catch (error) {
        if (request && !isMetadataRequestCurrent(request)) return;
        set(previous);
        throw error;
      }
    }
  },

  setDefaultSchema: async (schema: string) => {
    console.log("Store: setDefaultSchema called with:", schema);
    const { activeConnectionId } = useConnectionStore.getState();
    if (activeConnectionId) {
      await get().setCurrentSchema(schema);
      writeStorageItem(
        getDefaultSchemaKey(activeConnectionId, getConnectionDriver(activeConnectionId)),
        schema
      );
    } else {
      set({ currentSchema: schema });
    }
    set({ defaultSchema: schema });
    console.log("Store: setDefaultSchema - currentSchema updated to:", schema);
  },

  selectTable: (table: string | null) => {
    set({ selectedTable: table });
  },
}));
