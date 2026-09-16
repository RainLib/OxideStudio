import type { ConnectionConfig } from "@/features/connections/model/types";
import { orderExplorerConnectionGroups } from "@/features/database-explorer/model/explorerGroupOrder";
import { compileExplorerSearchPattern } from "@/features/database-explorer/model/explorerSearchPattern";
import { resolveExplorerSelection } from "@/features/database-explorer/model/explorerSelection";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { explorerNodePassesVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import {
  EXPLORER_COMPACT_TREE_ROW_HEIGHT,
  EXPLORER_TREE_ROW_HEIGHT,
  explorerVirtualWindow,
  nextExplorerVirtualizationState,
} from "@/features/database-explorer/runtime/explorerFlatTree";
import { explorerTreeVisibleNodeIds } from "@/features/database-explorer/runtime/explorerTreeDom";
import {
  EMPTY_EXPLORER_CONNECTION_ASSIGNMENTS,
  EMPTY_EXPLORER_CONNECTION_GROUPS,
  EMPTY_EXPLORER_NODE_IDS,
  EMPTY_EXPLORER_VISIBILITY_FILTERS,
  useDatabaseExplorerStore,
  useExplorerExpansionState,
} from "@/store/useDatabaseExplorerStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface UseExplorerTreePreferencesContext {
  activeProjectId: string;
  deferredFilterText: string;
  setVisibilityFilterDraft: React.Dispatch<
    React.SetStateAction<{
      parentNodeId: string;
      label: string;
      includePatterns: string;
      excludePatterns: string;
    } | null>
  >;
  connectedConnectionIds: string[];
  connections: ConnectionConfig[];
  showConnectedConnectionsOnly: boolean;
  setShowConnectedConnectionsOnly: React.Dispatch<
    React.SetStateAction<boolean>
  >;
}

export function useExplorerTreePreferences({
  activeProjectId,
  deferredFilterText,
  setVisibilityFilterDraft,
  connectedConnectionIds,
  connections,
  showConnectedConnectionsOnly,
  setShowConnectedConnectionsOnly,
}: UseExplorerTreePreferencesContext) {
  const explorerStateScope = activeProjectId || "unassigned";
  const selectedExplorerNodeIds = useDatabaseExplorerStore(
    (state) =>
      state.scopes[explorerStateScope]?.selectedNodeIds ??
      EMPTY_EXPLORER_NODE_IDS,
  );
  const explorerSelectionAnchorId = useDatabaseExplorerStore(
    (state) => state.scopes[explorerStateScope]?.selectionAnchorId ?? null,
  );
  const setExplorerSelection = useDatabaseExplorerStore(
    (state) => state.setSelection,
  );
  const explorerViewMode = useDatabaseExplorerStore(
    (state) => state.scopes[explorerStateScope]?.viewMode ?? "hierarchical",
  );
  const explorerFilterScope = useDatabaseExplorerStore(
    (state) => state.scopes[explorerStateScope]?.filterScope ?? "all",
  );
  const explorerSearchMode = useDatabaseExplorerStore(
    (state) => state.scopes[explorerStateScope]?.searchMode ?? "global",
  );
  const explorerRegexSearch = useDatabaseExplorerStore(
    (state) => state.scopes[explorerStateScope]?.regexSearch ?? false,
  );
  const explorerConnectionSortMode = useDatabaseExplorerStore(
    (state) => state.scopes[explorerStateScope]?.connectionSortMode ?? "asc",
  );
  const explorerConnectionOrder = useDatabaseExplorerStore(
    (state) =>
      state.scopes[explorerStateScope]?.connectionOrder ??
      EMPTY_EXPLORER_NODE_IDS,
  );
  const explorerVisibilityFilters = useDatabaseExplorerStore(
    (state) =>
      state.scopes[explorerStateScope]?.visibilityFilters ??
      EMPTY_EXPLORER_VISIBILITY_FILTERS,
  );
  const explorerTreeRowHeight: 22 | 28 =
    explorerViewMode === "flat"
      ? EXPLORER_COMPACT_TREE_ROW_HEIGHT
      : EXPLORER_TREE_ROW_HEIGHT;
  const setExplorerViewMode = useDatabaseExplorerStore(
    (state) => state.setViewMode,
  );
  const setExplorerFilterScope = useDatabaseExplorerStore(
    (state) => state.setFilterScope,
  );
  const setExplorerSearchMode = useDatabaseExplorerStore(
    (state) => state.setSearchMode,
  );
  const setExplorerRegexSearch = useDatabaseExplorerStore(
    (state) => state.setRegexSearch,
  );
  const setExplorerConnectionSortMode = useDatabaseExplorerStore(
    (state) => state.setConnectionSortMode,
  );
  const setExplorerConnectionOrder = useDatabaseExplorerStore(
    (state) => state.setConnectionOrder,
  );
  const hideExplorerNodes = useDatabaseExplorerStore(
    (state) => state.hideNodes,
  );
  const showOnlyExplorerNodes = useDatabaseExplorerStore(
    (state) => state.showOnlyNodes,
  );
  const clearExplorerVisibilityFilter = useDatabaseExplorerStore(
    (state) => state.clearVisibilityFilter,
  );
  const setExplorerVisibilityPatterns = useDatabaseExplorerStore(
    (state) => state.setVisibilityPatterns,
  );
  const explorerSearchPattern = useMemo(
    () => compileExplorerSearchPattern(deferredFilterText, explorerRegexSearch),
    [deferredFilterText, explorerRegexSearch],
  );
  const explorerFilterMatches = useCallback(
    (...values: Array<unknown>) => explorerSearchPattern.matches(...values),
    [explorerSearchPattern],
  );
  const openExplorerVisibilityFilter = useCallback(
    (parentNodeId: string, label: string) => {
      const filter = explorerVisibilityFilters[parentNodeId];
      setVisibilityFilterDraft({
        parentNodeId,
        label,
        includePatterns: (filter?.includePatterns ?? []).join("\n"),
        excludePatterns: (filter?.excludePatterns ?? []).join("\n"),
      });
    },
    [explorerVisibilityFilters],
  );
  const explorerConnectionGroups = useDatabaseExplorerStore(
    (state) =>
      state.scopes[explorerStateScope]?.connectionGroups ??
      EMPTY_EXPLORER_CONNECTION_GROUPS,
  );
  const orderedExplorerConnectionGroups = useMemo(
    () => orderExplorerConnectionGroups(explorerConnectionGroups),
    [explorerConnectionGroups],
  );
  const explorerConnectionGroupIds = useDatabaseExplorerStore(
    (state) =>
      state.scopes[explorerStateScope]?.connectionGroupIds ??
      EMPTY_EXPLORER_CONNECTION_ASSIGNMENTS,
  );
  const createExplorerConnectionGroup = useDatabaseExplorerStore(
    (state) => state.createConnectionGroup,
  );
  const renameExplorerConnectionGroup = useDatabaseExplorerStore(
    (state) => state.renameConnectionGroup,
  );
  const deleteExplorerConnectionGroup = useDatabaseExplorerStore(
    (state) => state.deleteConnectionGroup,
  );
  const moveExplorerConnectionsToGroup = useDatabaseExplorerStore(
    (state) => state.moveConnectionsToGroup,
  );
  const moveExplorerConnectionGroup = useDatabaseExplorerStore(
    (state) => state.moveConnectionGroup,
  );
  const placeExplorerConnectionGroup = useDatabaseExplorerStore(
    (state) => state.placeConnectionGroup,
  );
  const selectExplorerNode = (
    nodeId: string,
    event?: {
      currentTarget: HTMLElement;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
  ) => {
    const result = resolveExplorerSelection({
      visibleNodeIds: event
        ? explorerTreeVisibleNodeIds(event.currentTarget)
        : [nodeId],
      selectedNodeIds: selectedExplorerNodeIds,
      targetNodeId: nodeId,
      anchorNodeId: explorerSelectionAnchorId,
      additive: Boolean(event?.ctrlKey || event?.metaKey),
      range: Boolean(event?.shiftKey),
    });
    setExplorerSelection(
      explorerStateScope,
      result.selectedNodeIds,
      result.focusedNodeId,
      result.anchorNodeId,
    );
  };
  const [expandedConnectionIds, setExpandedConnectionIds] =
    useExplorerExpansionState(explorerStateScope, "connections");
  const [expandedSchemaKeys, setExpandedSchemaKeys] = useExplorerExpansionState(
    explorerStateScope,
    "schemas",
  );
  const [expandedObjectGroupKeys, setExpandedObjectGroupKeys] =
    useExplorerExpansionState(explorerStateScope, "groups");
  const [expandedTableKeys, setExpandedTableKeys] = useExplorerExpansionState(
    explorerStateScope,
    "objects",
  );
  const explorerConnectionGroupById = useMemo(
    () => new Map(explorerConnectionGroups.map((group) => [group.id, group])),
    [explorerConnectionGroups],
  );
  const connectedConnectionIdSet = useMemo(
    () => new Set(connectedConnectionIds),
    [connectedConnectionIds],
  );
  const explorerConnectionFilterParentId = explorerNodeId(
    "folder",
    "connections",
  );
  const explorerConnectionVisibilityFilter =
    explorerVisibilityFilters[explorerConnectionFilterParentId];
  const explorerConnectionGroupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const connection of connections) {
      if (
        !explorerNodePassesVisibilityFilter(
          explorerConnectionVisibilityFilter,
          explorerNodeId("connection", connection.id),
          connection.name,
        ) ||
        (showConnectedConnectionsOnly &&
          !connectedConnectionIdSet.has(connection.id))
      ) {
        continue;
      }
      let groupId = explorerConnectionGroupIds[connection.id];
      const visited = new Set<string>();
      while (groupId && !visited.has(groupId)) {
        visited.add(groupId);
        counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
        groupId = explorerConnectionGroupById.get(groupId)?.parentId ?? "";
      }
    }
    return counts;
  }, [
    connections,
    connectedConnectionIdSet,
    explorerConnectionGroupById,
    explorerConnectionGroupIds,
    explorerConnectionVisibilityFilter,
    showConnectedConnectionsOnly,
  ]);
  useEffect(() => {
    if (showConnectedConnectionsOnly && connectedConnectionIds.length === 0) {
      setShowConnectedConnectionsOnly(false);
    }
  }, [connectedConnectionIds.length, showConnectedConnectionsOnly]);
  const visibleExplorerConnections = useMemo(() => {
    let filteredConnections = showConnectedConnectionsOnly
      ? connections.filter((connection) =>
          connectedConnectionIdSet.has(connection.id),
        )
      : connections;
    filteredConnections = filteredConnections.filter((connection) =>
      explorerNodePassesVisibilityFilter(
        explorerConnectionVisibilityFilter,
        explorerNodeId("connection", connection.id),
        connection.name,
      ),
    );
    if (explorerFilterScope === "connections" && deferredFilterText.trim()) {
      filteredConnections = filteredConnections.filter((connection) =>
        explorerFilterMatches(
          connection.name,
          connection.driver,
          connection.database,
        ),
      );
    }
    const groupOrder = new Map(
      orderedExplorerConnectionGroups.map((group, index) => [group.id, index]),
    );
    const manualOrder = new Map(
      explorerConnectionOrder.map((connectionId, index) => [
        connectionId,
        index,
      ]),
    );
    const sourceOrder = new Map(
      connections.map((connection, index) => [connection.id, index]),
    );
    return [...filteredConnections].sort((left, right) => {
      const leftGroup = explorerConnectionGroupIds[left.id];
      const rightGroup = explorerConnectionGroupIds[right.id];
      const leftOrder = leftGroup
        ? (groupOrder.get(leftGroup) ?? Number.MAX_SAFE_INTEGER - 1)
        : Number.MAX_SAFE_INTEGER;
      const rightOrder = rightGroup
        ? (groupOrder.get(rightGroup) ?? Number.MAX_SAFE_INTEGER - 1)
        : Number.MAX_SAFE_INTEGER;
      const groupDifference = leftOrder - rightOrder;
      if (groupDifference) return groupDifference;
      if (explorerConnectionSortMode === "manual") {
        return (
          (manualOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (manualOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
          (sourceOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (sourceOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        );
      }
      const nameDifference = left.name.localeCompare(right.name);
      return explorerConnectionSortMode === "desc"
        ? -nameDifference
        : nameDifference;
    });
  }, [
    connections,
    connectedConnectionIdSet,
    deferredFilterText,
    explorerConnectionGroupIds,
    orderedExplorerConnectionGroups,
    explorerConnectionOrder,
    explorerConnectionSortMode,
    explorerConnectionVisibilityFilter,
    explorerFilterMatches,
    explorerFilterScope,
    showConnectedConnectionsOnly,
  ]);
  const explorerScrollRef = useRef<HTMLDivElement>(null);
  const [explorerScrollMetrics, setExplorerScrollMetrics] = useState({
    scrollTop: 0,
    viewportHeight: 640,
  });
  const canVirtualizeConnectionRows =
    explorerConnectionGroups.length === 0 && expandedConnectionIds.length === 0;
  const [connectionVirtualizationArmed, setConnectionVirtualizationArmed] =
    useState(
      () =>
        canVirtualizeConnectionRows &&
        nextExplorerVirtualizationState(
          false,
          visibleExplorerConnections.length,
        ),
    );
  useEffect(() => {
    setConnectionVirtualizationArmed((armed) =>
      canVirtualizeConnectionRows
        ? nextExplorerVirtualizationState(
            armed,
            visibleExplorerConnections.length,
          )
        : false,
    );
  }, [canVirtualizeConnectionRows, visibleExplorerConnections.length]);
  useEffect(() => {
    const scroller = explorerScrollRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const updateViewport = () =>
      setExplorerScrollMetrics((current) => ({
        ...current,
        viewportHeight: scroller.clientHeight || current.viewportHeight,
      }));
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);
  const connectionVirtualWindow = useMemo(
    () =>
      connectionVirtualizationArmed
        ? explorerVirtualWindow(
            visibleExplorerConnections.length,
            explorerScrollMetrics.scrollTop,
            explorerScrollMetrics.viewportHeight,
            explorerTreeRowHeight,
          )
        : {
            start: 0,
            end: visibleExplorerConnections.length,
            offsetTop: 0,
            totalHeight:
              visibleExplorerConnections.length * explorerTreeRowHeight,
          },
    [
      connectionVirtualizationArmed,
      explorerScrollMetrics.scrollTop,
      explorerScrollMetrics.viewportHeight,
      explorerTreeRowHeight,
      visibleExplorerConnections.length,
    ],
  );
  const renderedExplorerConnections = connectionVirtualizationArmed
    ? visibleExplorerConnections.slice(
        connectionVirtualWindow.start,
        connectionVirtualWindow.end,
      )
    : visibleExplorerConnections;

  return {
    explorerStateScope,
    selectedExplorerNodeIds,
    explorerViewMode,
    explorerFilterScope,
    explorerSearchMode,
    explorerRegexSearch,
    explorerConnectionSortMode,
    explorerVisibilityFilters,
    explorerTreeRowHeight,
    setExplorerViewMode,
    setExplorerFilterScope,
    setExplorerSearchMode,
    setExplorerRegexSearch,
    setExplorerConnectionSortMode,
    setExplorerConnectionOrder,
    hideExplorerNodes,
    showOnlyExplorerNodes,
    clearExplorerVisibilityFilter,
    setExplorerVisibilityPatterns,
    explorerSearchPattern,
    explorerFilterMatches,
    openExplorerVisibilityFilter,
    explorerConnectionGroups,
    orderedExplorerConnectionGroups,
    explorerConnectionGroupIds,
    createExplorerConnectionGroup,
    renameExplorerConnectionGroup,
    deleteExplorerConnectionGroup,
    moveExplorerConnectionsToGroup,
    moveExplorerConnectionGroup,
    placeExplorerConnectionGroup,
    selectExplorerNode,
    expandedConnectionIds,
    setExpandedConnectionIds,
    expandedSchemaKeys,
    setExpandedSchemaKeys,
    expandedObjectGroupKeys,
    setExpandedObjectGroupKeys,
    expandedTableKeys,
    setExpandedTableKeys,
    explorerConnectionGroupById,
    explorerConnectionFilterParentId,
    explorerConnectionVisibilityFilter,
    explorerConnectionGroupCounts,
    visibleExplorerConnections,
    explorerScrollRef,
    setExplorerScrollMetrics,
    connectionVirtualizationArmed,
    connectionVirtualWindow,
    renderedExplorerConnections,
  };
}
