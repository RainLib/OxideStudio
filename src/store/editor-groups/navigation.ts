import type {
  EditorGroupId,
  EditorGroupNode,
  EditorLayoutNode,
  EditorSplitDirection,
} from "./contracts";
import { editorGroups } from "./layoutTree";

type EditorGroupRect = {
  group: EditorGroupNode;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function editorGroupRects(
  node: EditorLayoutNode,
  bounds = { left: 0, top: 0, right: 1, bottom: 1 },
): EditorGroupRect[] {
  if (node.type === "group") return [{ group: node, ...bounds }];
  const horizontal = node.direction === "left" || node.direction === "right";
  if (horizontal) {
    const middle = (bounds.left + bounds.right) / 2;
    return [
      ...editorGroupRects(node.children[0], { ...bounds, right: middle }),
      ...editorGroupRects(node.children[1], { ...bounds, left: middle }),
    ];
  }
  const middle = (bounds.top + bounds.bottom) / 2;
  return [
    ...editorGroupRects(node.children[0], { ...bounds, bottom: middle }),
    ...editorGroupRects(node.children[1], { ...bounds, top: middle }),
  ];
}

export function editorGroupInDirection(
  root: EditorLayoutNode,
  currentGroupId: EditorGroupId,
  direction: EditorSplitDirection,
): EditorGroupNode | null {
  const rects = editorGroupRects(root);
  const current = rects.find((rect) => rect.group.id === currentGroupId);
  if (!current) return null;
  const currentX = (current.left + current.right) / 2;
  const currentY = (current.top + current.bottom) / 2;
  const candidates = rects
    .filter((rect) => {
      if (rect.group.id === currentGroupId) return false;
      const x = (rect.left + rect.right) / 2;
      const y = (rect.top + rect.bottom) / 2;
      if (direction === "left") return x < currentX;
      if (direction === "right") return x > currentX;
      if (direction === "up") return y < currentY;
      return y > currentY;
    })
    .map((rect) => {
      const x = (rect.left + rect.right) / 2;
      const y = (rect.top + rect.bottom) / 2;
      const primary =
        direction === "left" || direction === "right"
          ? Math.abs(x - currentX)
          : Math.abs(y - currentY);
      const secondary =
        direction === "left" || direction === "right"
          ? Math.abs(y - currentY)
          : Math.abs(x - currentX);
      const overlapsCrossAxis =
        direction === "left" || direction === "right"
          ? rect.bottom > current.top && rect.top < current.bottom
          : rect.right > current.left && rect.left < current.right;
      return {
        rect,
        score: (overlapsCrossAxis ? 0 : 100) + primary * 10 + secondary,
      };
    })
    .sort((left, right) => left.score - right.score);
  return candidates[0]?.rect.group || null;
}

export function adjacentEditorGroup(
  root: EditorLayoutNode,
  currentGroupId: EditorGroupId,
  reverse = false,
): EditorGroupNode | null {
  const groups = editorGroups(root);
  if (groups.length === 0) return null;
  const index = groups.findIndex((group) => group.id === currentGroupId);
  const currentIndex = index < 0 ? 0 : index;
  const nextIndex = reverse
    ? (currentIndex - 1 + groups.length) % groups.length
    : (currentIndex + 1) % groups.length;
  return groups[nextIndex] || null;
}
