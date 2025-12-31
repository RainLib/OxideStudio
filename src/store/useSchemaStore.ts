import { create } from "zustand";
import { schemaService, TableInfo } from "@/services/tauri";
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

  loadSchemas: async (connectionId: string, force = false) => {
    const { lastLoadedConnectionId, isLoading } = get();

    // Prevent duplicate calls if we're already loading or if the connection hasn't changed (unless forced)
    if ((isLoading || lastLoadedConnectionId === connectionId) && !force) {
      console.log("Store: loadSchemas skipped (redundant)");
      return;
    }

    console.log("Store: loadSchemas called with SWR for:", connectionId);
    set({ isLoading: true, lastLoadedConnectionId: connectionId });

    // 1. Try Cache First
    try {
      const cachedSchemas = await schemaService.getCachedSchemas(connectionId);
      if (cachedSchemas && cachedSchemas.length > 0) {
        console.log("Store: Loaded schemas from cache", cachedSchemas.length);
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
        // Continue to refresh in background...
      }
    } catch (e) {
      console.warn("Store: Schema cache miss or error", e);
    }

    // 2. Refresh from DB (Background Sync)
    console.log("Store: Refreshing schemas from DB...");
    try {
      const schemas = await schemaService.refreshSchemas(connectionId);
      console.log("Store: loadSchemas Refresh result:", schemas);

      if (schemas) {
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
    console.log("Store: loadTables called SWR", { connectionId, schema });
    set({ isLoading: true });

    // 1. Try Cache First
    try {
      const cachedTables = await schemaService.getCachedTables(
        connectionId,
        schema
      );
      if (cachedTables && cachedTables.length > 0) {
        console.log("Store: Loaded tables from cache", cachedTables.length);
        set({ tables: cachedTables, isLoading: false });
      }
    } catch (e) {
      console.warn("Store: Table cache miss or error", e);
    }

    // 2. Refresh from DB
    try {
      const tables = await schemaService.refreshTables(connectionId, schema);
      console.log("Store: loadTables refresh result", tables);
      set({ tables: tables, isLoading: false });
    } catch (e) {
      console.warn("Store: loadTables refresh failed", e);
      if (get().tables.length === 0) {
        set({ tables: [], isLoading: false });
      }
    }
  },

  setCurrentSchema: async (schema: string) => {
    const { activeConnectionId } = useConnectionStore.getState();
    set({ currentSchema: schema, selectedTable: null });

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
