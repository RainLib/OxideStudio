import type { ExplorerConnectionGroup } from "@/store/useDatabaseExplorerStore";

export type ExplorerGroupDropPlacement = "before" | "inside" | "after";

/**
 * Turns the persisted flat group list into the visual pre-order used by the
 * Explorer. Sibling order remains stable, while descendants always stay under
 * their parent even when a subgroup was created after unrelated root groups.
 * Malformed orphan/cyclic records are retained once as safe root fallbacks.
 */
export function orderExplorerConnectionGroups(
  groups: readonly ExplorerConnectionGroup[],
): ExplorerConnectionGroup[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const children = new Map<string | null, ExplorerConnectionGroup[]>();
  for (const group of groups) {
    const parentId =
      group.parentId &&
      group.parentId !== group.id &&
      groupById.has(group.parentId)
        ? group.parentId
        : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(group);
    children.set(parentId, siblings);
  }

  const result: ExplorerConnectionGroup[] = [];
  const visited = new Set<string>();
  const visit = (group: ExplorerConnectionGroup) => {
    if (visited.has(group.id)) return;
    visited.add(group.id);
    result.push(group);
    for (const child of children.get(group.id) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);
  for (const group of groups) visit(group);
  return result;
}

export function placeExplorerConnectionGroup(
  groups: readonly ExplorerConnectionGroup[],
  groupId: string,
  targetId: string,
  placement: ExplorerGroupDropPlacement,
): ExplorerConnectionGroup[] {
  if (groupId === targetId) return [...groups];
  const moving = groups.find((group) => group.id === groupId);
  const target = groups.find((group) => group.id === targetId);
  if (!moving || !target) return [...groups];

  const parentId = placement === "inside" ? target.id : target.parentId;
  let ancestorId = parentId;
  const visited = new Set<string>();
  while (ancestorId && !visited.has(ancestorId)) {
    if (ancestorId === groupId) return [...groups];
    visited.add(ancestorId);
    ancestorId =
      groups.find((group) => group.id === ancestorId)?.parentId ?? null;
  }

  const nextMoving = { ...moving, parentId };
  const remaining = groups.filter((group) => group.id !== groupId);
  const targetIndex = remaining.findIndex((group) => group.id === targetId);
  if (targetIndex < 0) return [...groups];
  let insertionIndex = targetIndex + (placement === "before" ? 0 : 1);
  if (placement === "inside") {
    const descendants = new Set([targetId]);
    let discovered = true;
    while (discovered) {
      discovered = false;
      for (const candidate of remaining) {
        if (
          candidate.parentId &&
          descendants.has(candidate.parentId) &&
          !descendants.has(candidate.id)
        ) {
          descendants.add(candidate.id);
          discovered = true;
        }
      }
    }
    insertionIndex =
      remaining.reduce(
        (lastIndex, candidate, index) =>
          descendants.has(candidate.id) ? index : lastIndex,
        targetIndex,
      ) + 1;
  }
  return [
    ...remaining.slice(0, insertionIndex),
    nextMoving,
    ...remaining.slice(insertionIndex),
  ];
}
