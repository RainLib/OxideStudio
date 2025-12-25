import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { api } from "@/lib/api";
import { QueryResult } from "@/types/protocol";
import { useHistoryStore } from "./useHistoryStore";

export type TabType = "query" | "table";

export interface TabData {
  id: string;
  title: string;
  type: TabType;
  sql: string;
  tableName?: string;
  schemaName?: string;
  filters?: any[];
  results: QueryResult[] | null;
  isExecuting: boolean;
  error: string | null;
}

interface TabState {
  tabs: TabData[];
  activeTabId: string | null;

  createTab: (
    type?: TabType,
    title?: string,
    initialSql?: string,
    metadata?: Partial<Pick<TabData, "tableName" | "schemaName" | "filters">>
  ) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  runTabQuery: (id: string, connectionId: string) => Promise<void>;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  createTab: (
    type = "query",
    title = "New Query",
    initialSql = "",
    metadata = {}
  ) => {
    const newTab: TabData = {
      id: uuidv4(),
      title,
      type,
      sql: initialSql,
      results: null,
      isExecuting: false,
      error: null,
      ...metadata,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
    return newTab.id;
  },

  closeTab: (id: string) => {
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      // If closing active tab, switch to another
      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1].id
            : null;
      }

      return { tabs: newTabs, activeTabId: newActiveId };
    });
  },

  setActiveTab: (id: string) => {
    set({ activeTabId: id });
  },

  updateTabSql: (id: string, sql: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    }));
  },

  runTabQuery: async (id: string, connectionId: string) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !tab.sql.trim()) return;

    // Update state to executing
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, isExecuting: true, error: null, results: null }
          : t
      ),
    }));

    try {
      const res = await api.query(connectionId, tab.sql);

      // Add to history regardless of result? Usually only if success, but Beekeeper saves all attempts often.
      // Let's save on attempt for now, or maybe on success. Plan said "successful".
      // Actually, let's save immediately so we don't lose it if it crashes.
      useHistoryStore.getState().addToHistory(tab.sql);

      if (res.success && res.data) {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id
              ? { ...t, isExecuting: false, results: res.data || null }
              : t
          ),
        }));
      } else {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id
              ? {
                  ...t,
                  isExecuting: false,
                  error: res.error?.message || "Query failed",
                }
              : t
          ),
        }));
      }
    } catch (e) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, isExecuting: false, error: String(e) } : t
        ),
      }));
    }
  },
}));
