import { useEffect, useRef } from "react";
import { captureQueryExecutionSnapshot } from "@/features/query-editor/hooks/useQueryExecutionController";
import { useEditorApplicationEvents } from "@/features/query-editor/hooks/useEditorApplicationEvents";
import { resolveQueryExecutionTarget } from "@/features/query-editor/model/queryExecutionTarget";
import { fileQueryService } from "@/services/tauri/file-query.service";
import { useTabStore } from "@/store/useTabStore";
import type { TabData } from "@/features/workspace-tabs/model/types";
import { useI18n } from "@/i18n";

import type { FileQueryFormatResult } from "./model";

export function useFileQueryCommands(options: {
  tab: TabData;
  editorRef: React.RefObject<any>;
  mountedEditor: any;
  monaco: typeof import("monaco-editor") | null;
  formatReady: boolean;
  isFormatReady?:()=>boolean;
  formatResultRef: React.MutableRefObject<FileQueryFormatResult | null>;
}) {
  const { tab, editorRef, mountedEditor, monaco, formatReady, formatResultRef,isFormatReady } = options;
  const { t } = useI18n();
  const isActivePane = useTabStore(state => state.activeTabId === tab.id);
  const generation = useRef(0);
  const runAllActionRef = useRef<() => void>(() => {});
  const runCurrentActionRef = useRef<() => void>(() => {});
  const formatActionRef = useRef<() => void>(() => {});
  const formatErrorRef = useRef<string | null>(null);
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    useTabStore.setState(state => ({ tabs: state.tabs.map(t => t.id === tab.id ? { ...t, error: message } : t) }));
    return message;
  };
  const run = async (current: boolean) => {
    const session = tab.fileQuery?.session;
    if (!session || tab.isExecuting) return;
    const sameSession=()=>useTabStore.getState().tabs.find(value=>value.id===tab.id)?.fileQuery?.session===session;
    if(!sameSession())return;
    const request = ++generation.current;
    const model = editorRef.current?.getModel();
    const version = model?.getVersionId();
    const snapshot = captureQueryExecutionSnapshot(editorRef.current) ?? { fullText: tab.sql, selectedText: "", selectionStart: 0, selectionEnd: 0, cursorOffset: 0 };
    try {
      const target = current ? await resolveQueryExecutionTarget({ kind: "sql", mode: "current", snapshot,
        resolveSqlStatementAtCursor: (sql, offset) => fileQueryService.statement(session, sql, offset) })
        : { sql: snapshot.selectedText.trim() ? snapshot.selectedText : snapshot.fullText };
      const live = useTabStore.getState().tabs.find(t => t.id === tab.id);
      if (!target?.sql.trim() || generation.current !== request || !sameSession() || live?.sql !== snapshot.fullText || (model && model.getVersionId() !== version)) return;
      await useTabStore.getState().runTabQuery(tab.id, "", target.sql);
    } catch (error) { if (generation.current === request&&sameSession()) report(error); }
  };
  runAllActionRef.current = () => void run(false);
  runCurrentActionRef.current = () => void run(true);
  formatActionRef.current = () => {
    if (!(isFormatReady?.()??formatReady)) { formatErrorRef.current = report(t("fileQuery.formatNotReady")); return; }
    const request=++generation.current,session=tab.fileQuery?.session;
    const current=()=>request===generation.current&&useTabStore.getState().tabs.find(value=>value.id===tab.id)?.fileQuery?.session===session&&(isFormatReady?.()??formatReady);
    formatResultRef.current = null;
    void Promise.resolve(editorRef.current?.getAction("editor.action.formatDocument")?.run()).then(() => {
      if(!current())return;
      const result = formatResultRef.current;
      if (!result) return;
      if (!result.ok) throw result.error;
      const message = formatErrorRef.current;
      if (message) useTabStore.setState(state => ({ tabs: state.tabs.map(t => t.id === tab.id && t.error === message ? { ...t, error: null } : t) }));
      formatErrorRef.current = null;
    }).catch(error => { if(current())formatErrorRef.current = report(error); });
  };
  useEditorApplicationEvents({ isActivePane, runAllActionRef, runCurrentActionRef, formatActionRef, editorRef, effectiveTabId: tab.id });
  useEffect(() => () => { generation.current++; }, [tab.id]);
  useEffect(() => {
    if (!mountedEditor || !monaco) return;
    const actions = [
      mountedEditor.addAction({ id: `file-query.run.${tab.id}`, label: t("fileQuery.run"), keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => runAllActionRef.current() }),
      mountedEditor.addAction({ id: `file-query.current.${tab.id}`, label: t("fileQuery.runCurrent"), keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter], run: () => runCurrentActionRef.current() }),
    ];
    return () => actions.forEach(action => action.dispose());
  }, [mountedEditor, monaco, tab.id, t]);
  return { run: () => runAllActionRef.current() };
}
