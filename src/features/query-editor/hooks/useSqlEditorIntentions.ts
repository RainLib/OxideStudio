import {
  quoteSqlIdentifierSelection,
  sqlInListFromClipboard,
  unquoteSqlIdentifierSelection,
} from "@/features/query-editor/model/sqlEditorIntentions";
import type { Selection } from "monaco-editor";
import { useEffect } from "react";

interface SqlEditorIntentionsContext {
  monaco: typeof import("monaco-editor") | null;
  mountedEditor: any;
  isElasticsearchConsole: boolean;
  capabilities: import("@/services/tauri/types").DatabaseCapabilities;
  canPreviewChangesRef: React.RefObject<boolean>;
  previewChangesContextRef: React.RefObject<{
    set: (value: boolean) => void;
  } | null>;
  completionTriggerOriginRef: React.RefObject<"explicit" | "chained" | null>;
  previewChangesActionRef: React.RefObject<() => void>;
  driver: import("@/services/tauri/types").DatabaseDriver;
}

export function useSqlEditorIntentions({
  monaco,
  mountedEditor,
  isElasticsearchConsole,
  capabilities,
  canPreviewChangesRef,
  previewChangesContextRef,
  completionTriggerOriginRef,
  previewChangesActionRef,
  driver,
}: SqlEditorIntentionsContext) {
  useEffect(() => {
    if (
      !monaco ||
      !mountedEditor ||
      isElasticsearchConsole ||
      !capabilities.supportsSqlQuery
    ) {
      return;
    }
    const replaceSelections = (
      transform: (selected: string) => string | null,
    ) => {
      const model = mountedEditor.getModel();
      const selections = mountedEditor
        .getSelections()
        ?.filter((selection: Selection) => !selection.isEmpty());
      if (!model || !selections?.length) return;
      // Intentions are all-or-nothing across cursors: leaving one selected
      // identifier unmodified would make a batch edit look successful while
      // silently producing a mixed SQL document.
      const edits = [];
      for (const selection of selections) {
        const replacement = transform(model.getValueInRange(selection));
        if (replacement === null) return;
        edits.push({
          range: selection,
          text: replacement,
          forceMoveMarkers: true,
        });
      }
      mountedEditor.executeEdits("oxide.sql-intention", edits);
    };
    const previewContext = mountedEditor.createContextKey(
      "oxideDmlPreviewAvailable",
      false,
    );
    previewContext.set(canPreviewChangesRef.current);
    previewChangesContextRef.current = previewContext;
    const actions = [
      mountedEditor.addAction({
        id: "oxide.sql.triggerCompletion",
        label: "Show SQL completion suggestions",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
        run: () => {
          completionTriggerOriginRef.current = "explicit";
          mountedEditor.trigger(
            "oxide.sql.explicitCompletion",
            "editor.action.triggerSuggest",
            {},
          );
          window.setTimeout(() => {
            if (completionTriggerOriginRef.current === "explicit") {
              completionTriggerOriginRef.current = null;
            }
          }, 0);
        },
      }),
      mountedEditor.addAction({
        id: "oxide.sql.previewChanges",
        label: "Preview affected rows and new values",
        contextMenuGroupId: "oxide.sql",
        contextMenuOrder: 1,
        precondition: "oxideDmlPreviewAvailable",
        run: () => previewChangesActionRef.current(),
      }),
      mountedEditor.addAction({
        id: "oxide.sql.quoteIdentifier",
        label: "Quote selected SQL identifier",
        contextMenuGroupId: "oxide.sql",
        contextMenuOrder: 2,
        run: () =>
          replaceSelections((selected) =>
            quoteSqlIdentifierSelection(driver, selected),
          ),
      }),
      mountedEditor.addAction({
        id: "oxide.sql.unquoteIdentifier",
        label: "Unquote selected SQL identifier",
        contextMenuGroupId: "oxide.sql",
        contextMenuOrder: 3,
        run: () => replaceSelections(unquoteSqlIdentifierSelection),
      }),
      mountedEditor.addAction({
        id: "oxide.sql.pasteInList",
        label: "Paste clipboard as SQL IN list",
        contextMenuGroupId: "oxide.sql",
        contextMenuOrder: 4,
        run: async () => {
          try {
            const clipboard = await navigator.clipboard?.readText();
            const list = clipboard ? sqlInListFromClipboard(clipboard) : null;
            if (list !== null) replaceSelections(() => list);
          } catch {
            // Clipboard permission is host-controlled; leave the document
            // untouched when it is unavailable.
          }
        },
      }),
    ];
    return () => {
      actions.forEach((action) => action.dispose());
      if (previewChangesContextRef.current === previewContext) {
        previewChangesContextRef.current = null;
      }
      previewContext.set(false);
    };
  }, [
    capabilities.supportsSqlQuery,
    driver,
    isElasticsearchConsole,
    monaco,
    mountedEditor,
  ]);
}
