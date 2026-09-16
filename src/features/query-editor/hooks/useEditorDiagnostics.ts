import { lspDiagnosticOverlapsOffsetRange } from "@/features/query-editor/model/completionProviderRuntime";
import {
  isPublishDiagnosticsParams,
  lspDiagnosticToMonacoMarker,
  shouldApplyLspDiagnostics,
} from "@/features/query-editor/model/lspMonacoAdapter";
import {
  isMysqlRoutineParserDiagnostic,
  supportsMysqlRoutineSyntaxDiagnostics,
} from "@/features/query-editor/model/mysqlRoutineSyntaxDiagnostics";
import { buildOracleSyntaxDiagnostics } from "@/features/query-editor/model/oracleSyntaxDiagnostics";
import type { LspServerNotification } from "@/services/lsp";
import {
  extractSqlDocumentTabId,
  LSP_NOTIFICATION_EVENT,
} from "@/services/lsp";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

interface EditorDiagnosticsContext {
  monaco: typeof import("monaco-editor") | null;
  lspReady: boolean;
  lspSessionKey: string;
  documentVersionsRef: React.RefObject<Map<string, number>>;
  documentTextsRef: React.RefObject<Map<string, string>>;
  mysqlRoutineAnalysisForModel: (
    model: any,
  ) =>
    | import("@/features/query-editor/model/mysqlRoutineSyntaxDiagnostics").MysqlRoutineSyntaxAnalysis
    | null;
  setLspDiagnostics: (
    id: string,
    diagnostics: import("@/services/lsp/types").Diagnostic[],
  ) => void;
  mountedEditor: any;
  activeTab:
    | import("@/features/workspace-tabs/model/types").TabData
    | undefined;
  driver: import("@/services/tauri/types").DatabaseDriver;
}

export function useEditorDiagnostics({
  monaco,
  lspReady,
  lspSessionKey,
  documentVersionsRef,
  documentTextsRef,
  mysqlRoutineAnalysisForModel,
  setLspDiagnostics,
  mountedEditor,
  activeTab,
  driver,
}: EditorDiagnosticsContext) {
  useEffect(() => {
    if (!monaco || !lspReady) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<LspServerNotification>(LSP_NOTIFICATION_EVENT, (event) => {
      if (
        event.payload.sessionKey &&
        event.payload.sessionKey !== lspSessionKey
      ) {
        return;
      }
      if (event.payload.method !== "textDocument/publishDiagnostics") return;
      if (!isPublishDiagnosticsParams(event.payload.params)) return;

      const { uri, diagnostics, version } = event.payload.params;
      const model = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (!model) return;
      if (
        !shouldApplyLspDiagnostics({
          diagnosticsVersion: version,
          currentDocumentVersion: documentVersionsRef.current.get(uri),
          modelText: model.getValue(),
          synchronizedText: documentTextsRef.current.get(uri),
        })
      ) {
        return;
      }
      const mysqlRoutineAnalysis = mysqlRoutineAnalysisForModel(model);
      const visibleDiagnostics = mysqlRoutineAnalysis
        ? diagnostics.filter(
            (diagnostic) =>
              !isMysqlRoutineParserDiagnostic(diagnostic) ||
              !mysqlRoutineAnalysis.routineRanges.some((range) =>
                lspDiagnosticOverlapsOffsetRange(model, diagnostic, range),
              ),
          )
        : diagnostics;
      const tabId = extractSqlDocumentTabId(uri);
      if (tabId) {
        setLspDiagnostics(tabId, visibleDiagnostics);
      }

      monaco.editor.setModelMarkers(
        model,
        "sql-lsp",
        visibleDiagnostics.map((diagnostic) =>
          lspDiagnosticToMonacoMarker(monaco, diagnostic),
        ),
      );
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    lspSessionKey,
    monaco,
    lspReady,
    mysqlRoutineAnalysisForModel,
    setLspDiagnostics,
  ]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    const databaseError = activeTab?.queryError?.database;
    const documentOffset = databaseError?.documentOffset;
    const documentEndOffset = databaseError?.documentEndOffset;
    const owner = "database-query";

    if (
      !databaseError ||
      documentOffset === undefined ||
      documentOffset < 0 ||
      documentOffset > model.getValueLength()
    ) {
      monaco.editor.setModelMarkers(model, owner, []);
      return;
    }

    const start = model.getPositionAt(documentOffset);
    const end = model.getPositionAt(
      Math.min(
        model.getValueLength(),
        Math.max(documentOffset, documentEndOffset ?? documentOffset + 1),
      ),
    );
    monaco.editor.setModelMarkers(model, owner, [
      {
        severity: monaco.MarkerSeverity.Error,
        message: activeTab?.error || "Database query failed",
        source:
          databaseError.sqlState || databaseError.vendorCode !== undefined
            ? [
                databaseError.driver,
                databaseError.sqlState,
                databaseError.vendorCode,
              ]
                .filter((value) => value !== undefined)
                .join(" ")
            : databaseError.driver,
        code:
          databaseError.sqlState ||
          (databaseError.vendorCode !== undefined
            ? String(databaseError.vendorCode)
            : undefined),
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn:
          end.lineNumber === start.lineNumber && end.column === start.column
            ? start.column + 1
            : end.column,
      },
    ]);

    return () => {
      monaco.editor.setModelMarkers(model, owner, []);
    };
  }, [
    activeTab?.error,
    activeTab?.id,
    activeTab?.queryError,
    monaco,
    mountedEditor,
  ]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    const owner = "oracle-syntax";
    const diagnostics = buildOracleSyntaxDiagnostics(model.getValue(), driver);
    monaco.editor.setModelMarkers(
      model,
      owner,
      diagnostics.map((diagnostic) => {
        const start = model.getPositionAt(diagnostic.startOffset);
        const end = model.getPositionAt(diagnostic.endOffset);
        return {
          severity: monaco.MarkerSeverity.Error,
          message: diagnostic.message,
          source: "oxide-oracle-syntax",
          code: diagnostic.code,
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
      }),
    );
    return () => monaco.editor.setModelMarkers(model, owner, []);
  }, [activeTab?.sql, driver, monaco, mountedEditor]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    const owner = "mysql-routine-syntax";
    if (!supportsMysqlRoutineSyntaxDiagnostics(driver)) {
      monaco.editor.setModelMarkers(model, owner, []);
      return;
    }
    const timer = window.setTimeout(() => {
      const analysis = mysqlRoutineAnalysisForModel(model);
      monaco.editor.setModelMarkers(
        model,
        owner,
        (analysis?.diagnostics || []).map((diagnostic) => {
          const start = model.getPositionAt(diagnostic.startOffset);
          const end = model.getPositionAt(diagnostic.endOffset);
          return {
            severity: monaco.MarkerSeverity.Error,
            message: diagnostic.message,
            source: "oxide-mysql-routine-syntax",
            code: diagnostic.code,
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          };
        }),
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    activeTab?.sql,
    driver,
    monaco,
    mountedEditor,
    mysqlRoutineAnalysisForModel,
  ]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    return () =>
      monaco.editor.setModelMarkers(model, "mysql-routine-syntax", []);
  }, [monaco, mountedEditor]);
}
