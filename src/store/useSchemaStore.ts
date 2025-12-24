import { create } from "zustand";
import { api } from "@/lib/api";
import { TableInfo } from "@/types/protocol";

interface SchemaState {
  schemas: string[];
  tables: TableInfo[];
  currentSchema: string | null;
  selectedTable: string | null;
  isLoading: boolean;

  loadSchemas: (connectionId: string) => Promise<void>;
  loadTables: (connectionId: string, schema: string) => Promise<void>;
  setCurrentSchema: (schema: string) => void;
  selectTable: (table: string | null) => void;
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  schemas: [],
  tables: [],
  currentSchema: null,
  selectedTable: null,
  isLoading: false,

  loadSchemas: async (connectionId: string) => {
    set({ isLoading: true });
    const res = await api.getSchemas(connectionId);
    if (res.success && res.data) {
        // Default to 'public' or first schema if available
        const defaultSchema = res.data.includes("public") ? "public" : res.data[0];
        set({ schemas: res.data, currentSchema: defaultSchema, isLoading: false });
    } else {
        set({ schemas: [], isLoading: false });
    }
  },

  loadTables: async (connectionId: string, schema: string) => {
      set({ isLoading: true });
      const res = await api.getTables(connectionId, schema);
      if (res.success && res.data) {
          set({ tables: res.data, isLoading: false });
      } else {
          set({ tables: [], isLoading: false });
      }
  },

  setCurrentSchema: (schema: string) => {
      set({ currentSchema: schema });
  },

  selectTable: (table: string | null) => {
      set({ selectedTable: table });
  }
}));
