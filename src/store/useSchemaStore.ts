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
      console.log(
        "Store: loadSchemas skipped (redundant for connectionId:",
        connectionId,
        ")"
      );
      return;
    }

    console.log("Store: loadSchemas called with connectionId:", connectionId);
    set({ isLoading: true, lastLoadedConnectionId: connectionId });
    const res = await api.getSchemas(connectionId);
    console.log("Store: loadSchemas API response:", res);
    if (res.success && res.data) {
      const { defaultSchema: savedDefault } = get();
      // Priority: 1. Saved default (if available), 2. 'public', 3. First schema
      let schemaToSelect = res.data[0];

      if (savedDefault && res.data.includes(savedDefault)) {
        schemaToSelect = savedDefault;
      } else if (res.data.includes("public")) {
        schemaToSelect = "public";
      }

      console.log(
        "Store: loadSchemas - Setting currentSchema to:",
        schemaToSelect,
        "from",
        res.data.length,
        "schemas"
      );
      set({
        schemas: res.data,
        currentSchema: schemaToSelect,
        isLoading: false,
      });
      console.log(
        "Store: loadSchemas - State updated. currentSchema is now:",
        schemaToSelect
      );
    } else {
      console.warn("Store: loadSchemas failed or empty", res);
      set({ schemas: [], isLoading: false });
    }
  },

  loadTables: async (connectionId: string, schema: string) => {
    console.log("Store: loadTables called", { connectionId, schema });
    set({ isLoading: true });
    const res = await api.getTables(connectionId, schema);
    console.log("Store: loadTables result", res);
    if (res.success && res.data) {
      console.log("Store: loadTables updating state", {
        count: res.data.length,
        tables: res.data,
      });
      set({ tables: res.data, isLoading: false });
    } else {
      console.warn("Store: loadTables failed or empty", res);
      set({ tables: [], isLoading: false });
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
