import type { ExplorerTreeNode } from "../model/explorerTreeNode";

export const EXPLORER_TREE_ROW_HEIGHT = 28;
export const EXPLORER_COMPACT_TREE_ROW_HEIGHT = 22;
export const EXPLORER_TREE_VIRTUALIZE_THRESHOLD = 500;
export const EXPLORER_TREE_VIRTUALIZE_HYSTERESIS = 50;
export const EXPLORER_TREE_SCROLL_BUFFER = 600;
export const EXPLORER_TREE_PRERENDER_COUNT = 48;

export interface FlatExplorerNode {
  readonly node: ExplorerTreeNode;
  readonly depth: number;
  readonly id: string;
  readonly renderKey: string;
  readonly poolType: string;
}

export interface ExplorerFlatTreeIndex {
  readonly visibleNodes: readonly ExplorerTreeNode[];
  readonly nodeById: ReadonlyMap<string, ExplorerTreeNode>;
  readonly flatNodeIndexById: ReadonlyMap<string, number>;
  readonly expandableNodeIds: readonly string[];
}

export function appendExplorerRenderKey(
  parentRenderKey: string,
  node: Pick<ExplorerTreeNode, "id" | "kind">,
) {
  return `${parentRenderKey}${node.kind.length}:${node.kind}${node.id.length}:${node.id}`;
}

export function flattenExplorerTree(
  roots: readonly ExplorerTreeNode[],
  expandedNodeIds: ReadonlySet<string>,
) {
  const result: FlatExplorerNode[] = [];
  const visit = (
    nodes: readonly ExplorerTreeNode[],
    depth: number,
    parentRenderKey: string,
  ) => {
    for (const node of nodes) {
      const renderKey = appendExplorerRenderKey(parentRenderKey, node);
      result.push({
        node,
        depth,
        id: node.id,
        renderKey,
        poolType:
          node.kind === "folder" ? `${node.kind}:${node.id}` : node.kind,
      });
      if (expandedNodeIds.has(node.id) && node.children?.length) {
        visit(node.children, depth + 1, renderKey);
      }
    }
  };
  visit(roots, 0, "");
  return result;
}

export function createExplorerFlatTreeIndex(
  rows: readonly FlatExplorerNode[],
): ExplorerFlatTreeIndex {
  const visibleNodes: ExplorerTreeNode[] = [];
  const nodeById = new Map<string, ExplorerTreeNode>();
  const flatNodeIndexById = new Map<string, number>();
  const expandableNodeIds: string[] = [];
  rows.forEach((row, index) => {
    visibleNodes.push(row.node);
    nodeById.set(row.id, row.node);
    flatNodeIndexById.set(row.id, index);
    if (row.node.expandable || row.node.children?.length) {
      expandableNodeIds.push(row.id);
    }
  });
  return {
    visibleNodes: Object.freeze(visibleNodes),
    nodeById,
    flatNodeIndexById,
    expandableNodeIds: Object.freeze(expandableNodeIds),
  };
}

export function flatExplorerRowsChanged(
  rows: readonly FlatExplorerNode[],
  previousRows: readonly FlatExplorerNode[] | undefined,
) {
  if (!previousRows || rows.length !== previousRows.length) return true;
  return rows.some((row, index) => {
    const previous = previousRows[index];
    return (
      !previous ||
      row.renderKey !== previous.renderKey ||
      row.poolType !== previous.poolType ||
      row.depth !== previous.depth
    );
  });
}

export function shouldVirtualizeExplorerTree(rowCount: number) {
  return rowCount >= EXPLORER_TREE_VIRTUALIZE_THRESHOLD;
}

export function nextExplorerVirtualizationState(
  armed: boolean,
  rowCount: number,
) {
  if (armed) {
    return (
      rowCount >=
      EXPLORER_TREE_VIRTUALIZE_THRESHOLD - EXPLORER_TREE_VIRTUALIZE_HYSTERESIS
    );
  }
  return shouldVirtualizeExplorerTree(rowCount);
}

export interface ExplorerVirtualWindow {
  readonly start: number;
  readonly end: number;
  readonly offsetTop: number;
  readonly totalHeight: number;
}

export function explorerVirtualWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = EXPLORER_TREE_ROW_HEIGHT,
  buffer = EXPLORER_TREE_SCROLL_BUFFER,
): ExplorerVirtualWindow {
  const safeRowHeight = Math.max(1, rowHeight);
  const start = Math.min(
    rowCount,
    Math.max(0, Math.floor((scrollTop - buffer) / safeRowHeight)),
  );
  const end = Math.max(
    start,
    Math.min(
      rowCount,
      Math.ceil((scrollTop + viewportHeight + buffer) / safeRowHeight),
    ),
  );
  return Object.freeze({
    start,
    end,
    offsetTop: start * safeRowHeight,
    totalHeight: rowCount * safeRowHeight,
  });
}
