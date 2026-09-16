import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  canCreateDataCompareSource,
  hasUnsavedTabChanges,
  useTabStore,
} from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { canManuallyReorderTabs, organizeEditorTabs } from "@/lib/tabOrganization";
import { useEditorGroupStore } from "@/store/useEditorGroupStore";
import type { EditorSplitDirection } from "@/store/useEditorGroupStore";
import type { TabBarProps, TabDragState } from "@/features/workspace-tabs/model/tabBar";

export function useTabBarController({
  activeTabIdOverride,
  queryOnly = false,
  onSelectTab,
}: Pick<TabBarProps, "activeTabIdOverride" | "queryOnly" | "onSelectTab">) {
  const tabPresentationSignature = useTabStore((state) =>
    state.tabs
      .map((tab) =>
        [
          tab.id,
          tab.type,
          tab.title,
          tab.createdAt || "",
          tab.isPinned ? "1" : "0",
          tab.fileRelativePath || "",
          tab.filePreview ? "preview" : "",
          tab.isDirty ? "dirty" : "",
          tab.pendingEdits?.size || 0,
          tab.newRowsCount || 0,
          tab.schemaName || "",
          tab.results?.[tab.activeResultIndex || 0]?.rows.length || 0,
          tab.results?.[tab.activeResultIndex || 0]?.columns.length || 0,
        ].join("\u001f"),
      )
      .join("\u001e"),
  );
  const tabs = useMemo(
    () => useTabStore.getState().tabs,
    [tabPresentationSignature],
  );
  const activeTabId = useTabStore((state) => state.activeTabId);
  const setActiveTab = useTabStore((state) => state.setActiveTab);
  const forceCloseTab = useTabStore((state) => state.forceCloseTab);
  const closeOtherTabs = useTabStore((state) => state.closeOtherTabs);
  const closeAllTabs = useTabStore((state) => state.closeAllTabs);
  const closeTabsByIds = useTabStore((state) => state.closeTabsByIds);
  const togglePinTab = useTabStore((state) => state.togglePinTab);
  const reorderTab = useTabStore((state) => state.reorderTab);
  const createTab = useTabStore((state) => state.createTab);
  const openDataCompareTab = useTabStore((state) => state.openDataCompareTab);
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const connections = useConnectionStore((state) => state.connections);
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const tabPlacement = useSettingsStore(
    (state) => state.settings.editor.tabPlacement,
  );
  const tabGroupMode = useSettingsStore(
    (state) => state.settings.editor.tabGroupMode,
  );
  const tabSortMode = useSettingsStore(
    (state) => state.settings.editor.tabSortMode,
  );
  const reduceMotion = useSettingsStore(
    (state) => state.settings.appearance.reduceMotion,
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [contextMenuTabId, setContextMenuTabId] = useState<string | null>(null);
  const [tabDrag, setTabDrag] = useState<TabDragState | null>(null);
  const activeConnection = connections.find(
    (connection) => connection.id === activeConnectionId,
  );
  const displayedActiveTabId =
    activeTabIdOverride === undefined ? activeTabId : activeTabIdOverride;
  const sourceTabs = useMemo(
    () => (queryOnly ? tabs.filter((tab) => tab.type === "query") : tabs),
    [queryOnly, tabs],
  );
  const organizedTabs = useMemo(
    () =>
      organizeEditorTabs(
        sourceTabs,
        tabGroupMode,
        tabSortMode,
        connections.map((connection) => ({
          id: connection.id,
          name: connection.name,
          driver: connection.driver,
        })),
      ),
    [connections, sourceTabs, tabGroupMode, tabSortMode],
  );
  const visibleTabs = useMemo(
    () => organizedTabs.map(({ tab }) => tab),
    [organizedTabs],
  );
  const visibleTabIndex = useMemo(
    () => new Map(visibleTabs.map((tab, index) => [tab.id, index])),
    [visibleTabs],
  );
  const organizedTabById = useMemo(
    () => new Map(organizedTabs.map((item) => [item.tab.id, item])),
    [organizedTabs],
  );
  const hasPinnedVisibleTabs = useMemo(
    () => visibleTabs.some((tab) => tab.isPinned),
    [visibleTabs],
  );
  const dataCompareSourceIds = useMemo(
    () =>
      new Set(
        tabs
          .filter((tab) => canCreateDataCompareSource(tab))
          .map((tab) => tab.id),
      ),
    [tabs],
  );
  const isVertical = tabPlacement === "left" || tabPlacement === "right";
  const canDragTabs = canManuallyReorderTabs(tabSortMode);
  const activateTab = (tabId: string) => {
    onSelectTab?.(tabId);
    setActiveTab(tabId);
  };
  const splitTab = (direction: EditorSplitDirection, tabId: string) => {
    useEditorGroupStore.getState().split(direction, tabId);
    setActiveTab(tabId);
  };

  const closeVisibleTabs = (ids: readonly string[]) => {
    closeTabsByIds(ids);
    setContextMenuTabId(null);
  };

  const closeVisibleTab = (tabId: string) => {
    const index = visibleTabIndex.get(tabId);
    const fallbackTabId =
      index === undefined
        ? null
        : visibleTabs[index + 1]?.id || visibleTabs[index - 1]?.id || null;
    closeTabsByIds([tabId], fallbackTabId);
    setContextMenuTabId(null);
  };

  const closeVisibleOtherTabs = (tabId: string) => {
    if (!queryOnly) {
      closeOtherTabs(tabId);
      setContextMenuTabId(null);
      return;
    }
    closeVisibleTabs(
      visibleTabs
        .filter((tab) => tab.id !== tabId && !tab.isPinned)
        .map((tab) => tab.id),
    );
  };

  const closeVisibleAllTabs = () => {
    if (!queryOnly) {
      closeAllTabs();
      setContextMenuTabId(null);
      return;
    }
    closeVisibleTabs(
      visibleTabs.filter((tab) => !tab.isPinned).map((tab) => tab.id),
    );
  };

  const handleDragOver = (
    event: DragEvent<HTMLDivElement>,
    targetId: string,
  ) => {
    if (!tabDrag || !canDragTabs || tabDrag.draggedId === targetId) return;
    const dragged = organizedTabById.get(tabDrag.draggedId);
    const target = organizedTabById.get(targetId);
    if (
      !dragged ||
      !target ||
      dragged.tab.isPinned !== target.tab.isPinned ||
      (tabGroupMode !== "none" && dragged.groupKey !== target.groupKey)
    ) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = isVertical
      ? event.clientY - rect.top
      : event.clientX - rect.left;
    const extent = isVertical ? rect.height : rect.width;
    const position = offset < extent / 2 ? "before" : "after";
    if (tabDrag.targetId !== targetId || tabDrag.position !== position) {
      setTabDrag((current) =>
        current?.draggedId === tabDrag.draggedId
          ? { ...current, targetId, position }
          : current,
      );
    }
  };

  const finishDrag = (
    event: DragEvent<HTMLDivElement>,
    targetId: string,
  ) => {
    if (tabDrag && tabDrag.draggedId !== targetId) {
      const dragged = organizedTabById.get(tabDrag.draggedId);
      const target = organizedTabById.get(targetId);
      if (
        dragged &&
        target &&
        dragged.tab.isPinned === target.tab.isPinned &&
        (tabGroupMode === "none" || dragged.groupKey === target.groupKey)
      ) {
        const rect = event.currentTarget.getBoundingClientRect();
        const offset = isVertical
          ? event.clientY - rect.top
          : event.clientX - rect.left;
        const extent = isVertical ? rect.height : rect.width;
        reorderTab(
          tabDrag.draggedId,
          targetId,
          offset < extent / 2 ? "before" : "after",
        );
      }
    }
    setTabDrag(null);
  };

  const createQueryConsole = () => {
    useEditorGroupStore.getState().reset();
    const queryNumber = tabs.filter((tab) => tab.type === "query").length + 1;
    createTab(
      "query",
      activeConnection
        ? `console [${activeConnection.name}]`
        : `Query #${queryNumber}`,
      "",
      {
        connectionId: activeConnectionId || undefined,
        schemaName: currentSchema || undefined,
      },
    );
  };

  // Check for overflow
  useEffect(() => {
    const checkOverflow = () => {
      const container = scrollContainerRef.current;
      if (container) {
        setHasOverflow(
          isVertical
            ? container.scrollHeight > container.clientHeight
            : container.scrollWidth > container.clientWidth,
        );
      }
    };

    checkOverflow();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(checkOverflow);
    if (scrollContainerRef.current)
      observer?.observe(scrollContainerRef.current);
    window.addEventListener("resize", checkOverflow);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", checkOverflow);
    };
  }, [isVertical, visibleTabs]);

  // Auto-scroll to active tab
  useEffect(() => {
    if (displayedActiveTabId && tabRefs.current.has(displayedActiveTabId)) {
      const activeTabElement = tabRefs.current.get(displayedActiveTabId);
      if (activeTabElement && scrollContainerRef.current) {
        // Scroll the active tab into view with smooth behavior
        activeTabElement.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: isVertical ? "center" : "nearest",
          inline: isVertical ? "nearest" : "center",
        });
      }
    }
  }, [displayedActiveTabId, isVertical, reduceMotion]);


  return {
    tabs,
    tabPlacement,
    tabGroupMode,
    tabSortMode,
    isVertical,
    organizedTabs,
    visibleTabs,
    visibleTabIndex,
    hasPinnedVisibleTabs,
    dataCompareSourceIds,
    displayedActiveTabId,
    canDragTabs,
    hasOverflow,
    scrollContainerRef,
    tabRefs,
    contextMenuTabId,
    setContextMenuTabId,
    tabDrag,
    setTabDrag,
    activateTab,
    splitTab,
    closeVisibleTab,
    closeVisibleTabs,
    closeVisibleOtherTabs,
    closeVisibleAllTabs,
    handleDragOver,
    finishDrag,
    createQueryConsole,
    togglePinTab,
    forceCloseTab,
    openDataCompareTab,
    hasUnsavedTabChanges,
  };
}
