import {
  confirmDiscardTabChanges,
  releaseTabRuntimeResources,
  tabAfterReleasingRuntimePayload,
} from "@/features/workspace-tabs/model/tabLifecycle";
import { TabData } from "@/features/workspace-tabs/model/types";
import type { TabSlice } from "./types";

export const createLifecycleSlice: TabSlice<
  | "closeTab"
  | "forceCloseTab"
  | "closeOtherTabs"
  | "closeAllTabs"
  | "closeTabsToLeft"
  | "closeTabsToRight"
  | "closeTabsByIds"
  | "togglePinTab"
  | "reorderTab"
  | "setActiveTab"
  | "reopenTab"
> = (set, get) => ({
  closeTab: (id: string) => {
    let closing: TabData[] = [];
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      // Don't close pinned tabs with regular close
      if (tab.isPinned) return state;
      if (!confirmDiscardTabChanges([tab], "close the tab")) return state;
      closing = [tab];

      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1]!.id
            : null;
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveId,
        closedTabsStack: [
          tabAfterReleasingRuntimePayload(tab),
          ...state.closedTabsStack.map(tabAfterReleasingRuntimePayload),
        ].slice(0, 20), // Keep last 20
      };
    });
    releaseTabRuntimeResources(closing);
  },

  forceCloseTab: (id: string) => {
    let closing: TabData[] = [];
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      if (!confirmDiscardTabChanges([tab], "close the tab")) return state;
      closing = [tab];

      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1]!.id
            : null;
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveId,
        closedTabsStack: [
          tabAfterReleasingRuntimePayload(tab),
          ...state.closedTabsStack.map(tabAfterReleasingRuntimePayload),
        ].slice(0, 20),
      };
    });
    releaseTabRuntimeResources(closing);
  },

  closeOtherTabs: (id: string) => {
    let closed: TabData[] = [];
    set((state) => {
      const closing = state.tabs.filter(
        (tab) => tab.id !== id && !tab.isPinned,
      );
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;
      closed = closing;
      return {
        tabs: state.tabs.filter((tab) => tab.id === id || tab.isPinned),
        activeTabId: id,
      };
    });
    releaseTabRuntimeResources(closed);
  },

  closeAllTabs: () => {
    let closed: TabData[] = [];
    set((state) => {
      const pinnedTabs = state.tabs.filter((t) => t.isPinned);
      const closing = state.tabs.filter((tab) => !tab.isPinned);
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;
      closed = closing;
      return {
        tabs: pinnedTabs,
        activeTabId: pinnedTabs.length > 0 ? pinnedTabs[0]!.id : null,
      };
    });
    releaseTabRuntimeResources(closed);
  },

  closeTabsToLeft: (id: string) => {
    let closed: TabData[] = [];
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;
      const closing = state.tabs.slice(0, index).filter((tab) => !tab.isPinned);
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;
      closed = closing;

      const newTabs = [
        ...state.tabs.slice(0, index).filter((t) => t.isPinned),
        ...state.tabs.slice(index),
      ];

      return { tabs: newTabs };
    });
    releaseTabRuntimeResources(closed);
  },

  closeTabsToRight: (id: string) => {
    let closed: TabData[] = [];
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;
      const closing = state.tabs
        .slice(index + 1)
        .filter((tab) => !tab.isPinned);
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;
      closed = closing;

      const newTabs = [
        ...state.tabs.slice(0, index + 1),
        ...state.tabs.slice(index + 1).filter((t) => t.isPinned),
      ];

      return { tabs: newTabs };
    });
    releaseTabRuntimeResources(closed);
  },

  closeTabsByIds: (ids, fallbackTabId) => {
    const requestedIds = new Set(ids);
    let closed: TabData[] = [];
    set((state) => {
      const closing = state.tabs.filter(
        (tab) => requestedIds.has(tab.id) && !tab.isPinned,
      );
      if (closing.length === 0) return state;
      if (!confirmDiscardTabChanges(closing, "close the tabs")) return state;
      closed = closing;
      const closingIds = new Set(closing.map((tab) => tab.id));
      const tabs = state.tabs.filter((tab) => !closingIds.has(tab.id));
      const activeTabId =
        state.activeTabId && closingIds.has(state.activeTabId)
          ? fallbackTabId && tabs.some((tab) => tab.id === fallbackTabId)
            ? fallbackTabId
            : tabs[tabs.length - 1]?.id || null
          : state.activeTabId;
      return {
        tabs,
        activeTabId,
        closedTabsStack: [
          ...closing.map(tabAfterReleasingRuntimePayload).reverse(),
          ...state.closedTabsStack.map(tabAfterReleasingRuntimePayload),
        ].slice(0, 20),
      };
    });
    releaseTabRuntimeResources(closed);
  },

  togglePinTab: (id: string) => {
    set((state) => {
      const tabs = state.tabs.map((t) =>
        t.id === id ? { ...t, isPinned: !t.isPinned } : t,
      );

      // Sort tabs: pinned first, then unpinned
      const pinnedTabs = tabs.filter((t) => t.isPinned);
      const unpinnedTabs = tabs.filter((t) => !t.isPinned);

      return { tabs: [...pinnedTabs, ...unpinnedTabs] };
    });
  },

  reorderTab: (draggedId, targetId, position) => {
    let moved = false;
    set((state) => {
      if (draggedId === targetId) return state;
      const draggedIndex = state.tabs.findIndex((tab) => tab.id === draggedId);
      const target = state.tabs.find((tab) => tab.id === targetId);
      const dragged = state.tabs[draggedIndex];
      if (!dragged || !target || dragged.isPinned !== target.isPinned) {
        return state;
      }

      const tabs = [...state.tabs];
      tabs.splice(draggedIndex, 1);
      const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
      if (targetIndex < 0) return state;
      tabs.splice(
        position === "before" ? targetIndex : targetIndex + 1,
        0,
        dragged,
      );
      if (tabs.every((tab, index) => tab === state.tabs[index])) return state;
      moved = true;
      return { tabs };
    });
    return moved;
  },

  setActiveTab: (id: string) => {
    set({ activeTabId: id });
  },

  reopenTab: () => {
    const { closedTabsStack, tabs } = get();
    if (closedTabsStack.length === 0) return;

    const [tabToReopen, ...newStack] = closedTabsStack;

    // Check if tab already exists (though it shouldn't be in stack if it does)
    if (tabs.find((t) => t.id === tabToReopen!.id)) {
      set({ closedTabsStack: newStack });
      return;
    }

    set({
      tabs: [...tabs, tabToReopen!],
      activeTabId: tabToReopen!.id,
      closedTabsStack: newStack,
    });
  },
});
