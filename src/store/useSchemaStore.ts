import { create } from "zustand";
import {
  schemaService,
  storeService,
  TableInfo,
  Resource,
} from "@/services/tauri";
import { useConnectionStore } from "./useConnectionStore";

interface SchemaState {
  schemas: string[];
  tables: TableInfo[];
  currentSchema: string | null;
  defaultSchema: string | null; // User's preferred default
  selectedTable: string | null;
  lastLoadedConnectionId: string | null; // Guard for duplicate calls
  isLoading: boolean;

  loadSchemas: (connectionId: string, force?: boolean) => Promise<void>;
  loadTables: (connectionId: string, schema: string) => Promise<void>;
  setCurrentSchema: (schema: string) => void;
  setDefaultSchema: (schema: string) => void; // Persist user's choice
  selectTable: (table: string | null) => void;
  reset: () => void;
}

const STORAGE_KEY = "oxide-studio-default-schema";

export const useSchemaStore = create<SchemaState>((set, get) => ({
  schemas: [],
  tables: [],
  currentSchema: null,
  defaultSchema: localStorage.getItem(STORAGE_KEY),
  selectedTable: null,
  lastLoadedConnectionId: null,
  isLoading: false,

  reset: () => {
    set({
      schemas: [],
      tables: [],
      currentSchema: null,
      selectedTable: null,
      lastLoadedConnectionId: null,
      isLoading: false,
    });
  },

  loadSchemas: async (connectionId: string, force = false) => {
    const { lastLoadedConnectionId, isLoading } = get();

    // Prevent duplicate calls if we're already loading or if the connection hasn't changed (unless forced)
    if ((isLoading || lastLoadedConnectionId === connectionId) && !force) {
      console.log("Store: loadSchemas skipped (redundant)");
      return;
    }

    console.log(
      "Store: loadSchemas called (MetaStore aware) for:",
      connectionId
    );
    set({ isLoading: true, lastLoadedConnectionId: connectionId });

    // 1. Try MetaStore Cache First (SQLite)
    try {
      // Fetch DB resources (parent_id = null)
      const cachedResources = await storeService.getResources(connectionId);
      const cachedSchemas = cachedResources.map((r) => r.name);

      if (cachedSchemas && cachedSchemas.length > 0) {
        console.log(
          "Store: Loaded schemas from MetaStore",
          cachedSchemas.length
        );
        const { defaultSchema: savedDefault } = get();

        const connections = useConnectionStore.getState().connections;
        const activeConn = connections.find((c) => c.id === connectionId);
        const configDefault = activeConn?.database;

        let schemaToSelect = cachedSchemas[0];
        if (configDefault && cachedSchemas.includes(configDefault)) {
          schemaToSelect = configDefault;
        } else if (savedDefault && cachedSchemas.includes(savedDefault)) {
          schemaToSelect = savedDefault;
        } else if (cachedSchemas.includes("public")) {
          schemaToSelect = "public";
        }

        set({
          schemas: cachedSchemas,
          currentSchema: schemaToSelect,
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

    // 2. Refresh from Driver & Update MetaStore
    console.log("Store: Refreshing schemas from Driver...");
    try {
      const schemas = await schemaService.refreshSchemas(connectionId);
      console.log("Store: loadSchemas Refresh result:", schemas);

      if (schemas) {
        // Optimistically update UI first
        const { defaultSchema: savedDefault } = get();
        const connections = useConnectionStore.getState().connections;
        const activeConn = connections.find((c) => c.id === connectionId);
        const configDefault = activeConn?.database;

        let schemaToSelect = schemas[0];

        if (configDefault && schemas.includes(configDefault)) {
          schemaToSelect = configDefault;
        } else if (savedDefault && schemas.includes(savedDefault)) {
          schemaToSelect = savedDefault;
        } else if (schemas.includes("public")) {
          schemaToSelect = "public";
        }

        set({
          schemas: schemas,
          currentSchema: get().currentSchema || schemaToSelect,
          isLoading: false,
        });

        // Save to MetaStore in background
        const newResources: Resource[] = schemas.map((name) => ({
          id: `${connectionId}:${name}`, // Simple ID generation
          connection_id: connectionId,
          kind: "DATABASE",
          name: name,
          metadata: {},
          last_updated: Date.now(),
        }));

        storeService.saveResources(newResources).catch((err) => {
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

  loadTables: async (connectionId: string, schema: string) => {
    console.log("Store: loadTables called (MetaStore aware)", {
      connectionId,
      schema,
    });
    set({ isLoading: true });

    // Parent ID for tables is the schema resource ID: connectionId:schema
    const schemaResourceId = `${connectionId}:${schema}`;

    // 1. Try MetaStore Cache First
    try {
      const cachedResources = await storeService.getResources(
        connectionId,
        schemaResourceId
      );

      if (cachedResources && cachedResources.length > 0) {
        const cachedTables: TableInfo[] = cachedResources.map((r) => ({
          name: r.name,
          schema: schema,
          type: r.metadata?.type,
          comment: r.metadata?.comment,
        }));

        console.log("Store: Loaded tables from MetaStore", cachedTables.length);
        set({ tables: cachedTables, isLoading: false });

        // Return if cache hit (unless force - but loadTables doesn't have force param yet)
        return;
      }
    } catch (e) {
      console.warn("Store: Table MetaStore miss or error", e);
    }

    // 2. Refresh from Driver & Update MetaStore
    try {
      const tables = await schemaService.refreshTables(connectionId, schema);
      console.log("Store: loadTables refresh result", tables);

      set({ tables: tables, isLoading: false });

      // Save to MetaStore in background
      const newResources: Resource[] = tables.map((t) => ({
        id: `${schemaResourceId}:${t.name}`,
        connection_id: connectionId,
        parent_id: schemaResourceId,
        kind: "TABLE",
        name: t.name,
        metadata: { type: t.type, comment: t.comment },
        last_updated: Date.now(),
      }));

      storeService.saveResources(newResources).catch((err) => {
        console.warn("Store: Failed to cache tables to MetaStore", err);
      });
    } catch (e) {
      console.warn("Store: loadTables refresh failed", e);
      if (get().tables.length === 0) {
        set({ tables: [], isLoading: false });
      }
    }
  },

  setCurrentSchema: async (schema: string) => {
    const { activeConnectionId } = useConnectionStore.getState();
    // Clear tables immediately to prevent showing stale data from previous schema
    set({ currentSchema: schema, selectedTable: null, tables: [] });

    if (activeConnectionId && schema) {
      await schemaService.setCurrentSchema(activeConnectionId, schema);
    }
  },

  setDefaultSchema: (schema: string) => {
    console.log("Store: setDefaultSchema called with:", schema);
    localStorage.setItem(STORAGE_KEY, schema);
    set({ defaultSchema: schema, currentSchema: schema });
    console.log("Store: setDefaultSchema - currentSchema updated to:", schema);
  },

  selectTable: (table: string | null) => {
    set({ selectedTable: table });
  },
}));
