import { lspDiagnosticOverlapsOffsetRange } from "@/features/query-editor/model/completionProviderRuntime";
import {
  isPublishDiagnosticsParams,
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
import {createDiagnosticPublication} from "../model/diagnosticPublication";
import {watchLspProviderContext,type LspProviderContextOptions} from "../model/lspProviderContext";
import {subscribeLspDocumentShadow} from "../model/lspDocumentSync";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {createDiagnosticRecovery} from "../model/diagnosticRecovery";
import {captureDiagnosticSnapshot} from "../model/diagnosticSnapshotRequest";
import type {DiagnosticSnapshot,DiagnosticSnapshotRequest} from "@/services/lsp/client/diagnostics";
import type {PublishDiagnosticsParams} from "@/services/lsp/types";
import {createSharedDiagnosticMarkers} from "../model/sharedDiagnosticMarkers";
import {createSharedEditorMarkers} from "../model/sharedEditorMarkers";

interface EditorDiagnosticsContext extends LspProviderContextOptions {
  documentUri:string;
  diagnosticTabId?:string;
  diagnosticDialect?:string;
  syntaxContextKey?:string;
  requestDiagnosticSnapshot?:(request:DiagnosticSnapshotRequest)=>Promise<DiagnosticSnapshot|null>;
  subscribeDiagnostics?:(accept:(value:PublishDiagnosticsParams)=>void)=>Promise<()=>void>;
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
  documentUri,
  diagnosticTabId,
  getSemanticContext,
  subscribeSemanticContext,
  diagnosticDialect,syntaxContextKey,requestDiagnosticSnapshot,subscribeDiagnostics,
}: EditorDiagnosticsContext) {
  useEffect(() => {
    if (!monaco || !lspReady) return;

    let disposed = false;
    const unavailable:CompletionContextState={connection:undefined,runtime:undefined,metadataVersion:0,projectId:"",route:"",generation:undefined,available:false,lspAllowed:false,metadataAllowed:false,syntaxAllowed:true};
    const model=()=>monaco.editor.getModel(monaco.Uri.parse(documentUri));
    const tabId=extractSqlDocumentTabId(documentUri)||diagnosticTabId;
    const read=getSemanticContext||(()=>unavailable);
    const shadow=()=>({version:documentVersionsRef.current.get(documentUri),text:documentTextsRef.current.get(documentUri)});
    const markers=createSharedDiagnosticMarkers({monaco,model,read,shadow,session:lspSessionKey,dialect:diagnosticDialect,editor:mountedEditor,tabId,setDiagnostics:setLspDiagnostics});
    const controller=createDiagnosticPublication({uri:documentUri,dialect:diagnosticDialect,read,model,
      shadow,clear:markers.clear,
      publish:(model,diagnostics)=>{
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
      markers.publish(model,visibleDiagnostics);
    }});
    const recovery=createDiagnosticRecovery({controller,
      listen:subscribeDiagnostics||((accept)=>listen<LspServerNotification>(LSP_NOTIFICATION_EVENT,event=>{
        if(disposed||event.payload.sessionKey!==lspSessionKey||event.payload.method!=="textDocument/publishDiagnostics"||!isPublishDiagnosticsParams(event.payload.params))return;
        accept(event.payload.params);
      })),
      request:requestDiagnosticSnapshot||(()=>Promise.resolve(null)),
      capture:mode=>captureDiagnosticSnapshot({uri:documentUri,dialect:diagnosticDialect,mode,read,model,shadow,isActive:()=>!disposed}),
    });
    const refresh=()=>{markers.refresh();recovery.refresh();};
    const releaseContext=watchLspProviderContext({getSemanticContext,subscribeSemanticContext},refresh);
    const releaseShadow=subscribeLspDocumentShadow(documentVersionsRef.current,uri=>{if(uri===documentUri)refresh();});
    const change=mountedEditor?.onDidChangeModelContent?.(refresh);
    const modelChange=mountedEditor?.onDidChangeModel?.(refresh);
    const focus=mountedEditor?.onDidFocusEditorText?.(()=>markers.refresh());
    const blur=mountedEditor?.onDidBlurEditorText?.(()=>markers.refresh());

    return () => {
      disposed = true;
      markers.dispose();
      releaseContext();releaseShadow();change?.dispose();modelChange?.dispose();focus?.dispose();blur?.dispose();recovery.dispose();
    };
  }, [
    lspSessionKey,
    monaco,
    lspReady,
    mysqlRoutineAnalysisForModel,
    setLspDiagnostics,
    documentUri,diagnosticTabId,getSemanticContext,subscribeSemanticContext,mountedEditor,documentVersionsRef,documentTextsRef,
    diagnosticDialect,syntaxContextKey,requestDiagnosticSnapshot,subscribeDiagnostics,
  ]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    const databaseError = activeTab?.queryError?.database;
    const documentOffset = databaseError?.documentOffset;
    const documentEndOffset = databaseError?.documentEndOffset;
    const owner = "database-query";
    const markers=createSharedEditorMarkers({monaco,model,editor:mountedEditor,layer:owner,contextKey:activeTab?.id??diagnosticTabId??documentUri});

    if (
      !databaseError ||
      documentOffset === undefined ||
      documentOffset < 0 ||
      documentOffset > model.getValueLength()
    ) {
      markers.publish([]);
      return markers.dispose;
    }

    const start = model.getPositionAt(documentOffset);
    const end = model.getPositionAt(
      Math.min(
        model.getValueLength(),
        Math.max(documentOffset, documentEndOffset ?? documentOffset + 1),
      ),
    );
    markers.publish([
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

    return markers.dispose;
  }, [
    activeTab?.error,
    activeTab?.id,
    activeTab?.queryError,
    monaco,
    mountedEditor,
    documentUri,
    diagnosticTabId,
  ]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    const owner = "oracle-syntax";
    const markers=createSharedEditorMarkers({monaco,model,editor:mountedEditor,layer:owner,contextKey:driver});
    const diagnostics = buildOracleSyntaxDiagnostics(model.getValue(), driver);
    markers.publish(
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
    return markers.dispose;
  }, [activeTab?.id,activeTab?.sql,driver,monaco,mountedEditor,documentUri]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    const owner = "mysql-routine-syntax";
    const markers=createSharedEditorMarkers({monaco,model,editor:mountedEditor,layer:owner,contextKey:driver});
    if (!supportsMysqlRoutineSyntaxDiagnostics(driver)) {
      markers.publish([]);
      return markers.dispose;
    }
    const timer = window.setTimeout(() => {
      const analysis = mysqlRoutineAnalysisForModel(model);
      markers.publish(
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
    return () => {window.clearTimeout(timer);markers.dispose();};
  }, [
    activeTab?.sql,
    activeTab?.id,
    driver,
    monaco,
    mountedEditor,
    mysqlRoutineAnalysisForModel,
    documentUri,
  ]);
}
