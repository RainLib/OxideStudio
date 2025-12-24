import { create } from "zustand";
import { api } from "@/lib/api";
import { QueryResult } from "@/types/protocol";

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
          const res = await api.query(connectionId, sql);
          if (res.success && res.data) {
              set({ results: res.data, isExecuting: false });
          } else {
              set({ error: res.error?.message || "Query failed", isExecuting: false });
          }
      } catch (e) {
          set({ error: String(e), isExecuting: false });
      }
  },

  clearResults: () => set({ results: null, error: null })
}));
