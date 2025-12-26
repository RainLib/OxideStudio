import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { api } from "@/lib/api";
import { QueryResult } from "@/types/protocol";
import { useHistoryStore } from "./useHistoryStore";
import type { FilterOperator } from "@/components/workspace/GridFilterRow";

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
  isPinned: boolean;
  gridState?: {
    columnFilters: Record<string, { operator: string; value: string }>;
    sortColumn: string | null;
    sortDirection: "asc" | "desc" | null;
  };
  pendingEdits?: Map<string, any>; // key: "rowIndex:colIndex", value: new value
  // Filter UI state (per-tab)
  filterMode?: "visual" | "sql";
  visualFilters?: Array<{
    column: string;
    operator: FilterOperator;
    value: string;
    logic?: "AND" | "OR";
  }>;
  sqlFilter?: string;
  // Column layout state (per-tab)
  columnWidths?: Record<string, number>;
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
  findOrCreateTableTab: (
    connectionId: string,
    schemaName: string,
    tableName: string
  ) => string;
  closeTab: (id: string) => void;
  forceCloseTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsToLeft: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  togglePinTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  runTabQuery: (id: string, connectionId: string) => Promise<void>;
  setGridFilter: (
    tabId: string,
    column: string,
    filter: { operator: string; value: string } | undefined
  ) => void;
  setGridSort: (
    tabId: string,
    column: string | null,
    direction: "asc" | "desc" | null
  ) => void;
  setCellEdit: (
    tabId: string,
    rowIndex: number,
    colIndex: number,
    value: any
  ) => void;
  commitEdits: (tabId: string) => Promise<void>;
  cancelEdits: (tabId: string) => void;
  // Filter UI methods
  setFilterMode: (tabId: string, mode: "visual" | "sql") => void;
  setVisualFilters: (
    tabId: string,
    filters: Array<{
      column: string;
      operator: FilterOperator;
      value: string;
      logic?: "AND" | "OR";
    }>
  ) => void;
  setSqlFilter: (tabId: string, sqlFilter: string) => void;
  // Column layout methods
  setColumnWidth: (tabId: string, columnId: string, width: number) => void;
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
      isPinned: false,
      ...metadata,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
    return newTab.id;
  },

  findOrCreateTableTab: (
    _connectionId: string, // Reserved for future use
    schemaName: string,
    tableName: string
  ) => {
    const { tabs } = get();

    // Find existing tab with same schema+table
    const existingTab = tabs.find(
      (tab) =>
        tab.type === "table" &&
        tab.tableName === tableName &&
        tab.schemaName === schemaName
      // Note: We don't store connectionId in tab, but in practice
      // if schema+table match, it's likely the same tab
      // You could add connectionId to TabData if needed
    );

    if (existingTab) {
      // Reuse existing tab
      set({ activeTabId: existingTab.id });
      return existingTab.id;
    }

    // Create new tab if no match found
    return get().createTab("table", tableName, "", {
      tableName,
      schemaName,
    });
  },

  closeTab: (id: string) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      // Don't close pinned tabs with regular close
      if (tab?.isPinned) return state;

      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      // If closing active tab, switch to another
      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1]!.id
            : null;
      }

      return { tabs: newTabs, activeTabId: newActiveId };
    });
  },

  forceCloseTab: (id: string) => {
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      // If closing active tab, switch to another
      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1]!.id
            : null;
      }

      return { tabs: newTabs, activeTabId: newActiveId };
    });
  },

  closeOtherTabs: (id: string) => {
    set((state) => ({
      tabs: state.tabs.filter((t) => t.id === id || t.isPinned),
      activeTabId: id,
    }));
  },

  closeAllTabs: () => {
    set((state) => {
      const pinnedTabs = state.tabs.filter((t) => t.isPinned);
      return {
        tabs: pinnedTabs,
        activeTabId: pinnedTabs.length > 0 ? pinnedTabs[0]!.id : null,
      };
    });
  },

  closeTabsToLeft: (id: string) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;

      const newTabs = [
        ...state.tabs.slice(0, index).filter((t) => t.isPinned),
        ...state.tabs.slice(index),
      ];

      return { tabs: newTabs };
    });
  },

  closeTabsToRight: (id: string) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;

      const newTabs = [
        ...state.tabs.slice(0, index + 1),
        ...state.tabs.slice(index + 1).filter((t) => t.isPinned),
      ];

      return { tabs: newTabs };
    });
  },

  togglePinTab: (id: string) => {
    set((state) => {
      const tabs = state.tabs.map((t) =>
        t.id === id ? { ...t, isPinned: !t.isPinned } : t
      );

      // Sort tabs: pinned first, then unpinned
      const pinnedTabs = tabs.filter((t) => t.isPinned);
      const unpinnedTabs = tabs.filter((t) => !t.isPinned);

      return { tabs: [...pinnedTabs, ...unpinnedTabs] };
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

  setGridFilter: (tabId, column, filter) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const gridState = t.gridState || {
          columnFilters: {},
          sortColumn: null,
          sortDirection: null,
        };
        const columnFilters = { ...gridState.columnFilters };
        if (filter) {
          columnFilters[column] = filter;
        } else {
          delete columnFilters[column];
        }
        return { ...t, gridState: { ...gridState, columnFilters } };
      }),
    }));
  },

  setGridSort: (tabId, column, direction) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const gridState = t.gridState || {
          columnFilters: {},
          sortColumn: null,
          sortDirection: null,
        };
        return {
          ...t,
          gridState: {
            ...gridState,
            sortColumn: column,
            sortDirection: direction,
          },
        };
      }),
    }));
  },

  setCellEdit: (tabId, rowIndex, colIndex, value) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const pendingEdits = new Map(t.pendingEdits || new Map());
        const key = `${rowIndex}:${colIndex}`;
        pendingEdits.set(key, value);
        return { ...t, pendingEdits };
      }),
    }));
  },

  commitEdits: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || !tab.pendingEdits || tab.pendingEdits.size === 0) return;

    // For now, just clear the edits
    // TODO: Generate and execute UPDATE SQL statements
    console.log("Committing edits:", tab.pendingEdits);

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, pendingEdits: new Map() } : t
      ),
    }));
  },

  cancelEdits: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, pendingEdits: new Map() } : t
      ),
    }));
  },

  setFilterMode: (tabId, mode) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, filterMode: mode } : t
      ),
    }));
  },

  setVisualFilters: (tabId, filters) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, visualFilters: filters } : t
      ),
    }));
  },

  setSqlFilter: (tabId, sqlFilter) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, sqlFilter } : t)),
    }));
  },

  setColumnWidth: (tabId, columnId, width) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const columnWidths = t.columnWidths || {};
        return {
          ...t,
          columnWidths: {
            ...columnWidths,
            [columnId]: width,
          },
        };
      }),
    }));
  },
}));
