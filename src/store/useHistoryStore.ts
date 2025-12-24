import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface HistoryItem {
  id: string;
  sql: string;
  timestamp: number;
}

interface HistoryState {
  history: HistoryItem[];
  addToHistory: (sql: string) => void;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      history: [],
      addToHistory: (sql: string) => {
          if (!sql.trim()) return;
          set((state) => {
             // Deduplicate: remove if exists at top
             const newHistory = state.history.filter(h => h.sql !== sql);
             const newItem = { id: Date.now().toString(), sql, timestamp: Date.now() };
             return { history: [newItem, ...newHistory].slice(0, 100) }; // Keep last 100
          });
      },
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'query-history',
    }
  )
);
