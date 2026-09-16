import type { EditorSplitDirection } from "@/store/useEditorGroupStore";

export interface TabBarProps {
  activeTabIdOverride?: string | null;
  queryOnly?: boolean;
  allowSplit?: boolean;
  compact?: boolean;
  onSelectTab?: (tabId: string) => void;
  onCloseGroup?: () => void;
}

export type TabDragState = {
  draggedId: string;
  targetId: string | null;
  position: "before" | "after" | null;
};

export type TabSplitDirection = EditorSplitDirection;
