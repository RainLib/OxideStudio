import { useEffect } from "react";
import type { LspClient } from "@/services/lsp";
import { subscribeDocumentAnalysis, type SubscribeDocumentAnalysis } from "@/services/lsp/documentAnalysisEvents";
import { createLspProviderRefresh } from "../model/lspProviderRefresh";
import {registerLspDocumentFormatter,registerLspRangeFormatter} from "../model/lspFormattingRegistry";
import {registerLspDocumentSymbols} from "../model/lspDocumentSymbolRegistration";
import {captureLspDocumentRequest,watchLspProviderContext,type LspProviderContextOptions} from "../model/lspProviderContext";
import type {DocumentStructureKind} from "@/services/lsp/client/documentStructure";
import type {DocumentSemanticKind,DocumentSemanticInputs} from "@/services/lsp/client/documentSemantics";
import {
  revealLspDatabaseDefinition,
  revealLspProjectDefinition,
} from "@/lib/lspNavigation";
import {
  findEnclosingDollarQuoteBodyStartInText,
  sqlInsertValueHints,
} from "@/lib/sqlInsertValueHints";
import {
  flattenLspSelectionRanges,
  lspDocumentationForMonaco,
  toMonacoRange,
  toMonacoWorkspaceEdit,
} from "../model/lspMonacoAdapter";

type Disposable = { dispose: () => void };

export type LspCoreProviderCoordinatorOptions = LspProviderContextOptions & {
  editor?:any;
  activeProjectId?: string | null;
  canUseLsp: boolean;
  documentUri: string;
  editorLanguageId: string;
  serverDialect?: string;
  isActivePane: boolean;
  lspClient: LspClient;
  monaco: any;
  syncDocument?: (model: any) => Promise<void>;
  documentVersionsRef?: { current: Map<string, number> };
  documentTextsRef?: { current: Map<string, string> };
  subscribeAnalysis?: SubscribeDocumentAnalysis;
  onDocumentFormatResult?: (result: { ok: true } | { ok: false; error: unknown }) => void;
  /** Document navigation can be ready before formatting preferences commit. */
  canFormat?: () => boolean;
};

function emptyDisposableResult<T extends object>(value: T) {
  return { ...value, dispose: () => undefined };
}

function providerModelVersion(model: any): number | undefined {
  return typeof model?.getVersionId === "function"
    ? model.getVersionId()
    : undefined;
}

function providerRequestIsCurrent(
  model: any,
  modelVersion: number | undefined,
  token?: { isCancellationRequested?: boolean },
) {
  return (
    !token?.isCancellationRequested &&
    (modelVersion === undefined || providerModelVersion(model) === modelVersion)
  );
}

/**
 * Owns Monaco providers backed only by the stable LSP protocol surface.
 *
 * Completion and hover intentionally live in a separate metadata-sensitive
 * lifecycle. Explorer refreshes and completion preferences must not recreate
 * navigation, formatting, rename, semantic-token or inlay providers. Symbols
 * renew their registration when semantics change to invalidate Monaco's outline cache.
 */
export function registerLspCoreProviders({
  activeProjectId,
  canUseLsp,
  documentUri,
  editorLanguageId,
  serverDialect,
  lspClient,
  monaco,
  syncDocument,
  documentVersionsRef,
  documentTextsRef,
  subscribeAnalysis = subscribeDocumentAnalysis,
  onDocumentFormatResult,
  canFormat,
  getSemanticContext,
  subscribeSemanticContext,
  editor,
}: Omit<LspCoreProviderCoordinatorOptions, "isActivePane">): Disposable {
  let disposed = false;
  const handlesModel = (model: any) =>
    !disposed && canUseLsp && model.uri.toString() === documentUri;
  const captureDocument=(model:any,token?:{isCancellationRequested?:boolean})=>captureLspDocumentRequest({read:getSemanticContext,model,token,isActive:()=>handlesModel(model)});
  const semantic=async<K extends DocumentSemanticKind>(kind:K,model:any,input:DocumentSemanticInputs[K])=>{
    const version=documentVersionsRef?.current.get(documentUri),text=documentTextsRef?.current.get(documentUri);
    if(!serverDialect||version===undefined||text!==model.getValue())return null;
    const result=await lspClient.getDocumentSemantics({uri:documentUri,version,dialect:serverDialect,operation:{kind,...input}});
    return documentVersionsRef?.current.get(documentUri)===version&&documentTextsRef?.current.get(documentUri)===text?result?.value??null:null;
  };
  const structure=async<K extends DocumentStructureKind>(kind:K,model:any,positions?:Array<{line:number;character:number}>)=>{
    const version=documentVersionsRef?.current.get(documentUri),text=documentTextsRef?.current.get(documentUri);
    if(!serverDialect||version===undefined||text!==model.getValue())return null;
    const result=await lspClient.getDocumentStructure({uri:documentUri,version,dialect:serverDialect,kind,...(positions?{positions}:{})});
    return documentVersionsRef?.current.get(documentUri)===version&&documentTextsRef?.current.get(documentUri)===text?result:null;
  };
  const disposables: Disposable[] = [];
  let documentSymbols:ReturnType<typeof registerLspDocumentSymbols>|undefined;
  let semanticTokensCache: {
    model: any;
    version: number;
    resultId?: string;
    data: Uint32Array;
  } | null = null;
  const refresh = createLspProviderRefresh({
    subscribe: onPublication => canUseLsp ? subscribeAnalysis({
      sessionKey: lspClient.getSessionKey(), documentUri, onPublication,
    }) : { dispose: () => undefined },
    accept: ({ version,analysisToken }) => {
      if(getSemanticContext){const current=getSemanticContext();if(!current.lspAllowed||!current.analysisToken||current.analysisToken!==analysisToken)return false;}
      if (documentVersionsRef && version !== documentVersionsRef.current.get(documentUri)) return false;
      if (documentVersionsRef && !documentVersionsRef.current.has(documentUri)) return false;
      if (documentTextsRef) {
        const text = documentTextsRef.current.get(documentUri);
        const model = monaco.editor?.getModel(monaco.Uri.parse(documentUri));
        if (text === undefined || !model || model.isDisposed?.() || model.getValue() !== text) return false;
      }
      return true;
    },
    invalidate: () => { semanticTokensCache = null;documentSymbols?.refresh(); },
  });
  disposables.push({dispose:watchLspProviderContext({getSemanticContext,subscribeSemanticContext},()=>{
    refresh.invalidate();editor?.trigger("oxide.semanticContext","closeParameterHints",{});
  })});
  let dollarQuoteBodyCache: {
    model: any;
    version: number;
    rangeStart: number;
    bodyStart: number | null;
  } | null = null;

  disposables.push(
    monaco.languages.registerDefinitionProvider(editorLanguageId, {
      provideDefinition: async (model: any, position: any, token?:{isCancellationRequested?:boolean}) => {
        if (!handlesModel(model)) return [];
        const request=captureDocument(model,token);if(!request.isCurrent())return [];
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return [];}
        const locations = request.lspAllowed?await lspClient.getDefinitions(
          documentUri,
          position.lineNumber - 1,
          position.column - 1,
        ):(await semantic("definitions",model,{position:{line:position.lineNumber-1,character:position.column-1}}))??[];
        if(!request.isCurrent())return [];
        const editorLocations = [];
        for (const location of locations) {
          if(!request.isCurrent())return [];
          if (
            await revealLspDatabaseDefinition(
              location.uri,
              activeProjectId || "local",
            )
          ) {
            continue;
          }
          if (
            request.isCurrent() &&
            await revealLspProjectDefinition(
              location.uri,
              activeProjectId || "local",
            )
          ) {
            continue;
          }
          editorLocations.push({
            uri: monaco.Uri.parse(location.uri),
            range: toMonacoRange(monaco, location.range),
          });
        }
        return request.isCurrent()?editorLocations:[];
      },
    }),
    monaco.languages.registerReferenceProvider(editorLanguageId, {
      provideReferences: async (model: any, position: any, _context?:unknown, token?:{isCancellationRequested?:boolean}) => {
        if (!handlesModel(model)) return [];
        const request=captureDocument(model,token);if(!request.isCurrent())return [];
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return [];}
        const locations = request.lspAllowed?await lspClient.getReferences(
          documentUri,
          position.lineNumber - 1,
          position.column - 1,
        ):(await semantic("references",model,{position:{line:position.lineNumber-1,character:position.column-1},includeDeclaration:true}))??[];
        if(!request.isCurrent())return [];
        return locations.map((location) => ({
          uri: monaco.Uri.parse(location.uri),
          range: toMonacoRange(monaco, location.range),
        }));
      },
    }),
    registerLspDocumentFormatter(monaco.languages,editorLanguageId,documentUri, {
      provideDocumentFormattingEdits: async (
        model: any,
        options: any,
        token?: { isCancellationRequested?: boolean },
      ) => {
        if (canFormat && !canFormat()) return [];
        if (!handlesModel(model)) return [];
        const request=captureDocument(model,token);if(!request.isCurrent())return [];
        const modelVersion = providerModelVersion(model);
        let edits;
        try {
          await syncDocument?.(model);
          if(!request.isCurrent()||(canFormat&&!canFormat()))return [];
          edits = await lspClient.formatDocument(
            documentUri,
            options.tabSize || 2,
            options.insertSpaces !== false,
            Boolean(onDocumentFormatResult),
          );
        } catch (error) {
          if (!request.isCurrent()||!providerRequestIsCurrent(model, modelVersion, token)||(canFormat&&!canFormat())) return [];
          console.error("[LSP] Document formatting failed:", error);
          onDocumentFormatResult?.({ ok: false, error });
          return [];
        }
        if (!request.isCurrent()||!providerRequestIsCurrent(model, modelVersion, token)||(canFormat&&!canFormat())) return [];
        onDocumentFormatResult?.({ ok: true });
        return edits.map((edit) => ({
          range: toMonacoRange(monaco, edit.range),
          text: edit.newText,
        }));
      },
    }),
    registerLspRangeFormatter(
      monaco.languages,editorLanguageId,documentUri,
      {
        provideDocumentRangeFormattingEdits: async (
          model: any,
          range: any,
          options: any,
          token?: { isCancellationRequested?: boolean },
        ) => {
          if (canFormat && !canFormat()) return [];
          if (!handlesModel(model)) return [];
          const request=captureDocument(model,token);if(!request.isCurrent())return [];
          const modelVersion = providerModelVersion(model);
          let edits;
          try {
            await syncDocument?.(model);
            if(!request.isCurrent()||(canFormat&&!canFormat()))return [];
            edits = await lspClient.formatRange(
              documentUri,
              {
                start: {
                  line: range.startLineNumber - 1,
                  character: range.startColumn - 1,
                },
                end: {
                  line: range.endLineNumber - 1,
                  character: range.endColumn - 1,
                },
              },
              options.tabSize || 2,
              options.insertSpaces !== false,
            );
          } catch (error) {
            if(!request.isCurrent()||(canFormat&&!canFormat()))return [];
            console.error("[LSP] Range formatting failed:", error);
            return [];
          }
          if (!request.isCurrent()||!providerRequestIsCurrent(model, modelVersion, token)||(canFormat&&!canFormat())) return [];
          return edits.map((edit) => ({
            range: toMonacoRange(monaco, edit.range),
            text: edit.newText,
          }));
        },
      },
    ),
    monaco.languages.registerSignatureHelpProvider(editorLanguageId, {
      signatureHelpTriggerCharacters: ["sqlserver", "mssql", "tsql"].includes(serverDialect ?? editorLanguageId)
        ? ["(", ",", " ", "="] : ["(", ","],
      signatureHelpRetriggerCharacters: ["sqlserver", "mssql", "tsql"].includes(serverDialect ?? editorLanguageId)
        ? [",", "="] : [","],
      provideSignatureHelp: async (
        model: any,
        position: any,
        token?: { isCancellationRequested?: boolean },
      ) => {
        if (!handlesModel(model)) return null;
        const request=captureDocument(model,token);if(!request.isCurrent())return null;
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return null;}
        const modelVersion = providerModelVersion(model);
        let help;
        try {
          help = request.lspAllowed?await lspClient.getSignatureHelp(
            documentUri,
            position.lineNumber - 1,
            position.column - 1,
          ):await semantic("signature",model,{position:{line:position.lineNumber-1,character:position.column-1}});
        } catch (error) {
          console.error("[LSP] Signature help failed:", error);
          return null;
        }
        if (!request.isCurrent()||!providerRequestIsCurrent(model, modelVersion, token)) return null;
        if (!help) return null;
        return emptyDisposableResult({
          value: {
            signatures: help.signatures.map((signature) => ({
              label: signature.label,
              documentation: lspDocumentationForMonaco(signature.documentation),
              parameters: (signature.parameters || []).map((parameter) => ({
                label: parameter.label,
                documentation: lspDocumentationForMonaco(
                  parameter.documentation,
                ),
              })),
              activeParameter: signature.activeParameter,
            })),
            activeSignature: help.activeSignature || 0,
            activeParameter: help.activeParameter || 0,
          },
        });
      },
    }),
    monaco.languages.registerRenameProvider(editorLanguageId, {
      resolveRenameLocation: async (model: any, position: any, token?:{isCancellationRequested?:boolean}) => {
        const request=captureDocument(model,token);
        if (!handlesModel(model)||!request.isCurrent()) {
          return {
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
            text: "",
            rejectReason: "Database LSP is not active for this document.",
          };
        }
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return {rejectReason:"The semantic context changed before rename.",text:"",range:new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column)};}
        const range = request.lspAllowed?await lspClient.prepareRename(
          documentUri,
          position.lineNumber - 1,
          position.column - 1,
        ):await semantic("prepareRename",model,{position:{line:position.lineNumber-1,character:position.column-1}});
        if (!range||!request.isCurrent()) {
          return {
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
            text: "",
            rejectReason: "This symbol cannot be safely renamed.",
          };
        }
        const monacoRange = toMonacoRange(monaco, range);
        return {
          range: monacoRange,
          text: model.getValueInRange(monacoRange),
        };
      },
      provideRenameEdits: async (
        model: any,
        position: any,
        newName: string,
        token?:{isCancellationRequested?:boolean},
      ) => {
        const request=captureDocument(model,token);
        if (!handlesModel(model)||!request.isCurrent()) {
          return {
            edits: [],
            rejectReason: "Database LSP is not active for this document.",
          };
        }
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return {edits:[],rejectReason:"The semantic context changed before rename."};}
        const edit = request.lspAllowed?await lspClient.rename(
          documentUri,
          position.lineNumber - 1,
          position.column - 1,
          newName,
        ):await semantic("rename",model,{position:{line:position.lineNumber-1,character:position.column-1},newName});
        return edit&&request.isCurrent()
          ? toMonacoWorkspaceEdit(monaco, edit)
          : { edits: [], rejectReason: "No safe rename edits were found." };
      },
    }),
    monaco.languages.registerCodeActionProvider(
      editorLanguageId,
      {
        provideCodeActions: async (model: any, range: any, context: any, token?:{isCancellationRequested?:boolean}) => {
          const request=captureDocument(model,token);
          if (!handlesModel(model)||!request.isCurrent()) {
            return emptyDisposableResult({ actions: [] });
          }
          if(syncDocument){await syncDocument(model);if(!request.isCurrent())return emptyDisposableResult({actions:[]});}
          const actionRange=
            {
              start: {
                line: range.startLineNumber - 1,
                character: range.startColumn - 1,
              },
              end: {
                line: range.endLineNumber - 1,
                character: range.endColumn - 1,
              },
            };
          const diagnostics=(context.markers || []).map((marker: any) => ({
              range: {
                start: {
                  line: marker.startLineNumber - 1,
                  character: marker.startColumn - 1,
                },
                end: {
                  line: marker.endLineNumber - 1,
                  character: marker.endColumn - 1,
                },
              },
              severity:
                marker.severity === monaco.MarkerSeverity.Error
                  ? 1
                  : marker.severity === monaco.MarkerSeverity.Warning
                    ? 2
                    : marker.severity === monaco.MarkerSeverity.Info
                      ? 3
                      : 4,
              code:
                typeof marker.code === "object"
                  ? marker.code?.value
                  : marker.code,
              source: marker.source,
              message: marker.message,
            }));
          const only=context.only?[String(context.only)]:undefined;
          const actions=request.lspAllowed?await lspClient.getCodeActions(documentUri,actionRange,diagnostics,only):(await semantic("codeActions",model,{range:actionRange,context:{diagnostics,...(only?{only}:{})}}))??[];
          if(!request.isCurrent())return emptyDisposableResult({actions:[]});
          return emptyDisposableResult({
            actions: actions.map((action) => ({
              title: action.title,
              kind: action.kind,
              edit: action.edit
                ? toMonacoWorkspaceEdit(monaco, action.edit)
                : undefined,
              isPreferred: action.isPreferred,
              disabled: action.disabled?.reason,
            })),
          });
        },
      },
      { providedCodeActionKinds: ["quickfix", "refactor.rewrite", "source"] },
    ),
    (documentSymbols=registerLspDocumentSymbols(monaco.languages,editorLanguageId, {
      displayName: "Database symbols",
      provideDocumentSymbols: async (model: any, token?:{isCancellationRequested?:boolean}) => {
        if (!handlesModel(model)) return [];
        const request=captureDocument(model,token);if(!request.isCurrent())return [];
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return [];}
        const symbols = request.lspAllowed?await lspClient.getDocumentSymbols(documentUri):(await structure("symbols",model))?.items??[];
        if(!request.isCurrent())return [];
        const convertSymbol = (symbol: any): any => ({
          name: symbol.name,
          detail: symbol.detail || "",
          kind: Math.max(0, (symbol.kind || 1) - 1),
          tags: [],
          range: toMonacoRange(monaco, symbol.range),
          selectionRange: toMonacoRange(monaco, symbol.selectionRange),
          children: symbol.children?.map(convertSymbol),
        });
        return symbols.map(convertSymbol);
      },
    })),
    monaco.languages.registerFoldingRangeProvider(editorLanguageId, {
      provideFoldingRanges: async (model: any, _context?:unknown, token?:{isCancellationRequested?:boolean}) => {
        if (!handlesModel(model)) return [];
        const request=captureDocument(model,token);if(!request.isCurrent())return [];
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return [];}
        const ranges=request.lspAllowed?await lspClient.getFoldingRanges(documentUri):(await structure("folding",model))?.items??[];if(!request.isCurrent())return [];
        return ranges.map((range) => ({
          start: range.startLine + 1,
          end: range.endLine + 1,
        }));
      },
    }),
    monaco.languages.registerSelectionRangeProvider(editorLanguageId, {
      provideSelectionRanges: async (model: any, positions: any[], token?:{isCancellationRequested?:boolean}) => {
        if (!handlesModel(model)) return [];
        const request=captureDocument(model,token);if(!request.isCurrent())return [];
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return [];}
        const points=positions.map((position) => ({
            line: position.lineNumber - 1,
            character: position.column - 1,
          }));
        const selections=request.lspAllowed?await lspClient.getSelectionRanges(documentUri,points):(await structure("selection",model,points))?.items??[];
        if(!request.isCurrent())return [];
        return positions.map((_, index) =>
          flattenLspSelectionRanges(monaco, selections[index]),
        );
      },
    }),
    monaco.languages.registerDocumentSemanticTokensProvider(editorLanguageId, {
      onDidChange: refresh.onDidChange,
      getLegend: () => ({
        tokenTypes: ["namespace", "class", "property", "function", "variable"],
        tokenModifiers: [],
      }),
      provideDocumentSemanticTokens: async (
        model: any,
        _lastResultId: string | null,
        token: { isCancellationRequested?: boolean },
      ) => {
        // Monaco treats an empty array as a successful token response. Decline
        // other documents, while retaining empty responses to clear this owner.
        if (model.uri.toString() !== documentUri) return null;
        if (!handlesModel(model) || token?.isCancellationRequested) return { data: new Uint32Array() };
        const request=captureDocument(model,token);if(!request.isCurrent())return {data:new Uint32Array()};
        const generation = refresh.generation;
        const modelVersion = providerModelVersion(model);
        const cachedSemanticTokens = semanticTokensCache;
        if (
          modelVersion !== undefined &&
          cachedSemanticTokens &&
          cachedSemanticTokens.model === model &&
          cachedSemanticTokens.version === modelVersion
        ) {
          return {
            resultId: cachedSemanticTokens.resultId,
            data: cachedSemanticTokens.data.slice(),
          };
        }
        if(syncDocument){await syncDocument(model);if(!request.isCurrent())return {data:new Uint32Array()};}
        const result = request.lspAllowed?await lspClient.getSemanticTokens(documentUri):await semantic("tokens",model,{});
        if (!request.isCurrent()||!refresh.isCurrent(generation) || !providerRequestIsCurrent(model, modelVersion, token) || !result) {
          return { data: new Uint32Array() };
        }
        const response = {
          resultId: result.resultId,
          data: Uint32Array.from(result.data),
        };
        if (modelVersion !== undefined) {
          semanticTokensCache = {
            model,
            version: modelVersion,
            resultId: response.resultId,
            data: response.data,
          };
        }
        return { ...response, data: response.data.slice() };
      },
      releaseDocumentSemanticTokens: () => {
        semanticTokensCache = null;
      },
    }),
    monaco.languages.registerInlayHintsProvider(editorLanguageId, {
      onDidChangeInlayHints: refresh.onDidChange,
      displayName: "Database parameter and INSERT column hints",
      provideInlayHints: async (
        model: any,
        range: any,
        token?: { isCancellationRequested?: boolean },
      ) => {
        if (!handlesModel(model) || token?.isCancellationRequested) {
          return emptyDisposableResult({ hints: [] });
        }
        const request=captureDocument(model,token);if(!request.isCurrent())return emptyDisposableResult({hints:[]});
        const modelVersion = providerModelVersion(model);
        const generation = refresh.generation;
        let hints;
        try {
          if(syncDocument){await syncDocument(model);if(!request.isCurrent())return emptyDisposableResult({hints:[]});}
          const hintRange={
            start: {
              line: range.startLineNumber - 1,
              character: range.startColumn - 1,
            },
            end: {
              line: range.endLineNumber - 1,
              character: range.endColumn - 1,
            },
          };
          hints = request.lspAllowed?await lspClient.getInlayHints(documentUri,hintRange):(await semantic("inlayHints",model,{range:hintRange}))??[];
        } catch (error) {
          console.error("[LSP] Inlay hints failed:", error);
          return emptyDisposableResult({ hints: [] });
        }
        if (!request.isCurrent()||!refresh.isCurrent(generation) || !providerRequestIsCurrent(model, modelVersion, token)) {
          return emptyDisposableResult({ hints: [] });
        }
        const lspInlayHints = hints.map((hint) => ({
          position: {
            lineNumber: hint.position.line + 1,
            column: hint.position.character + 1,
          },
          label:
            typeof hint.label === "string"
              ? hint.label
              : hint.label.map((part) => ({
                  label: part.value,
                  tooltip: part.tooltip,
                })),
          kind:
            hint.kind === 1
              ? monaco.languages.InlayHintKind.Type
              : monaco.languages.InlayHintKind.Parameter,
          tooltip: lspDocumentationForMonaco(hint.tooltip),
          textEdits: hint.textEdits?.map((edit) => ({
            range: toMonacoRange(monaco, edit.range),
            text: edit.newText,
          })),
          paddingLeft: hint.paddingLeft,
          paddingRight: hint.paddingRight,
        }));
        const rangeStart = model.getOffsetAt({
          lineNumber: range.startLineNumber,
          column: range.startColumn,
        });
        const rangeEnd = model.getOffsetAt({
          lineNumber: range.endLineNumber,
          column: range.endColumn,
        });
        const lspPositions = new Set(
          lspInlayHints.map(
            (hint) => `${hint.position.lineNumber}:${hint.position.column}`,
          ),
        );
        // Keep the explicit-column fallback bounded to the visible statement
        // neighborhood. The bundled LSP resolves implicit columns from schema
        // metadata; this local path remains useful while schema sync is pending.
        const provisionalScanStart = Math.max(0, rangeStart - 32 * 1024);
        const scanEnd = Math.min(model.getValueLength(), rangeEnd + 32 * 1024);
        const provisionalScanStartPosition =
          model.getPositionAt(provisionalScanStart);
        const scanStart =
          provisionalScanStartPosition.lineNumber < range.startLineNumber
            ? model.getOffsetAt({
                lineNumber: provisionalScanStartPosition.lineNumber + 1,
                column: 1,
              })
            : provisionalScanStart;
        const scanStartPosition = model.getPositionAt(scanStart);
        const scanEndPosition = model.getPositionAt(scanEnd);
        const scanRange = {
          startLineNumber: scanStartPosition.lineNumber,
          startColumn: scanStartPosition.column,
          endLineNumber: scanEndPosition.lineNumber,
          endColumn: scanEndPosition.column,
        };
        const scanText = model.getValueInRange(scanRange);
        const cachedDollarQuoteBody = dollarQuoteBodyCache;
        let documentDollarQuoteBodyStart: number | null;
        if (
          modelVersion !== undefined &&
          cachedDollarQuoteBody !== null &&
          cachedDollarQuoteBody.model === model &&
          cachedDollarQuoteBody.version === modelVersion &&
          cachedDollarQuoteBody.rangeStart === rangeStart
        ) {
          documentDollarQuoteBodyStart = cachedDollarQuoteBody.bodyStart;
        } else {
          documentDollarQuoteBodyStart =
            findEnclosingDollarQuoteBodyStartInText(
              {
                length: model.getValueLength(),
                sliceString: (from, to) => {
                  const start = model.getPositionAt(from);
                  const end = model.getPositionAt(to);
                  return model.getValueInRange({
                    startLineNumber: start.lineNumber,
                    startColumn: start.column,
                    endLineNumber: end.lineNumber,
                    endColumn: end.column,
                  });
                },
              },
              rangeStart,
            );
        }
        if (modelVersion !== undefined) {
          dollarQuoteBodyCache = {
            model,
            version: modelVersion,
            rangeStart,
            bodyStart: documentDollarQuoteBodyStart,
          };
        }
        const routineBodyStart =
          documentDollarQuoteBodyStart === null ||
          documentDollarQuoteBodyStart < scanStart
            ? null
            : documentDollarQuoteBodyStart - scanStart;
        const fallbackText =
          routineBodyStart === null
            ? scanText
            : scanText.slice(routineBodyStart);
        const fallbackOffset = scanStart + (routineBodyStart ?? 0);
        const insertValueHints = sqlInsertValueHints(fallbackText)
          .map((hint) => ({ ...hint, offset: hint.offset + fallbackOffset }))
          .filter(
            (hint) => hint.offset >= rangeStart && hint.offset <= rangeEnd,
          )
          .map((hint) => ({
            position: model.getPositionAt(hint.offset),
            label: `${hint.column}:`,
            kind: monaco.languages.InlayHintKind.Parameter,
            tooltip:
              "Column matched from this INSERT statement's explicit column list.",
            paddingRight: true,
          }))
          .filter(
            (hint) =>
              !lspPositions.has(
                `${hint.position.lineNumber}:${hint.position.column}`,
              ),
          );
        return emptyDisposableResult({
          hints: [...lspInlayHints, ...insertValueHints],
        });
      },
    }),
  );

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      refresh.dispose();
      disposables.forEach((disposable) => disposable.dispose());
    },
  };
}

export function useLspCoreProviderCoordinator(
  options: LspCoreProviderCoordinatorOptions,
) {
  const {
    activeProjectId,
    canUseLsp,
    documentUri,
    editorLanguageId,
    serverDialect,
    isActivePane,
    lspClient,
    monaco,
    syncDocument,
    documentVersionsRef,
    documentTextsRef,
    subscribeAnalysis,
    onDocumentFormatResult,
    canFormat,
    getSemanticContext,
    subscribeSemanticContext,
    editor,
  } = options;

  useEffect(() => {
    if (!isActivePane || !monaco) return;
    return registerLspCoreProviders({
      activeProjectId,
      canUseLsp,
      documentUri,
      editorLanguageId,
      serverDialect,
      lspClient,
      monaco,
      syncDocument,
      documentVersionsRef,
      documentTextsRef,
      subscribeAnalysis,
      onDocumentFormatResult,
      canFormat,
      getSemanticContext,
      subscribeSemanticContext,
      editor,
    }).dispose;
  }, [
    activeProjectId,
    canUseLsp,
    documentUri,
    editorLanguageId,
    serverDialect,
    isActivePane,
    lspClient,
    monaco,
    syncDocument,
    documentVersionsRef,
    documentTextsRef,
    subscribeAnalysis,
    onDocumentFormatResult,
    canFormat,
    getSemanticContext,
    subscribeSemanticContext,
    editor,
  ]);
}
