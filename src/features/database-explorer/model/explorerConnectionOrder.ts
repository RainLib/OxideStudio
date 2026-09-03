export type ExplorerDropPlacement = "before" | "after";

export function reorderExplorerConnectionIds(
  currentIds: readonly string[],
  draggedIds: readonly string[],
  targetId: string,
  placement: ExplorerDropPlacement,
) {
  const dragged = new Set(draggedIds);
  if (dragged.size === 0 || dragged.has(targetId)) return [...currentIds];
  const moving = currentIds.filter((id) => dragged.has(id));
  if (moving.length === 0) return [...currentIds];
  const remaining = currentIds.filter((id) => !dragged.has(id));
  const targetIndex = remaining.indexOf(targetId);
  if (targetIndex < 0) return [...currentIds];
  const insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
  return [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ];
}
