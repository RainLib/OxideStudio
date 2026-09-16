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

export interface EditorGroupState {
  splitDirection: EditorSplitDirection | null;
  root: EditorLayoutNode;
  activeGroup: EditorGroupId;
  split: (direction: EditorSplitDirection, tabId: string) => void;
  setActiveGroup: (group: EditorGroupId) => void;
  setGroupTab: (group: EditorGroupId, tabId: string | null) => void;
  closeGroup: (group: EditorGroupId) => void;
  reset: () => void;
}

export type EditorGroupLayoutState = Pick<
  EditorGroupState,
  "splitDirection" | "root" | "activeGroup"
>;
