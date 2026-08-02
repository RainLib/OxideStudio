import type { AppSettings } from "@/lib/appSettings";
import { QUERY_EDITOR_OPTIONS } from "./defaultEditorOptions";

type EditorPreferences = Pick<
  AppSettings["editor"],
  | "fontSize"
  | "tabSize"
  | "wordWrap"
  | "minimap"
  | "inlineCompletion"
  | "keybindingMode"
  | "vim"
>;

/**
 * Keep Monaco's mutable option object independent of execution/result state.
 * The caller can memoize this solely by editor preferences and query language.
 */
export function buildQueryEditorOptions(
  preferences: EditorPreferences,
  isElasticsearchConsole: boolean,
) {
  return {
    ...QUERY_EDITOR_OPTIONS,
    fontSize: preferences.fontSize,
    tabSize: preferences.tabSize,
    wordWrap: preferences.wordWrap,
    minimap: { enabled: preferences.minimap },
    glyphMargin: isElasticsearchConsole,
    inlineSuggest: { enabled: preferences.inlineCompletion.enabled },
    lineNumbers:
      preferences.keybindingMode === "vim" &&
      preferences.vim.relativeLineNumbers
        ? ("relative" as const)
        : ("on" as const),
  };
}
