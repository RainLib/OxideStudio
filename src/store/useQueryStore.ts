import { create } from "zustand";
import { queryService, QueryResult } from "@/services/tauri";

interface QueryState {
  sql: string;
  results: QueryResult[] | null;
  isExecuting: boolean;
  error: string | null;

  setSql: (sql: string) => void;
  runQuery: (connectionId: string) => Promise<void>;
  clearResults: () => void;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  sql: "",
  results: null,
  isExecuting: false,
  error: null,

  setSql: (sql: string) => set({ sql }),

  runQuery: async (connectionId: string) => {
    const { sql } = get();
    if (!sql.trim()) return;

    set({ isExecuting: true, error: null, results: null });

    try {
      const results = await queryService.executeQuery(connectionId, sql);
      set({ results, isExecuting: false });
    } catch (e: any) {
      set({ error: e.message || String(e), isExecuting: false });
    }
  },

  clearResults: () => set({ results: null, error: null }),
}));
