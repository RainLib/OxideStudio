import { toMonacoKeybinding } from "@/features/query-editor/model/completionProviderRuntime";
import {
  APP_EVENT_INLINE_COMPLETION_ACCEPT,
  APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD,
  APP_EVENT_INLINE_COMPLETION_HIDE,
  APP_EVENT_INLINE_COMPLETION_TRIGGER,
} from "@/lib/actionEvents";
import { saveEditorFileTab } from "@/lib/editorFileSave";
import { normalizeKeybinding } from "@/lib/keybindings";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";
import {
  APP_EVENT_VIM_WINDOW_NAVIGATE,
  attachVimMode,
  restoreStandardEditorState,
  type VimModeController,
} from "@/lib/vimMode";
import { useTabStore } from "@/store/useTabStore";
import { useEffect } from "react";

interface EditorKeyboardBindingsContext {
  inlineKeysContextRef: React.RefObject<{
    set: (value: boolean) => void;
  } | null>;
  vimControllerRef: React.RefObject<
    import("@/lib/vimMode").VimModeController | null
  >;
  vimModeRef: React.RefObject<string>;
  mountedEditor: any;
  editorSettings: import("@/lib/appSettings").AppSettings["editor"];
  isActivePane: boolean;
  vimStatusNodeRef: React.RefObject<HTMLSpanElement | null>;
  activeTabIdRef: React.RefObject<string | null>;
  onVimWindowNavigate:
    | ((direction: import("@/lib/vimMode").VimWindowNavigation) => void)
    | undefined;
  monaco: typeof import("monaco-editor") | null;
  keymap: Record<string, string[]>;
}

export function useEditorKeyboardBindings({
  inlineKeysContextRef,
  vimControllerRef,
  vimModeRef,
  mountedEditor,
  editorSettings,
  isActivePane,
  vimStatusNodeRef,
  activeTabIdRef,
  onVimWindowNavigate,
  monaco,
  keymap,
}: EditorKeyboardBindingsContext) {
  useEffect(() => {
    return () => {
      inlineKeysContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    vimControllerRef.current?.dispose();
    vimControllerRef.current = null;
    vimModeRef.current = "INSERT";
    inlineKeysContextRef.current?.set(true);

    if (mountedEditor) restoreStandardEditorState(mountedEditor);

    if (
      editorSettings.keybindingMode !== "vim" ||
      !mountedEditor ||
      !isActivePane
    ) {
      return;
    }

    let disposed = false;
    let attachedController: VimModeController | null = null;
    void attachVimMode({
      editor: mountedEditor,
      statusNode: vimStatusNodeRef.current,
      leader: editorSettings.vim.leader,
      mappings: editorSettings.vim.mappings,
      onModeChange: (mode) => {
        vimModeRef.current = mode;
        inlineKeysContextRef.current?.set(mode === "INSERT");
      },
      onWrite: () => saveEditorFileTab(activeTabIdRef.current || undefined),
      onQuit: () => {
        const activeId = activeTabIdRef.current;
        if (activeId) useTabStore.getState().closeTab(activeId);
      },
      onWriteQuit: async () => {
        const tabId = activeTabIdRef.current;
        if (!tabId || !(await saveEditorFileTab(tabId))) return;
        useTabStore.getState().closeTab(tabId);
      },
      onEdit: async (relativePath) => {
        try {
          await openProjectFileInEditor(relativePath);
        } catch (error) {
          const tabId = activeTabIdRef.current;
          if (!tabId) return;
          const message =
            error instanceof Error ? error.message : String(error);
          useTabStore.setState((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === tabId
                ? { ...tab, fileError: `Failed to open file: ${message}` }
                : tab,
            ),
          }));
        }
      },
      onWindowNavigate: (direction) => {
        if (onVimWindowNavigate) {
          onVimWindowNavigate(direction);
          return;
        }
        window.dispatchEvent(
          new CustomEvent(APP_EVENT_VIM_WINDOW_NAVIGATE, {
            detail: { direction, source: "editor" },
          }),
        );
      },
    })
      .then((controller) => {
        if (disposed) {
          controller.dispose();
          return;
        }
        attachedController = controller;
        vimControllerRef.current = controller;
      })
      .catch((error) => {
        if (disposed) return;
        console.error("Failed to initialize Vim mode", error);
        if (vimStatusNodeRef.current) {
          vimStatusNodeRef.current.textContent = "VIM unavailable";
        }
      });

    return () => {
      disposed = true;
      attachedController?.dispose();
      if (vimControllerRef.current === attachedController) {
        vimControllerRef.current = null;
      }
      vimModeRef.current = "INSERT";
      inlineKeysContextRef.current?.set(true);
      restoreStandardEditorState(mountedEditor);
    };
  }, [
    editorSettings.keybindingMode,
    editorSettings.vim.leader,
    editorSettings.vim.mappings,
    isActivePane,
    mountedEditor,
    onVimWindowNavigate,
  ]);

  useEffect(() => {
    if (!isActivePane || !mountedEditor) return;
    mountedEditor.focus();
  }, [isActivePane, mountedEditor]);

  useEffect(() => {
    inlineKeysContextRef.current?.set(
      editorSettings.keybindingMode !== "vim" ||
        vimModeRef.current === "INSERT",
    );
  }, [editorSettings.keybindingMode, mountedEditor]);

  useEffect(() => {
    if (!isActivePane || !mountedEditor) return;
    const run = (command: string) => {
      if (
        editorSettings.keybindingMode === "vim" &&
        vimModeRef.current !== "INSERT"
      ) {
        return;
      }
      mountedEditor.trigger("oxide-inline-completion", command, null);
    };
    const handlers: Array<[string, () => void]> = [
      [
        APP_EVENT_INLINE_COMPLETION_TRIGGER,
        () => run("editor.action.inlineSuggest.trigger"),
      ],
      [
        APP_EVENT_INLINE_COMPLETION_ACCEPT,
        () => run("editor.action.inlineSuggest.commit"),
      ],
      [
        APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD,
        () => run("editor.action.inlineSuggest.acceptNextWord"),
      ],
      [
        APP_EVENT_INLINE_COMPLETION_HIDE,
        () => run("editor.action.inlineSuggest.hide"),
      ],
    ];
    handlers.forEach(([event, handler]) =>
      window.addEventListener(event, handler),
    );
    return () => {
      handlers.forEach(([event, handler]) =>
        window.removeEventListener(event, handler),
      );
    };
  }, [editorSettings.keybindingMode, isActivePane, mountedEditor]);

  useEffect(() => {
    if (!monaco) return;
    const visibleWhen =
      "oxideInlineCompletionKeysEnabled && editorTextFocus && inlineSuggestionVisible && !suggestWidgetVisible";
    const rules: Array<{
      keybinding: number;
      command?: string | null;
      when?: string;
    }> = [];
    const addRules = (actionId: string, command: string, when: string) => {
      for (const binding of keymap[actionId] || []) {
        const keybinding = toMonacoKeybinding(monaco, binding);
        if (keybinding) rules.push({ keybinding, command, when });
      }
    };
    addRules(
      "editor.inlineCompletion.trigger",
      "editor.action.inlineSuggest.trigger",
      "oxideInlineCompletionKeysEnabled && editorTextFocus",
    );
    addRules(
      "editor.inlineCompletion.accept",
      "editor.action.inlineSuggest.commit",
      visibleWhen,
    );
    addRules(
      "editor.inlineCompletion.acceptNextWord",
      "editor.action.inlineSuggest.acceptNextWord",
      visibleWhen,
    );
    addRules(
      "editor.inlineCompletion.hide",
      "editor.action.inlineSuggest.hide",
      visibleWhen,
    );

    const normalizedAccept = (
      keymap["editor.inlineCompletion.accept"] || []
    ).map(normalizeKeybinding);
    const normalizedWord = (
      keymap["editor.inlineCompletion.acceptNextWord"] || []
    ).map(normalizeKeybinding);
    const normalizedHide = (keymap["editor.inlineCompletion.hide"] || []).map(
      normalizeKeybinding,
    );
    if (!normalizedAccept.includes("tab")) {
      rules.push({
        keybinding: monaco.KeyCode.Tab,
        command: null,
        when: visibleWhen,
      });
    }
    if (!normalizedWord.includes("mod+arrowright")) {
      rules.push({
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow,
        command: null,
        when: visibleWhen,
      });
    }
    if (!normalizedHide.includes("escape")) {
      rules.push({
        keybinding: monaco.KeyCode.Escape,
        command: null,
        when: visibleWhen,
      });
    }
    const disposable = monaco.editor.addKeybindingRules(rules);
    return () => disposable.dispose();
  }, [keymap, monaco]);
}
