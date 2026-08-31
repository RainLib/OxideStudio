export interface ToolbarOverflowState {
  compact: boolean;
  expandedRequiredWidth: number;
}

export function resolveToolbarOverflowState(
  current: ToolbarOverflowState,
  clientWidth: number,
  scrollWidth: number,
): ToolbarOverflowState {
  if (current.compact) {
    return clientWidth >= current.expandedRequiredWidth
      ? { compact: false, expandedRequiredWidth: 0 }
      : current;
  }
  return scrollWidth > clientWidth + 1
    ? { compact: true, expandedRequiredWidth: scrollWidth }
    : current;
}
