import type {
  EditorGroupId,
  EditorGroupLayoutState,
  EditorGroupNode,
  EditorLayoutNode,
} from "./contracts";

export function createInitialEditorGroupLayout(): EditorGroupLayoutState {
  return {
    splitDirection: null,
    root: { type: "group", id: "primary", tabId: null },
    activeGroup: "primary",
  };
}

export function editorGroups(node: EditorLayoutNode): EditorGroupNode[] {
  if (node.type === "group") return [node];
  return [...editorGroups(node.children[0]), ...editorGroups(node.children[1])];
}

export function updateEditorGroup(
  node: EditorLayoutNode,
  groupId: EditorGroupId,
  update: (group: EditorGroupNode) => EditorLayoutNode,
): EditorLayoutNode {
  if (node.type === "group") return node.id === groupId ? update(node) : node;
  const left = updateEditorGroup(node.children[0], groupId, update);
  const right = updateEditorGroup(node.children[1], groupId, update);
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}

export function removeEditorGroup(
  node: EditorLayoutNode,
  groupId: EditorGroupId,
): EditorLayoutNode | null {
  if (node.type === "group") return node.id === groupId ? null : node;
  const left = removeEditorGroup(node.children[0], groupId);
  const right = removeEditorGroup(node.children[1], groupId);
  if (!left) return right;
  if (!right) return left;
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}
