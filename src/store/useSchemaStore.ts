import { create } from "zustand";
import { api } from "@/lib/api";
import { TableInfo } from "@/types/protocol";
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
    const cachedRes = await api.getCachedSchemas(connectionId);
    if (cachedRes.success && cachedRes.data && cachedRes.data.length > 0) {
      console.log("Store: Loaded schemas from cache", cachedRes.data.length);
      const { defaultSchema: savedDefault } = get();

      const connections = useConnectionStore.getState().connections;
      const activeConn = connections.find((c) => c.id === connectionId);
      const configDefault = activeConn?.database;

      let schemaToSelect = cachedRes.data[0];
      if (configDefault && cachedRes.data.includes(configDefault)) {
        schemaToSelect = configDefault;
      } else if (savedDefault && cachedRes.data.includes(savedDefault)) {
        schemaToSelect = savedDefault;
      } else if (cachedRes.data.includes("public")) {
        schemaToSelect = "public";
      }

      set({
        schemas: cachedRes.data,
        currentSchema: schemaToSelect,
        isLoading: false, // Show cached data immediately
      });
      // Continue to refresh in background...
    }

    // 2. Refresh from DB (Background Sync)
    console.log("Store: Refreshing schemas from DB...");
    const res = await api.refreshSchemas(connectionId);
    console.log("Store: loadSchemas Refresh result:", res);

    if (res.success && res.data) {
      const { defaultSchema: savedDefault } = get();
      const connections = useConnectionStore.getState().connections;
      const activeConn = connections.find((c) => c.id === connectionId);
      const configDefault = activeConn?.database;

      let schemaToSelect = res.data[0];

      if (configDefault && res.data.includes(configDefault)) {
        schemaToSelect = configDefault;
      } else if (savedDefault && res.data.includes(savedDefault)) {
        schemaToSelect = savedDefault;
      } else if (res.data.includes("public")) {
        schemaToSelect = "public";
      }

      // Check if data actually changed? API returns data either way currently.
      // Ideally we check equality here or rely on React to not re-render if same.
      // But we need to update state if it's different.
      // For now, simple update.
      set({
        schemas: res.data,
        // Only update currentSchema if it wasn't set or invalid?
        // Or if we need to re-apply defaults?
        // If user already selected something else while loading?
        // Let's keep currentSchema if valid, otherwise reset.
        // Actually, for initial load, re-evaluating default is safer.
        currentSchema: get().currentSchema || schemaToSelect,
        isLoading: false,
      });
    } else {
      console.warn("Store: loadSchemas refresh failed", res);
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
    const cachedRes = await api.getCachedTables(connectionId, schema);
    if (cachedRes.success && cachedRes.data && cachedRes.data.length > 0) {
      console.log("Store: Loaded tables from cache", cachedRes.data.length);
      set({ tables: cachedRes.data, isLoading: false });
    }

    // 2. Refresh from DB
    const res = await api.refreshTables(connectionId, schema);
    console.log("Store: loadTables refresh result", res);
    if (res.success && res.data) {
      // Only update if different?
      // For now, update always.
      set({ tables: res.data, isLoading: false });
    } else {
      console.warn("Store: loadTables refresh failed", res);
      if (get().tables.length === 0) {
        set({ tables: [], isLoading: false });
      }
    }
  },

  setCurrentSchema: async (schema: string) => {
    const { activeConnectionId } = useConnectionStore.getState();
    set({ currentSchema: schema, selectedTable: null });

    if (activeConnectionId && schema) {
      await api.setCurrentSchema(activeConnectionId, schema);
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
