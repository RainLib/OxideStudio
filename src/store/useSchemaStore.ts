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
import { selectPreferredNamespace } from "@/lib/databaseDialect";

interface SchemaState {
  schemas: string[];
  tables: TableInfo[];
  collections: CollectionInfo[];
  functions: FunctionInfo[];
  pinnedTables: string[];
  currentSchema: string | null;
  defaultSchema: string | null; // User's preferred default
  selectedTable: string | null;
  lastLoadedConnectionId: string | null; // Guard for duplicate calls
  isLoading: boolean;
  isCollectionsLoading: boolean;
  isFunctionsLoading: boolean;
  metadataVersion: number;

  loadSchemas: (connectionId: string, force?: boolean) => Promise<void>;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean
  ) => Promise<void>;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean
  ) => Promise<void>;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean
  ) => Promise<void>;
  bumpMetadataVersion: () => void;
  togglePinTable: (tableName: string) => void;
  setCurrentSchema: (schema: string) => Promise<void>;
  setDefaultSchema: (schema: string) => void; // Persist user's choice
  selectTable: (table: string | null) => void;
  reset: () => void;
}

const LEGACY_STORAGE_KEY = "oxide-studio-default-schema";
const getDefaultSchemaKey = (
  connId: string,
  driver: string | null | undefined
) => `oxide-studio-default-schema:${connId}:${driver || "unknown"}`;
const getPinnedTablesKey = (
  connId: string,
  schema: string,
  driver: string | null | undefined
) => `oxide-studio-pinned-tables:${connId}:${driver || "unknown"}:${schema}`;
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
const resourceMatchesDriver = (
  resource: Resource,
  driver: string | null | undefined
) => Boolean(driver && resource.metadata?.driver === driver);
const getSavedDefaultSchema = (
  connectionId: string,
  driver: string | null | undefined
) =>
  localStorage.getItem(getDefaultSchemaKey(connectionId, driver)) ||
  localStorage.getItem(LEGACY_STORAGE_KEY);

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
  functions: [],
  pinnedTables: [],
  currentSchema: null,
  defaultSchema: null,
  selectedTable: null,
  lastLoadedConnectionId: null,
  isLoading: false,
  isCollectionsLoading: false,
  isFunctionsLoading: false,
  metadataVersion: 0,

  reset: () => {
    set({
      schemas: [],
      tables: [],
      collections: [],
      functions: [],
      pinnedTables: [],
      currentSchema: null,
      selectedTable: null,
      lastLoadedConnectionId: null,
      isLoading: false,
      isCollectionsLoading: false,
      isFunctionsLoading: false,
      metadataVersion: 0,
    });
  },

  loadSchemas: async (connectionId: string, force = false) => {
    const { lastLoadedConnectionId, isLoading } = get();
    const connections = useConnectionStore.getState().connections;
    const activeConn = connections.find((c) => c.id === connectionId);
    const activeDriver = activeConn?.driver || null;
    const configDefault = activeConn?.database;
    const savedDefault = getSavedDefaultSchema(connectionId, activeDriver);
    const loadKey = `${connectionId}:${activeDriver || "unknown"}`;

    // Prevent duplicate calls if we're already loading or if the connection hasn't changed (unless forced)
    if ((isLoading || lastLoadedConnectionId === loadKey) && !force) {
      console.log("Store: loadSchemas skipped (redundant)");
      return;
    }

    console.log(
      "Store: loadSchemas called (MetaStore aware) for:",
      connectionId
    );
    set({ lastLoadedConnectionId: loadKey }); // Mark as loading for this connection+driver to prevent re-entry

    // 1. Try MetaStore Cache First (SQLite)
    try {
      // Fetch DB resources (parent_id = null)
      const cachedResources = await storeService.getResources(connectionId);
      const cachedSchemas = cachedResources
        .filter((resource) => resourceMatchesDriver(resource, activeDriver))
        .map((r) => r.name);

      if (cachedSchemas && cachedSchemas.length > 0) {
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
        const schemaActivated = await activateBackendSchema(
          connectionId,
          schemaToSelect
        );
        if (!schemaActivated && !force) {
          throw new Error("Cached schema could not be activated on backend");
        }

        set({
          schemas: cachedSchemas,
          currentSchema: schemaToSelect,
          defaultSchema: savedDefault,
          isLoading: false, // Show cached data immediately
        });

        // If we found data, we rely on user to trigger explicit refresh if needed
        // OR we could background refresh. User requirement: "Update only when triggered".
        // So we STOP here if cache hit.
        if (!force) return;
      }
    } catch (e) {
      console.warn("Store: MetaStore cache miss or error", e);
    }

    // 2. Refresh from Driver & Update MetaStore (Only if cache miss or forced)
    set({ isLoading: true });
    console.log("Store: Refreshing schemas from Driver...");
    try {
      const schemas = await schemaService.refreshSchemas(connectionId);
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

        set({
          schemas: schemas,
          currentSchema: schemaToSelect || null,
          defaultSchema: savedDefault,
          isLoading: false,
          selectedTable: null,
          collections: [],
          tables: currentSchema && schemas.includes(currentSchema) ? get().tables : [],
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

        storeService
          .replaceResources(connectionId, undefined, "DATABASE", newResources)
          .catch((err) => {
            console.warn("Store: Failed to cache schemas to MetaStore", err);
          });
      }
    } catch (e) {
      console.warn("Store: loadSchemas refresh failed", e);
      // If we didn't have cache, stop loading
      if (get().schemas.length === 0) {
        set({ schemas: [], isLoading: false });
      }
    }
  },

  loadTables: async (connectionId: string, schema: string, force = false) => {
    console.log("Store: loadTables called (MetaStore aware)", {
      connectionId,
      schema,
      force,
    });
    const activeDriver = getConnectionDriver(connectionId);

    // Load pinned tables for this context
    const pinKey = getPinnedTablesKey(connectionId, schema, activeDriver);
    const savedPins = JSON.parse(localStorage.getItem(pinKey) || "[]");
    set({ pinnedTables: savedPins });

    // Parent ID for tables is scoped by connection + driver + schema.
    const schemaResourceId = getSchemaResourceId(
      connectionId,
      schema,
      activeDriver
    );

    // 1. Try MetaStore Cache First
    try {
      const cachedResources = await storeService.getResources(
        connectionId,
        schemaResourceId
      );

      if (cachedResources && cachedResources.length > 0 && !force) {
        const cachedTables: TableInfo[] = cachedResources
          .filter((resource) => resourceMatchesDriver(resource, activeDriver))
          .map((r) => ({
            name: r.name,
            schema: schema,
            type: r.metadata?.type,
            comment: r.metadata?.comment,
          }));

        if (cachedTables.length === 0) {
          throw new Error("Table cache is stale for active driver");
        }

        console.log("Store: Loaded tables from MetaStore", cachedTables.length);
        set({ tables: cachedTables, isLoading: false });
        return;
      }
    } catch (e) {
      console.warn("Store: Table MetaStore miss or error", e);
    }

    // 2. Refresh from Driver & Update MetaStore
    set({ isLoading: true });
    try {
      const tables = await schemaService.refreshTables(connectionId, schema);
      set((state) => ({
        tables: tables,
        isLoading: false,
        metadataVersion: state.metadataVersion + 1,
      }));

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

      storeService
        .replaceResources(connectionId, schemaResourceId, "TABLE", newResources)
        .catch((err) => {
          console.warn("Store: Failed to cache tables to MetaStore", err);
        });
    } catch (e) {
      console.warn("Store: loadTables refresh failed", e);
      if (get().tables.length === 0) {
        set({ tables: [], isLoading: false });
      }
    }
  },

  loadFunctions: async (
    connectionId: string,
    schema: string,
    _force = false
  ) => {
    if (!connectionId || !schema) {
      set({ functions: [], isFunctionsLoading: false });
      return;
    }

    set({ isFunctionsLoading: true });
    try {
      const functions = await schemaService.getFunctions(connectionId, schema);
      const activeConnectionId = useConnectionStore.getState().activeConnectionId;
      const currentSchema = get().currentSchema;
      if (activeConnectionId !== connectionId || currentSchema !== schema) {
        return;
      }
      set({ functions, isFunctionsLoading: false });
    } catch (e) {
      console.warn("Store: loadFunctions failed", e);
      const activeConnectionId = useConnectionStore.getState().activeConnectionId;
      const currentSchema = get().currentSchema;
      if (activeConnectionId !== connectionId || currentSchema !== schema) {
        return;
      }
      set({ functions: [], isFunctionsLoading: false });
    }
  },

  loadCollections: async (
    connectionId: string,
    namespace: string,
    force = false
  ) => {
    if (!connectionId) {
      set({ collections: [], isCollectionsLoading: false });
      return;
    }

    const activeDriver = getConnectionDriver(connectionId);
    const schemaResourceId = getSchemaResourceId(
      connectionId,
      namespace || "",
      activeDriver
    );
    set({ isCollectionsLoading: true });

    try {
      const cachedResources = await storeService.getResources(
        connectionId,
        schemaResourceId
      );

      if (cachedResources && cachedResources.length > 0 && !force) {
        const cachedCollections: CollectionInfo[] = cachedResources
          .filter((resource) => resourceMatchesDriver(resource, activeDriver))
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

        if (cachedCollections.length === 0) {
          throw new Error("Collection cache is stale for active driver");
        }

        const activeConnectionId =
          useConnectionStore.getState().activeConnectionId;
        const currentSchema = get().currentSchema;
        if (activeConnectionId !== connectionId || currentSchema !== namespace) {
          return;
        }

        set({ collections: cachedCollections, isCollectionsLoading: false });
        return;
      }
    } catch (e) {
      console.warn("Store: Collection MetaStore miss or error", e);
    }

    try {
      const collections = await schemaService.getCollections(
        connectionId,
        namespace || ""
      );
      const activeConnectionId = useConnectionStore.getState().activeConnectionId;
      const currentSchema = get().currentSchema;
      if (activeConnectionId !== connectionId || currentSchema !== namespace) {
        return;
      }
      set((state) => ({
        collections,
        isCollectionsLoading: false,
        metadataVersion: state.metadataVersion + 1,
      }));

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

      storeService
        .replaceResources(
          connectionId,
          schemaResourceId,
          "COLLECTION",
          newResources
        )
        .catch((err) => {
          console.warn("Store: Failed to cache collections to MetaStore", err);
        });
    } catch (e) {
      console.warn("Store: loadCollections failed", e);
      const activeConnectionId = useConnectionStore.getState().activeConnectionId;
      const currentSchema = get().currentSchema;
      if (activeConnectionId !== connectionId || currentSchema !== namespace) {
        return;
      }
      set({ collections: [], isCollectionsLoading: false });
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

    localStorage.setItem(pinKey, JSON.stringify(newPinned));
    set({ pinnedTables: newPinned });
  },

  setCurrentSchema: async (schema: string) => {
    const { activeConnectionId } = useConnectionStore.getState();
    // Clear tables immediately to prevent showing stale data from previous schema
    set({
      currentSchema: schema,
      selectedTable: null,
      tables: [],
      collections: [],
      functions: [],
      isCollectionsLoading: false,
      isFunctionsLoading: false,
    });

    if (activeConnectionId && schema) {
      await schemaService.setCurrentSchema(activeConnectionId, schema);
    }
  },

  setDefaultSchema: (schema: string) => {
    console.log("Store: setDefaultSchema called with:", schema);
    const { activeConnectionId } = useConnectionStore.getState();
    if (activeConnectionId) {
      localStorage.setItem(
        getDefaultSchemaKey(activeConnectionId, getConnectionDriver(activeConnectionId)),
        schema
      );
    }
    set({ defaultSchema: schema, currentSchema: schema });
    console.log("Store: setDefaultSchema - currentSchema updated to:", schema);
  },

  selectTable: (table: string | null) => {
    set({ selectedTable: table });
  },
}));
