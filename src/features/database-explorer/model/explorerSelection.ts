export interface ExplorerSelectionInput {
  readonly visibleNodeIds: readonly string[];
  readonly selectedNodeIds: readonly string[];
  readonly targetNodeId: string;
  readonly anchorNodeId: string | null;
  readonly additive?: boolean;
  readonly range?: boolean;
}

export interface ExplorerSelectionResult {
  readonly selectedNodeIds: readonly string[];
  readonly anchorNodeId: string;
  readonly focusedNodeId: string;
}

/** Implements the selection contract used by desktop database navigators:
 * click replaces, Ctrl/Command toggles, and Shift selects a visible range. */
export function resolveExplorerSelection({
  visibleNodeIds,
  selectedNodeIds,
  targetNodeId,
  anchorNodeId,
  additive = false,
  range = false,
}: ExplorerSelectionInput): ExplorerSelectionResult {
  if (range && anchorNodeId) {
    const anchorIndex = visibleNodeIds.indexOf(anchorNodeId);
    const targetIndex = visibleNodeIds.indexOf(targetNodeId);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangeIds = visibleNodeIds.slice(start, end + 1);
      return Object.freeze({
        selectedNodeIds: Object.freeze(
          additive
            ? [...new Set([...selectedNodeIds, ...rangeIds])]
            : [...rangeIds],
        ),
        anchorNodeId,
        focusedNodeId: targetNodeId,
      });
    }
  }

  if (additive) {
    const selected = new Set(selectedNodeIds);
    if (selected.has(targetNodeId)) selected.delete(targetNodeId);
    else selected.add(targetNodeId);
    return Object.freeze({
      selectedNodeIds: Object.freeze([...selected]),
      anchorNodeId: targetNodeId,
      focusedNodeId: targetNodeId,
    });
  }

  return Object.freeze({
    selectedNodeIds: Object.freeze([targetNodeId]),
    anchorNodeId: targetNodeId,
    focusedNodeId: targetNodeId,
  });
}

export function adjacentExplorerNodeId(
  visibleNodeIds: readonly string[],
  currentNodeId: string,
  direction: -1 | 1,
) {
  const currentIndex = visibleNodeIds.indexOf(currentNodeId);
  if (currentIndex < 0) return null;
  return (
    visibleNodeIds[
      Math.max(0, Math.min(visibleNodeIds.length - 1, currentIndex + direction))
    ] ?? null
  );
}
