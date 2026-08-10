import { useEffect } from "react";
import type { LspClient } from "@/services/lsp";
import {
  revealLspDatabaseDefinition,
  revealLspProjectDefinition,
} from "@/lib/lspNavigation";
import { sqlInsertValueHints } from "@/lib/sqlInsertValueHints";
import {
  flattenLspSelectionRanges,
  lspDocumentationForMonaco,
  toMonacoRange,
  toMonacoWorkspaceEdit,
} from "../model/lspMonacoAdapter";

type Disposable = { dispose: () => void };

export type LspCoreProviderCoordinatorOptions = {
  activeProjectId?: string | null;
  canUseLsp: boolean;
  documentUri: string;
  editorLanguageId: string;
  isActivePane: boolean;
  lspClient: LspClient;
  monaco: any;
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
 * navigation, formatting, rename, symbol, semantic-token or inlay providers.
 */
export function registerLspCoreProviders({
  activeProjectId,
  canUseLsp,
  documentUri,
  editorLanguageId,
  lspClient,
  monaco,
}: Omit<LspCoreProviderCoordinatorOptions, "isActivePane">): Disposable {
  const handlesModel = (model: any) =>
    canUseLsp && model.uri.toString() === documentUri;
  const disposables: Disposable[] = [];

  disposables.push(
    monaco.languages.registerDefinitionProvider(editorLanguageId, {
      provideDefinition: async (model: any, position: any) => {
        if (!handlesModel(model)) return [];
        const locations = await lspClient.getDefinitions(
          documentUri,
          position.lineNumber - 1,
          position.column - 1,
        );
        const editorLocations = [];
        for (const location of locations) {
          if (
            await revealLspDatabaseDefinition(
              location.uri,
              activeProjectId || "local",
            )
          ) {
            continue;
          }
          if (
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
        return editorLocations;
      },
    }),
    monaco.languages.registerReferenceProvider(editorLanguageId, {
      provideReferences: async (model: any, position: any) => {
        if (!handlesModel(model)) return [];
        const locations = await lspClient.getReferences(
          documentUri,
          position.lineNumber - 1,
          position.column - 1,
        );
        return locations.map((location) => ({
          uri: monaco.Uri.parse(location.uri),
          range: toMonacoRange(monaco, location.range),
        }));
      },
    }),
    monaco.languages.registerDocumentFormattingEditProvider(editorLanguageId, {
      provideDocumentFormattingEdits: async (model: any, options: any) => {
        if (!handlesModel(model)) return [];
        const edits = await lspClient.formatDocument(
          documentUri,
          options.tabSize || 2,
          options.insertSpaces !== false,
        );
        return edits.map((edit) => ({
          range: toMonacoRange(monaco, edit.range),
          text: edit.newText,
        }));
      },
    }),
    monaco.languages.registerDocumentRangeFormattingEditProvider(
      editorLanguageId,
      {
        provideDocumentRangeFormattingEdits: async (
          model: any,
          range: any,
          options: any,
        ) => {
          if (!handlesModel(model)) return [];
          const edits = await lspClient.formatRange(
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
          return edits.map((edit) => ({
            range: toMonacoRange(monaco, edit.range),
            text: edit.newText,
          }));
        },
      },
    ),
    monaco.languages.registerSignatureHelpProvider(editorLanguageId, {
      signatureHelpTriggerCharacters: ["(", ","],
      signatureHelpRetriggerCharacters: [","],
      provideSignatureHelp: async (
        model: any,
        position: any,
        token?: { isCancellationRequested?: boolean },
      ) => {
        if (!handlesModel(model)) return null;
        const modelVersion = providerModelVersion(model);
        let help;
        try {
          help = await lspClient.getSignatureHelp(
            documentUri,
            position.lineNumber - 1,
            position.column - 1,
          );
        } catch (error) {
          console.error("[LSP] Signature help failed:", error);
          return null;
        }
        if (!providerRequestIsCurrent(model, modelVersion, token)) return null;
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
      resolveRenameLocation: async (model: any, position: any) => {
        if (!handlesModel(model)) {
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
        const range = await lspClient.prepareRename(
          documentUri,
          position.lineNumber - 1,
          position.column - 1,
        );
        if (!range) {
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
      ) => {
        if (!handlesModel(model)) {
          return {
            edits: [],
            rejectReason: "Database LSP is not active for this document.",
          };
        }
        const edit = await lspClient.rename(
          documentUri,
          position.lineNumber - 1,
          position.column - 1,
          newName,
        );
        return edit
          ? toMonacoWorkspaceEdit(monaco, edit)
          : { edits: [], rejectReason: "No safe rename edits were found." };
      },
    }),
    monaco.languages.registerCodeActionProvider(
      editorLanguageId,
      {
        provideCodeActions: async (
          model: any,
          range: any,
          context: any,
        ) => {
          if (!handlesModel(model)) {
            return emptyDisposableResult({ actions: [] });
          }
          const actions = await lspClient.getCodeActions(
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
            (context.markers || []).map((marker: any) => ({
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
            })),
            context.only ? [String(context.only)] : undefined,
          );
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
    monaco.languages.registerDocumentSymbolProvider(editorLanguageId, {
      displayName: "Database symbols",
      provideDocumentSymbols: async (model: any) => {
        if (!handlesModel(model)) return [];
        const symbols = await lspClient.getDocumentSymbols(documentUri);
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
    }),
    monaco.languages.registerFoldingRangeProvider(editorLanguageId, {
      provideFoldingRanges: async (model: any) => {
        if (!handlesModel(model)) return [];
        return (await lspClient.getFoldingRanges(documentUri)).map((range) => ({
          start: range.startLine + 1,
          end: range.endLine + 1,
        }));
      },
    }),
    monaco.languages.registerSelectionRangeProvider(editorLanguageId, {
      provideSelectionRanges: async (model: any, positions: any[]) => {
        if (!handlesModel(model)) return [];
        const selections = await lspClient.getSelectionRanges(
          documentUri,
          positions.map((position) => ({
            line: position.lineNumber - 1,
            character: position.column - 1,
          })),
        );
        return positions.map((_, index) =>
          flattenLspSelectionRanges(monaco, selections[index]),
        );
      },
    }),
    monaco.languages.registerDocumentSemanticTokensProvider(editorLanguageId, {
      getLegend: () => ({
        tokenTypes: ["namespace", "class", "property", "function", "variable"],
        tokenModifiers: [],
      }),
      provideDocumentSemanticTokens: async (
        model: any,
        _lastResultId: string | null,
        token: { isCancellationRequested?: boolean },
      ) => {
        if (!handlesModel(model)) return { data: new Uint32Array() };
        const result = await lspClient.getSemanticTokens(documentUri);
        if (token.isCancellationRequested || !result) {
          return { data: new Uint32Array() };
        }
        return {
          resultId: result.resultId,
          data: Uint32Array.from(result.data),
        };
      },
      releaseDocumentSemanticTokens: () => undefined,
    }),
    monaco.languages.registerInlayHintsProvider(editorLanguageId, {
      displayName: "Database parameter and INSERT column hints",
      provideInlayHints: async (
        model: any,
        range: any,
        token?: { isCancellationRequested?: boolean },
      ) => {
        if (!handlesModel(model)) {
          return emptyDisposableResult({ hints: [] });
        }
        const modelVersion = providerModelVersion(model);
        let hints;
        try {
          hints = await lspClient.getInlayHints(documentUri, {
            start: {
              line: range.startLineNumber - 1,
              character: range.startColumn - 1,
            },
            end: {
              line: range.endLineNumber - 1,
              character: range.endColumn - 1,
            },
          });
        } catch (error) {
          console.error("[LSP] Inlay hints failed:", error);
          return emptyDisposableResult({ hints: [] });
        }
        if (!providerRequestIsCurrent(model, modelVersion, token)) {
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
        const provisionalScanStartPosition = model.getPositionAt(
          provisionalScanStart,
        );
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
        const insertValueHints = sqlInsertValueHints(
          model.getValueInRange(scanRange),
        )
          .map((hint) => ({ ...hint, offset: hint.offset + scanStart }))
          .filter((hint) => hint.offset >= rangeStart && hint.offset <= rangeEnd)
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
    dispose: () => disposables.forEach((disposable) => disposable.dispose()),
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
    isActivePane,
    lspClient,
    monaco,
  } = options;

  useEffect(() => {
    if (!isActivePane || !monaco) return;
    return registerLspCoreProviders({
      activeProjectId,
      canUseLsp,
      documentUri,
      editorLanguageId,
      lspClient,
      monaco,
    }).dispose;
  }, [
    activeProjectId,
    canUseLsp,
    documentUri,
    editorLanguageId,
    isActivePane,
    lspClient,
    monaco,
  ]);
}
