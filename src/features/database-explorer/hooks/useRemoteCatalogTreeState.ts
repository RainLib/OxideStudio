import { resolveExplorerSelection } from "@/features/database-explorer/model/explorerSelection";
import {
  EXPLORER_COMPACT_TREE_ROW_HEIGHT,
  EXPLORER_TREE_ROW_HEIGHT,
} from "@/features/database-explorer/runtime/explorerFlatTree";
import { explorerTreeVisibleNodeIds } from "@/features/database-explorer/runtime/explorerTreeDom";
import {
  EMPTY_EXPLORER_NODE_IDS,
  useDatabaseExplorerStore,
  useExplorerExpansionSetState,
} from "@/store/useDatabaseExplorerStore";
import { useId } from "react";

interface UseRemoteCatalogTreeStateContext {
  explorerScopeId: string | undefined;
  connectionId: string;
  database: string;
}

export function useRemoteCatalogTreeState({
  explorerScopeId,
  connectionId,
  database,
}: UseRemoteCatalogTreeStateContext) {
  const treeId = useId();
  const resolvedExplorerScopeId =
    explorerScopeId ?? `postgres-remote-tree:${treeId}`;
  const expansionNamespace = `${connectionId}:${database}`;
  const [expandedSchemas, setExpandedSchemas] = useExplorerExpansionSetState(
    resolvedExplorerScopeId,
    "schemas",
    expansionNamespace,
  );
  const [expandedGroups, setExpandedGroups] = useExplorerExpansionSetState(
    resolvedExplorerScopeId,
    "groups",
    expansionNamespace,
  );
  const [expandedTables, setExpandedTables] = useExplorerExpansionSetState(
    resolvedExplorerScopeId,
    "objects",
    `${expansionNamespace}:relations`,
  );
  const [expandedObjectKeys, setExpandedObjectKeys] =
    useExplorerExpansionSetState(
      resolvedExplorerScopeId,
      "objects",
      `${expansionNamespace}:members`,
    );
  const selectedNodeIds = useDatabaseExplorerStore(
    (state) =>
      state.scopes[resolvedExplorerScopeId]?.selectedNodeIds ??
      EMPTY_EXPLORER_NODE_IDS,
  );
  const selectionAnchorId = useDatabaseExplorerStore(
    (state) => state.scopes[resolvedExplorerScopeId]?.selectionAnchorId ?? null,
  );
  const setSelection = useDatabaseExplorerStore((state) => state.setSelection);
  const explorerViewMode = useDatabaseExplorerStore(
    (state) =>
      state.scopes[resolvedExplorerScopeId]?.viewMode ?? "hierarchical",
  );
  const explorerTreeRowHeight =
    explorerViewMode === "flat"
      ? EXPLORER_COMPACT_TREE_ROW_HEIGHT
      : EXPLORER_TREE_ROW_HEIGHT;
  const selectNode = (
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
      selectedNodeIds,
      targetNodeId: nodeId,
      anchorNodeId: selectionAnchorId,
      additive: Boolean(event?.ctrlKey || event?.metaKey),
      range: Boolean(event?.shiftKey),
    });
    setSelection(
      resolvedExplorerScopeId,
      result.selectedNodeIds,
      result.focusedNodeId,
      result.anchorNodeId,
    );
  };

  return {
    expandedSchemas,
    setExpandedSchemas,
    expandedGroups,
    setExpandedGroups,
    expandedTables,
    setExpandedTables,
    expandedObjectKeys,
    setExpandedObjectKeys,
    selectedNodeIds,
    explorerTreeRowHeight,
    selectNode,
  };
}
