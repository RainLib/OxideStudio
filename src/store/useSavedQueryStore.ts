import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  timestamp: number;
}

interface SavedQueryState {
  savedQueries: SavedQuery[];
  saveQuery: (name: string, sql: string) => void;
  deleteQuery: (id: string) => void;
  updateQuery: (id: string, name: string, sql: string) => void;
}

export const useSavedQueryStore = create<SavedQueryState>()(
  persist(
    (set) => ({
      savedQueries: [],
      saveQuery: (name: string, sql: string) => {
          set((state) => ({
              savedQueries: [...state.savedQueries, {
                  id: uuidv4(),
                  name,
                  sql,
                  timestamp: Date.now()
              }]
          }));
      },
      deleteQuery: (id: string) => {
          set((state) => ({
              savedQueries: state.savedQueries.filter(q => q.id !== id)
          }));
      },
      updateQuery: (id, name, sql) => {
          set(state => ({
              savedQueries: state.savedQueries.map(q => q.id === id ? { ...q, name, sql } : q)
          }));
      }
    }),
    {
      name: 'saved-queries',
    }
  )
);
