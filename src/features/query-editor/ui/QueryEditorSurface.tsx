import { ProjectFileImagePreview } from "@/components/workspace/ProjectFileImagePreview";
import type { TabData } from "@/features/workspace-tabs/model/types";
import Editor, { DiffEditor } from "@monaco-editor/react";

interface QueryEditorSurfaceProps {
  tableDropTargetRef: React.RefObject<HTMLDivElement | null>;
  canAcceptExplorerTableDrop: boolean;
  activeTab: TabData;
  editorLanguageId: string;
  handleEditorBeforeMount: (monacoInstance: any) => void;
  mode: any;
  editorOptions: {
    fontSize: number;
    tabSize: number;
    wordWrap: "off" | "on" | "wordWrapColumn" | "bounded";
    minimap: { enabled: boolean };
    glyphMargin: boolean;
    inlineSuggest: { enabled: boolean };
    tabCompletion: "off" | "on";
    quickSuggestions:
      | boolean
      | { other: boolean; comments: boolean; strings: boolean };
    suggestOnTriggerCharacters: boolean;
    lineNumbers: "on" | "relative";
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace";
    fontLigatures: true;
    lineHeight: 20;
    scrollBeyondLastLine: false;
    automaticLayout: true;
    padding: { readonly top: 4; readonly bottom: 16 };
    lineNumbersMinChars: 3;
    folding: true;
    rulers: number[];
    renderLineHighlight: "all";
    renderWhitespace: "selection";
    contextmenu: true;
    overviewRulerBorder: false;
    hideCursorInOverviewRuler: true;
    smoothScrolling: true;
    cursorBlinking: "smooth";
    cursorSmoothCaretAnimation: "on";
    scrollbar: {
      readonly verticalScrollbarSize: 10;
      readonly horizontalScrollbarSize: 10;
      readonly useShadows: false;
    };
    wordBasedSuggestions: "off";
    acceptSuggestionOnCommitCharacter: false;
  };
  documentUri: string;
  handleEditorContentChange: (value: string | undefined) => void;
  handleEditorMount: (editor: any, monacoInstance: any) => void;
  tableDropCaretRef: React.RefObject<HTMLSpanElement | null>;
}

export function QueryEditorSurface({
  tableDropTargetRef,
  canAcceptExplorerTableDrop,
  activeTab,
  editorLanguageId,
  handleEditorBeforeMount,
  mode,
  editorOptions,
  documentUri,
  handleEditorContentChange,
  handleEditorMount,
  tableDropCaretRef,
}: QueryEditorSurfaceProps) {
  return (
    <div
      ref={tableDropTargetRef}
      className="relative flex-1 min-h-0"
      data-sql-table-drop-target={canAcceptExplorerTableDrop || undefined}
    >
      {activeTab.agentFileDiffPreview ? (
        <DiffEditor
          height="100%"
          language={editorLanguageId}
          original={activeTab.agentFileDiffPreview.originalContent}
          modified={activeTab.agentFileDiffPreview.proposedContent}
          originalModelPath={`oxide-agent-diff://original/${activeTab.agentFileDiffPreview.turnId}/${activeTab.agentFileDiffPreview.callId}/${activeTab.agentFileDiffPreview.relativePath}`}
          modifiedModelPath={`oxide-agent-diff://proposed/${activeTab.agentFileDiffPreview.turnId}/${activeTab.agentFileDiffPreview.callId}/${activeTab.agentFileDiffPreview.relativePath}`}
          beforeMount={handleEditorBeforeMount}
          theme={mode === "light" ? "vs" : "oxide-dark"}
          options={{
            ...editorOptions,
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
            renderOverviewRuler: true,
            diffCodeLens: false,
            enableSplitViewResizing: true,
            renderIndicators: true,
            ignoreTrimWhitespace: false,
            minimap: { enabled: false },
            glyphMargin: false,
          }}
        />
      ) : activeTab.gitFileDiffPreview ? (
        <DiffEditor
          height="100%"
          language={editorLanguageId}
          original={activeTab.gitFileDiffPreview.originalContent}
          modified={activeTab.gitFileDiffPreview.modifiedContent}
          originalModelPath={`oxide-git-diff://original/${activeTab.gitFileDiffPreview.scope}/${activeTab.gitFileDiffPreview.relativePath}`}
          modifiedModelPath={`oxide-git-diff://modified/${activeTab.gitFileDiffPreview.scope}/${activeTab.gitFileDiffPreview.relativePath}`}
          beforeMount={handleEditorBeforeMount}
          theme={mode === "light" ? "vs" : "oxide-dark"}
          options={{
            ...editorOptions,
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
            renderOverviewRuler: true,
            diffCodeLens: false,
            enableSplitViewResizing: true,
            renderIndicators: true,
            ignoreTrimWhitespace: false,
            minimap: { enabled: false },
            glyphMargin: false,
          }}
        />
      ) : activeTab.filePreview?.kind === "image" ? (
        <ProjectFileImagePreview
          dataUrl={activeTab.filePreview.dataUrl}
          fileName={activeTab.title}
          mediaType={activeTab.filePreview.mediaType}
          size={activeTab.filePreview.size}
        />
      ) : (
        <Editor
          height="100%"
          defaultLanguage="sql"
          language={editorLanguageId}
          path={documentUri}
          keepCurrentModel
          value={activeTab.sql}
          onChange={handleEditorContentChange}
          onMount={handleEditorMount}
          beforeMount={handleEditorBeforeMount}
          // Theme is updated via useEffect to ensure it responds to context
          options={editorOptions}
        />
      )}
      <span
        ref={tableDropCaretRef}
        data-sql-table-drop-caret="true"
        className="pointer-events-none absolute z-20 hidden w-0.5 rounded-full bg-[hsl(var(--wb-accent))] shadow-[0_0_4px_hsl(var(--wb-accent)/0.7)]"
        aria-hidden="true"
      />
    </div>
  );
}
