import {
  cloneQueryResultGridState,
  snapshotActiveQueryResultRun,
} from "@/features/workspace-tabs/model/queryResults";
import type { TabSlice } from "./types";

export const createGridFiltersSlice: TabSlice<
  | "setGridFilter"
  | "setGridSort"
  | "setFilterMode"
  | "setVisualFilters"
  | "setSqlFilter"
> = (set, get) => ({
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
        const nextGridState = { ...gridState, columnFilters };
        if (t.type === "table") return { ...t, gridState: nextGridState };
        const resultIndex = t.activeResultIndex ?? 0;
        return snapshotActiveQueryResultRun({
          ...t,
          gridState: nextGridState,
          resultGridStates: {
            ...t.resultGridStates,
            [resultIndex]: cloneQueryResultGridState(nextGridState)!,
          },
        });
      }),
    }));
  },

  setGridSort: async (tabId, column, direction) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return false;

    if (tab.type === "table") {
      return get().loadTablePage(tabId, 0, undefined, undefined, {
        discardAction: "sort the table",
        sortOverride: column && direction ? { column, direction } : null,
      });
    }

    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const gridState = t.gridState || {
          columnFilters: {},
          sortColumn: null,
          sortDirection: null,
        };
        const nextGridState = {
          ...gridState,
          sortColumn: column,
          sortDirection: direction,
        };
        const resultIndex = t.activeResultIndex ?? 0;
        return snapshotActiveQueryResultRun({
          ...t,
          gridState: nextGridState,
          resultGridStates: {
            ...t.resultGridStates,
            [resultIndex]: cloneQueryResultGridState(nextGridState)!,
          },
        });
      }),
    }));
    return true;
  },

  setFilterMode: (tabId, mode) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, filterMode: mode } : t,
      ),
    }));
  },

  setVisualFilters: (tabId, filters) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, visualFilters: filters } : t,
      ),
    }));
  },

  setSqlFilter: (tabId, sqlFilter) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, sqlFilter } : t)),
    }));
  },
});
