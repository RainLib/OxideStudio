import { buildQueryEditorOptions } from "@/features/query-editor/model/editorOptions";
import type { AppSettings } from "@/features/settings/model/settingsTypes";
import { registerElasticsearchConsoleLanguage } from "@/lib/elasticsearchConsole";
import { registerMongoDbConsoleLanguage } from "@/lib/mongodbCompletion";
import { ThemeContext } from "@/theme/ThemeProvider";
import { useCallback, useContext, useEffect, useMemo } from "react";

interface EditorPresentationOptions {
  editorSettings: AppSettings["editor"];
  isElasticsearchConsole: boolean;
  editorRef: React.RefObject<any>;
  setMountedEditor: React.Dispatch<any>;
  inlineKeysContextRef: React.RefObject<{
    set: (value: boolean) => void;
  } | null>;
  monaco: typeof import("monaco-editor") | null;
  mountedEditor: any;
  editorLanguageId: string;
  documentUri: string;
}

export function useEditorPresentation({
  editorSettings,
  isElasticsearchConsole,
  editorRef,
  setMountedEditor,
  inlineKeysContextRef,
  monaco,
  mountedEditor,
  editorLanguageId,
  documentUri,
}: EditorPresentationOptions) {
  const { mode } = (useContext(ThemeContext) as any) || { mode: "dark" };
  const editorOptions = useMemo(
    () => buildQueryEditorOptions(editorSettings, isElasticsearchConsole),
    [
      editorSettings.fontSize,
      editorSettings.keybindingMode,
      editorSettings.inlineCompletion.enabled,
      editorSettings.minimap,
      editorSettings.sqlCompletion.triggerMode,
      editorSettings.tabSize,
      editorSettings.vim.relativeLineNumbers,
      editorSettings.wordWrap,
      isElasticsearchConsole,
    ],
  );

  const handleEditorMount = useCallback(
    (editor: any, monacoInstance: any) => {
      // Keep this callback stable across execution/result state updates. The
      // Monaco React wrapper is memoized; changing this prop needlessly sends
      // the editor subtree through another render on every query run.
      if (!editor || !monacoInstance) return;
      editorRef.current = editor;
      setMountedEditor(editor);
      inlineKeysContextRef.current = editor.createContextKey(
        "oxideInlineCompletionKeysEnabled",
        editorSettings.keybindingMode !== "vim",
      );
      monacoInstance.editor.setTheme(mode === "light" ? "vs" : "oxide-dark");
    },
    [editorSettings.keybindingMode, mode],
  );

  const handleEditorBeforeMount = useCallback((monacoInstance: any) => {
    registerElasticsearchConsoleLanguage(monacoInstance);
    registerMongoDbConsoleLanguage(monacoInstance);
    monacoInstance.editor.defineTheme("oxide-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#1c1d20",
        "editorLineNumber.foreground": "#6f7786",
        "editorCursor.foreground": "#75a7ff",
        "editor.selectionBackground": "#2c4573",
        "editor.inactiveSelectionBackground": "#263247",
        "editor.lineHighlightBackground": "#24272d",
        "editorIndentGuide.background1": "#2a2d33",
        "editorIndentGuide.activeBackground1": "#414754",
        "editorRuler.foreground": "#2b2e34",
        "editorGutter.background": "#1c1d20",
        "editorWidget.background": "#272a30",
        "editorWidget.border": "#3a414d",
        "editorSuggestWidget.background": "#272a30",
        "editorSuggestWidget.border": "#3a414d",
        "editorSuggestWidget.foreground": "#e1e5eb",
        "editorSuggestWidget.selectedBackground": "#354967",
        "editorSuggestWidget.selectedForeground": "#f2f5f9",
        "editorSuggestWidget.highlightForeground": "#8db8ff",
        "editorSuggestWidget.focusHighlightForeground": "#c5dcff",
        "editorSuggestWidgetStatus.foreground": "#aeb7c4",
        "editorHoverWidget.background": "#272a30",
        "editorHoverWidget.border": "#3a414d",
      },
    });
  }, []);

  // Update Monaco theme when app theme changes
  useEffect(() => {
    if (!monaco) return;
    monaco.editor.setTheme(mode === "light" ? "vs" : "oxide-dark");
  }, [monaco, mode]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model || model.getLanguageId() === editorLanguageId) return;
    monaco.editor.setModelLanguage(model, editorLanguageId);
  }, [documentUri, editorLanguageId, monaco, mountedEditor]);

  return { mode, editorOptions, handleEditorMount, handleEditorBeforeMount };
}
