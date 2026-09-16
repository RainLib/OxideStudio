import { insertLineBelow } from "@/features/query-editor/model/editorLineActions";
import {
  APP_EVENT_FORMAT_SQL,
  APP_EVENT_INSERT_LINE_BELOW,
  APP_EVENT_RUN_CURRENT,
  APP_EVENT_RUN_QUERY,
} from "@/lib/actionEvents";
import {
  APP_EVENT_REVEAL_EDITOR_RANGE,
  type EditorRangeNavigationDetail,
} from "@/lib/editorNavigation";
import { useEffect } from "react";

interface EditorApplicationEventsOptions {
  isActivePane: boolean;
  runAllActionRef: React.RefObject<() => void>;
  runCurrentActionRef: React.RefObject<() => void>;
  formatActionRef: React.RefObject<() => void>;
  editorRef: React.RefObject<any>;
  effectiveTabId: string | null;
}

export function useEditorApplicationEvents({
  isActivePane,
  runAllActionRef,
  runCurrentActionRef,
  formatActionRef,
  editorRef,
  effectiveTabId,
}: EditorApplicationEventsOptions) {
  useEffect(() => {
    if (!isActivePane) return;

    const onRun = () => runAllActionRef.current();
    const onRunCurrent = () => void runCurrentActionRef.current();
    const onFormat = () => formatActionRef.current();
    const onInsertLineBelow = () => {
      const editor = editorRef.current;
      if (!editor) return;
      insertLineBelow(editor);
    };

    window.addEventListener(APP_EVENT_RUN_QUERY, onRun);
    window.addEventListener(APP_EVENT_RUN_CURRENT, onRunCurrent);
    window.addEventListener(APP_EVENT_FORMAT_SQL, onFormat);
    window.addEventListener(APP_EVENT_INSERT_LINE_BELOW, onInsertLineBelow);

    return () => {
      window.removeEventListener(APP_EVENT_RUN_QUERY, onRun);
      window.removeEventListener(APP_EVENT_RUN_CURRENT, onRunCurrent);
      window.removeEventListener(APP_EVENT_FORMAT_SQL, onFormat);
      window.removeEventListener(
        APP_EVENT_INSERT_LINE_BELOW,
        onInsertLineBelow,
      );
    };
  }, [isActivePane]);

  useEffect(() => {
    if (!isActivePane) return;

    const revealRange = (event: Event) => {
      const detail = (event as CustomEvent<EditorRangeNavigationDetail>).detail;
      const editor = editorRef.current;
      if (!editor || detail?.tabId !== effectiveTabId) return;
      const range = detail.range;
      editor.setSelection({
        startLineNumber: range.startLine,
        startColumn: range.startColumn,
        endLineNumber: range.endLine,
        endColumn: range.endColumn,
      });
      editor.revealRangeInCenter({
        startLineNumber: range.startLine,
        startColumn: range.startColumn,
        endLineNumber: range.endLine,
        endColumn: range.endColumn,
      });
      if (detail.focus !== false) editor.focus();
    };

    window.addEventListener(APP_EVENT_REVEAL_EDITOR_RANGE, revealRange);
    return () =>
      window.removeEventListener(APP_EVENT_REVEAL_EDITOR_RANGE, revealRange);
  }, [effectiveTabId, isActivePane]);
}
