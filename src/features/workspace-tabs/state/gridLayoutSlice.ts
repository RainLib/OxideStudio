import { removeGridLayout } from "@/features/data-grid";
import {
  gridLayoutScopeForTab,
  saveTabGridLayout,
} from "@/features/workspace-tabs/model/gridLayout";
import type { TabSlice } from "./types";

export const createGridLayoutSlice: TabSlice<
  | "setColumnWidth"
  | "setColumnOrder"
  | "setColumnHidden"
  | "setFrozenColumnCount"
  | "restoreColumnLayout"
  | "showAllColumns"
  | "resetColumnLayout"
> = (set, get) => ({
  setColumnWidth: (tabId, columnId, width) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTab = {
      ...tab,
      columnWidths: { ...(tab.columnWidths || {}), [columnId]: width },
    };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return nextTab;
      }),
    }));
  },

  setColumnOrder: (tabId, columnOrder) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTab = { ...tab, columnOrder };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? nextTab : t)),
    }));
  },

  setColumnHidden: (tabId, columnId, hidden) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const hiddenColumns = new Set(tab.hiddenColumns || []);
    if (hidden) hiddenColumns.add(columnId);
    else hiddenColumns.delete(columnId);
    const nextTab = { ...tab, hiddenColumns: [...hiddenColumns] };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return nextTab;
      }),
    }));
  },

  setFrozenColumnCount: (tabId, count) => {
    const frozenColumnCount = Math.max(0, Math.floor(count));
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTab = { ...tab, frozenColumnCount };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? nextTab : tab)),
    }));
  },

  restoreColumnLayout: (tabId, layout) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              columnWidths: layout.columnWidths,
              columnOrder: layout.columnOrder,
              hiddenColumns: layout.hiddenColumns,
              frozenColumnCount: layout.frozenColumnCount,
            }
          : tab,
      ),
    }));
  },

  showAllColumns: (tabId) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const nextTab = { ...tab, hiddenColumns: [] };
    saveTabGridLayout(nextTab);
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? nextTab : tab)),
    }));
  },

  resetColumnLayout: (tabId) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;
    removeGridLayout(gridLayoutScopeForTab(tab));
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              columnWidths: {},
              columnOrder: [],
              hiddenColumns: [],
              frozenColumnCount: 0,
            }
          : tab,
      ),
    }));
  },
});
