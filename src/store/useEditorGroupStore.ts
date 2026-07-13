import { create } from "zustand";

export type EditorSplitDirection = "left" | "right" | "up" | "down";
export type EditorGroupId = string;

export type EditorGroupNode = {
  type: "group";
  id: EditorGroupId;
  tabId: string | null;
};

export type EditorSplitNode = {
  type: "split";
  id: string;
  direction: EditorSplitDirection;
  children: [EditorLayoutNode, EditorLayoutNode];
};

export type EditorLayoutNode = EditorGroupNode | EditorSplitNode;

interface EditorGroupState {
  splitDirection: EditorSplitDirection | null;
  root: EditorLayoutNode;
  activeGroup: EditorGroupId;
  split: (direction: EditorSplitDirection, tabId: string) => void;
  setActiveGroup: (group: EditorGroupId) => void;
  setGroupTab: (group: EditorGroupId, tabId: string | null) => void;
  closeGroup: (group: EditorGroupId) => void;
  reset: () => void;
}

let nextNodeId = 1;

const createInitialState = () => ({
  splitDirection: null,
  root: { type: "group", id: "primary", tabId: null } as EditorLayoutNode,
  activeGroup: "primary" as EditorGroupId,
});

export function editorGroups(node: EditorLayoutNode): EditorGroupNode[] {
  if (node.type === "group") return [node];
  return [...editorGroups(node.children[0]), ...editorGroups(node.children[1])];
}

function updateGroup(
  node: EditorLayoutNode,
  groupId: EditorGroupId,
  update: (group: EditorGroupNode) => EditorLayoutNode
): EditorLayoutNode {
  if (node.type === "group") return node.id === groupId ? update(node) : node;
  const left = updateGroup(node.children[0], groupId, update);
  const right = updateGroup(node.children[1], groupId, update);
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}

function removeGroup(
  node: EditorLayoutNode,
  groupId: EditorGroupId
): EditorLayoutNode | null {
  if (node.type === "group") return node.id === groupId ? null : node;
  const left = removeGroup(node.children[0], groupId);
  const right = removeGroup(node.children[1], groupId);
  if (!left) return right;
  if (!right) return left;
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}

export const useEditorGroupStore = create<EditorGroupState>((set) => ({
  ...createInitialState(),
  split: (direction, tabId) => {
    set((state) => {
      const active = editorGroups(state.root).find(
        (group) => group.id === state.activeGroup
      );
      const sourceTabId = active?.tabId || tabId;
      const newGroup: EditorGroupNode = {
        type: "group",
        id: `group-${nextNodeId++}`,
        tabId,
      };
      const existingGroup: EditorGroupNode = active
        ? { ...active, tabId: sourceTabId }
        : { type: "group", id: state.activeGroup, tabId: sourceTabId };
      const secondaryFirst = direction === "left" || direction === "up";
      const splitNode: EditorSplitNode = {
        type: "split",
        id: `split-${nextNodeId++}`,
        direction,
        children: secondaryFirst
          ? [newGroup, existingGroup]
          : [existingGroup, newGroup],
      };
      const root = updateGroup(state.root, state.activeGroup, () => splitNode);
      return {
        root,
        splitDirection:
          root.type === "split" ? root.direction : state.splitDirection,
        activeGroup: newGroup.id,
      };
    });
  },
  setActiveGroup: (activeGroup) =>
    set((state) =>
      state.activeGroup === activeGroup ? state : { activeGroup }
    ),
  setGroupTab: (group, tabId) =>
    set((state) => {
      const root = updateGroup(state.root, group, (node) => ({ ...node, tabId }));
      return root === state.root ? state : { root };
    }),
  closeGroup: (group) => {
    set((state) => {
      const root = removeGroup(state.root, group);
      if (!root) return createInitialState();
      const groups = editorGroups(root);
      const activeGroup = groups.some((item) => item.id === state.activeGroup)
        ? state.activeGroup
        : groups[0]?.id || "primary";
      return {
        root,
        activeGroup,
        splitDirection: root.type === "split" ? root.direction : null,
      };
    });
  },
  reset: () => set(createInitialState()),
}));
