import {
  OPEN_BATCH_COLUMN_SELECTION_COMMAND,
  SqlBatchColumnRuntimeSession,
} from "@/features/query-editor/model/completionProviderRuntime";
import { sqlBatchColumnInsertion } from "@/features/query-editor/model/sqlBatchColumnSelection";
import { useEffect, useState } from "react";

interface UseBatchColumnSelectionContext {
  monaco: typeof import("monaco-editor") | null;
  isActivePane: boolean;
  completionOwnerKey: string;
  batchColumnSessionsRef: React.RefObject<
    Map<
      string,
      import("@/features/query-editor/model/completionProviderRuntime").SqlBatchColumnRuntimeSession
    >
  >;
  mountedEditor: import("monaco-editor").editor.IStandaloneCodeEditor | null;

  editorSettings: import("@/lib/appSettings").AppSettings["editor"];
}

export function useBatchColumnSelection({
  monaco,
  isActivePane,
  completionOwnerKey,
  batchColumnSessionsRef,
  mountedEditor,

  editorSettings,
}: UseBatchColumnSelectionContext) {
  const [batchColumnSession, setBatchColumnSession] =
    useState<SqlBatchColumnRuntimeSession | null>(null);

  useEffect(() => {
    if (!monaco || !isActivePane) return;
    const disposable = monaco.editor.registerCommand(
      OPEN_BATCH_COLUMN_SELECTION_COMMAND,
      (_accessor: unknown, ownerKey: string, sessionId: string) => {
        if (ownerKey !== completionOwnerKey) return;
        const session = batchColumnSessionsRef.current.get(sessionId);
        const model = mountedEditor?.getModel();
        if (!session || !model || model.uri.toString() !== session.uri) return;
        if (session.context?.isCurrent() === false) return;
        if (model.getValueInRange(session.range) !== session.replacedText)
          return;
        setBatchColumnSession({
          ...session,
          modelVersion: model.getVersionId(),
        });
      },
    );
    return () => disposable.dispose();
  }, [completionOwnerKey, isActivePane, monaco, mountedEditor]);

  const applyBatchColumnSelection = (candidateKeys: string[]) => {
    const session = batchColumnSession;
    const editor = mountedEditor;
    const model = editor?.getModel();
    if (
      !session ||
      session.context?.isCurrent() === false ||
      !monaco ||
      !editor ||
      !model ||
      model.uri.toString() !== session.uri ||
      model.getVersionId() !== session.modelVersion ||
      model.getValueInRange(session.range) !== session.replacedText
    ) {
      setBatchColumnSession(null);
      return;
    }
    const selectedKeys = new Set(candidateKeys);
    const selected = session.candidates.filter((candidate) =>
      selectedKeys.has(candidate.key),
    );
    if (selected.length === 0) return;
    const insertion = sqlBatchColumnInsertion(
      selected,
      session.mode,
      editorSettings.sqlFormatting.keywordCase === "lower" ? "lower" : "upper",
    );
    let endLineNumber = session.range.endLineNumber;
    let endColumn = session.range.endColumn;
    if (session.mode === "insert") {
      const nextCharacter = model
        .getLineContent(endLineNumber)
        .slice(endColumn - 1, endColumn);
      if (nextCharacter === ")") endColumn += 1;
    }
    const replacement = new monaco.Selection(
      session.range.startLineNumber,
      session.range.startColumn,
      endLineNumber,
      endColumn,
    );
    editor.setSelection(replacement);
    if (insertion.snippet) {
      editor.trigger("oxide.sql.batchColumns", "editor.action.insertSnippet", {
        snippet: insertion.text,
      });
    } else {
      editor.executeEdits("oxide.sql.batchColumns", [
        { range: replacement, text: insertion.text, forceMoveMarkers: true },
      ]);
    }
    setBatchColumnSession(null);
    editor.focus();
  };

  return {
    applyBatchColumnSelection,
    batchColumnSession,
    setBatchColumnSession,
  };
}
