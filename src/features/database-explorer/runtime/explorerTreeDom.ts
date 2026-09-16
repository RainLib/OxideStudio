export function visibleExplorerTreeItems(current: HTMLElement) {
  const tree = current.closest<HTMLElement>("[role='tree']");
  if (!tree) return [];
  return [...tree.querySelectorAll<HTMLElement>("[role='treeitem']")].filter(
    (item) => !item.hidden && item.getAttribute("aria-disabled") !== "true",
  );
}

export function moveExplorerTreeFocus(current: HTMLElement, direction: -1 | 1) {
  const items = visibleExplorerTreeItems(current);
  const currentIndex = items.indexOf(current);
  if (currentIndex < 0) return null;
  const next =
    items[Math.max(0, Math.min(items.length - 1, currentIndex + direction))] ??
    null;
  next?.focus();
  return next?.dataset.explorerNodeId ?? null;
}

export function explorerTreeVisibleNodeIds(current: HTMLElement) {
  return visibleExplorerTreeItems(current)
    .map((item) => item.dataset.explorerNodeId)
    .filter((id): id is string => Boolean(id));
}
