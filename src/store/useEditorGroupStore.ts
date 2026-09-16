import { createEditorGroupStore } from "./editor-groups/createEditorGroupStore";

export type {
  EditorGroupId,
  EditorGroupNode,
  EditorLayoutNode,
  EditorSplitDirection,
  EditorSplitNode,
} from "./editor-groups/contracts";
export { editorGroups } from "./editor-groups/layoutTree";
export {
  adjacentEditorGroup,
  editorGroupInDirection,
} from "./editor-groups/navigation";

/** Stable Zustand entry point for the split-editor layout state machine. */
export const useEditorGroupStore = createEditorGroupStore();
