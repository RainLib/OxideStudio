import type { AppSettings } from "@/lib/appSettings";
import { QUERY_EDITOR_OPTIONS } from "./defaultEditorOptions";

type EditorPreferences = Pick<
  AppSettings["editor"],
  | "fontSize"
  | "tabSize"
  | "wordWrap"
  | "minimap"
  | "sqlCompletion"
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
  const automaticCompletion = preferences.sqlCompletion.triggerMode !== "manual";
  return {
    ...QUERY_EDITOR_OPTIONS,
    fontSize: preferences.fontSize,
    tabSize: preferences.tabSize,
    wordWrap: preferences.wordWrap,
    minimap: { enabled: preferences.minimap },
    glyphMargin: isElasticsearchConsole,
    inlineSuggest: { enabled: preferences.inlineCompletion.enabled },
    // Monaco's native tab-completion command waits for the completion model
    // to settle, accepts the best applicable item, and falls back to the
    // normal Tab edit when no candidate is returned. It also yields to active
    // snippet tab stops. This closes the fast "type, then Tab" race without a
    // second polling loop in React. Manual mode keeps Tab as indentation.
    tabCompletion: automaticCompletion ? ("on" as const) : ("off" as const),
    quickSuggestions: automaticCompletion
      ? { other: true, comments: false, strings: false }
      : false,
    suggestOnTriggerCharacters: automaticCompletion,
    lineNumbers:
      preferences.keybindingMode === "vim" &&
      preferences.vim.relativeLineNumbers
        ? ("relative" as const)
        : ("on" as const),
  };
}
