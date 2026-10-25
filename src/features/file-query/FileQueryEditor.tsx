import { useRef, useState, useEffect } from "react";
import { useMonaco } from "@monaco-editor/react";
import { Play, Square, RotateCcw, LockKeyhole } from "lucide-react";
import { useTabStore } from "@/store/useTabStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { QueryEditorSurface } from "@/features/query-editor/ui/QueryEditorSurface";
import { useEditorPresentation } from "@/features/query-editor/hooks/useEditorPresentation";
import type { TabData } from "@/features/workspace-tabs/model/types";
import { useFileQueryStore } from "./store";
import { fileQueryService } from "@/services/tauri/file-query.service";
import { useFileQueryCommands } from "./useFileQueryCommands";
import { useFileQueryIntelligence } from "./useFileQueryIntelligence";
import { FileQueryStatusBar } from "./FileQueryStatusBar";
import { useI18n } from "@/i18n";

export function FileQueryEditor({ tab }: { tab: TabData }) {
  const { t } = useI18n();
  const document = tab.fileQuery!;
  const session = document.session;
  const editorSettings = useSettingsStore(state => state.settings.editor);
  const editorRef = useRef<any>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const inlineKeysContextRef = useRef<{ set: (value: boolean) => void } | null>(null);
  const [mountedEditor, setMountedEditor] = useState<any>(null);
  const monaco = useMonaco();
  const documentUri = `oxide-file-query://${encodeURIComponent(document.source.projectId)}/${tab.id}.sql`;
  const intelligence = useFileQueryIntelligence(tab, documentUri, monaco,mountedEditor);
  const presentation = useEditorPresentation({ editorSettings, isElasticsearchConsole: false, editorRef, setMountedEditor, inlineKeysContextRef, monaco, mountedEditor, editorLanguageId: intelligence.language, documentUri });
  const commands = useFileQueryCommands({ tab, editorRef, mountedEditor, monaco, formatReady: intelligence.ready,isFormatReady:intelligence.isFormatReady, formatResultRef: intelligence.formatResultRef });
  useEffect(() => {
    if (!session) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const live = await fileQueryService.status(session);
        if (disposed || live) return;
        useTabStore.setState(state => ({ tabs: state.tabs.map(t => t.id === tab.id && !t.isExecuting && t.fileQuery?.session?.id === session.id ? { ...t,lspDiagnostics:[], fileQuery: { ...t.fileQuery, session: null } } : t) }));
      } catch { /* A transient IPC failure does not establish session expiry. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    window.addEventListener("focus", refresh);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [session, tab.id]);
  return <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))]" data-file-query-editor>
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-2 text-[11px]">
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[hsl(var(--wb-text-muted))]" title={session?.fileName ?? tab.title}><LockKeyhole size={12} className="shrink-0" /><span className="truncate">{t("fileQuery.snapshot", { name: session?.fileName ?? tab.title })}</span></span>
      {tab.isExecuting ? <button className="wb-text-button flex h-6 items-center gap-1 px-2" onClick={() => void useTabStore.getState().cancelTabQuery(tab.id)}><Square size={12} />{t("common.cancel")}</button>
        : <button className="wb-text-button flex h-6 items-center gap-1 px-2" disabled={!session || !tab.sql.trim()} title={t("fileQuery.runHint")} onClick={commands.run}><Play size={12} />{t("fileQuery.run")}</button>}
      <button className="wb-icon-button h-6 w-6" disabled={tab.isExecuting} title={t("fileQuery.reopenHint")} aria-label={t("fileQuery.reopenLabel")} onClick={() => void useFileQueryStore.getState().show(document.source, tab.id)}><RotateCcw size={12} /></button>
    </div>
    {!session && <div role="status" className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-xs text-[hsl(var(--wb-text-muted))]">
      <span>{t("fileQuery.ended")}</span>
      <button className="wb-text-button h-6 px-2" onClick={() => void useFileQueryStore.getState().show(document.source, tab.id)}>{t("fileQuery.reopen")}</button>
    </div>}
    <QueryEditorSurface tableDropTargetRef={dropRef} canAcceptExplorerTableDrop={false} activeTab={tab} editorLanguageId={intelligence.language} handleEditorBeforeMount={presentation.handleEditorBeforeMount} mode={presentation.mode} editorOptions={presentation.editorOptions} documentUri={documentUri}
      handleEditorContentChange={value => useTabStore.getState().updateTabSql(tab.id, value ?? "")} handleEditorMount={presentation.handleEditorMount} tableDropCaretRef={caretRef} />
    <FileQueryStatusBar tab={tab} intelligence={intelligence} />
  </div>;
}
