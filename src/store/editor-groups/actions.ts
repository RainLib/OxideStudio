import type { StoreApi } from "zustand";
import type {
  EditorGroupNode,
  EditorGroupState,
  EditorSplitDirection,
  EditorSplitNode,
} from "./contracts";
import {
  createInitialEditorGroupLayout,
  editorGroups,
  removeEditorGroup,
  updateEditorGroup,
} from "./layoutTree";
import { createEditorGroupId, createEditorSplitId } from "./nodeIds";

type EditorGroupActions = Pick<
  EditorGroupState,
  "split" | "setActiveGroup" | "setGroupTab" | "closeGroup" | "reset"
>;

export function createEditorGroupActions(
  set: StoreApi<EditorGroupState>["setState"],
): EditorGroupActions {
  return {
    split: (direction: EditorSplitDirection, tabId: string) => {
      set((state) => {
        const active = editorGroups(state.root).find(
          (group) => group.id === state.activeGroup,
        );
        const sourceTabId = active?.tabId || tabId;
        const newGroup: EditorGroupNode = {
          type: "group",
          id: createEditorGroupId(),
          tabId,
        };
        const existingGroup: EditorGroupNode = active
          ? { ...active, tabId: sourceTabId }
          : { type: "group", id: state.activeGroup, tabId: sourceTabId };
        const secondaryFirst = direction === "left" || direction === "up";
        const splitNode: EditorSplitNode = {
          type: "split",
          id: createEditorSplitId(),
          direction,
          children: secondaryFirst
            ? [newGroup, existingGroup]
            : [existingGroup, newGroup],
        };
        const root = updateEditorGroup(
          state.root,
          state.activeGroup,
          () => splitNode,
        );
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
        state.activeGroup === activeGroup ? state : { activeGroup },
      ),
    setGroupTab: (group, tabId) =>
      set((state) => {
        const root = updateEditorGroup(state.root, group, (node) => ({
          ...node,
          tabId,
        }));
        return root === state.root ? state : { root };
      }),
    closeGroup: (group) => {
      set((state) => {
        const root = removeEditorGroup(state.root, group);
        if (!root) return createInitialEditorGroupLayout();
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
    reset: () => set(createInitialEditorGroupLayout()),
  };
}
