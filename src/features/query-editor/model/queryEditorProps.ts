import type { VimWindowNavigation } from "@/lib/vimMode";

export interface QueryEditorProps {
  tabId?: string | null;
  isActivePane?: boolean;
  onActivate?: () => void;
  editorGroupId?: string;
  onVimWindowNavigate?: (direction: VimWindowNavigation) => void;
}
