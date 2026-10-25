import { createInlineCompletionRequestId } from "@/features/query-editor/model/completionProviderRuntime";
import {
  inlineCompletionEdit,
  inlineIdentifierSuffixLength,
  optionalInlineLspContext,
  optionalInlineLspValidation,
} from "@/features/query-editor/model/inlineCompletionRuntime";
import { syncLspModelBeforeCompletion } from "@/features/query-editor/model/lspDocumentSync";
import { sqlSyntaxFallbackCompletions } from "@/features/query-editor/model/sqlSyntaxFallback";
import { completionUsageScore } from "@/lib/completionUsage";
import {
  elasticsearchCompletionExpectsMappingField,
  elasticsearchConsoleCompletionContext,
  elasticsearchConsoleInlineSuggestion,
  elasticsearchConsoleRequestContext,
  validateElasticsearchConsole,
} from "@/lib/elasticsearchConsole";
import {
  boundedInlineContext,
  cleanInlineSuggestion,
  inlineCompletionCacheKey,
  localInlineSuggestion,
  mergeInlineCompletionCandidates,
  shouldRequestAiInlineCompletion,
} from "@/lib/inlineCompletion";
import { redactSecretString } from "@/lib/redaction";
import { CompletionItemKind } from "@/services/lsp/types";
import { aiService } from "@/services/tauri/ai.service";
import { projectFilesService } from "@/services/tauri/project-files.service";
import { useEffect } from "react";
import {captureInlineProviderRequest,watchInlineProviderContext} from "../model/inlineProviderContext";
import type {LspProviderContextOptions} from "../model/lspProviderContext";
import {documentInlineContext} from "../model/documentInlineContext";
interface InlineCompletionProviderContext extends LspProviderContextOptions {
  editorSettings: import("@/lib/appSettings").AppSettings["editor"];
  isActivePane: boolean;
  monaco: typeof import("monaco-editor") | null;
  inlineCompletionAbortRef: React.RefObject<AbortController | null>;
  setInlineCompletionStatus: React.Dispatch<
    React.SetStateAction<
      import("@/lib/inlineCompletion").InlineCompletionStatus
    >
  >;
  inlineCompletionCacheRef: React.RefObject<
    import("@/lib/inlineCompletion").InlineCompletionCache
  >;
  inlineProviderConfig: () =>
    | import("@/services/tauri/ai.service").AiHttpProviderConfig
    | null;
  editorLanguageId: string;
  inlineCompletionListenersRef: React.RefObject<Set<() => void>>;
  documentUri: string;
  mountedEditor: any;
  isElasticsearchConsole: boolean;
  preferredElasticsearchIndex: string | undefined;
  elasticsearchServerVersion:
    | import("@/lib/elasticsearchConsole").ElasticsearchServerVersion
    | undefined;
  driver: import("@/services/tauri/types").DatabaseDriver;
  capabilities: import("@/services/tauri/types").DatabaseCapabilities;
  lspReady: boolean;
  canUseLsp: boolean;
  documentLanguageId: string;
  lspClient: import("@/services/lsp/client").LspClient;
  openedDocumentsRef: React.RefObject<Set<string>>;
  documentVersionsRef: React.RefObject<Map<string, number>>;
  documentTextsRef: React.RefObject<Map<string, string>>;
  usageScope: string;
  inlineCompletionProtocol: import("@/store/useAiSettingsStore").InlineCompletionProtocol;
  inlineCompletionModel: string;
  activeTab: import("@/store/useTabStore").TabData | undefined;
  projectId: string;
  projectRootPath: string | null;
  inlineBaseUrl: string;
  inlineApiKey: string;
  inlineTimeoutMs: number;
  rankByUsage: boolean;
}

export function useInlineCompletionProvider({
  editorSettings,
  isActivePane,
  monaco,
  inlineCompletionAbortRef,
  setInlineCompletionStatus,
  inlineCompletionCacheRef,
  inlineProviderConfig,
  editorLanguageId,
  inlineCompletionListenersRef,
  documentUri,
  mountedEditor,
  isElasticsearchConsole,
  preferredElasticsearchIndex,
  elasticsearchServerVersion,
  driver,
  capabilities,
  lspReady,
  canUseLsp,
  documentLanguageId,
  lspClient,
  openedDocumentsRef,
  documentVersionsRef,
  documentTextsRef,
  usageScope,
  inlineCompletionProtocol,
  inlineCompletionModel,
  activeTab,
  projectId,
  projectRootPath,
  inlineBaseUrl,
  inlineApiKey,
  inlineTimeoutMs,
  rankByUsage,
  getSemanticContext,subscribeSemanticContext,
}: InlineCompletionProviderContext) {
  useEffect(() => {
    const settings = editorSettings.inlineCompletion;
    if (!isActivePane || !monaco || !settings.enabled) {
      inlineCompletionAbortRef.current?.abort();
      setInlineCompletionStatus(settings.enabled ? "offline" : "off");
      return;
    }

    let disposed = false;
    let requestSequence = 0;
    inlineCompletionCacheRef.current.clear();
    setInlineCompletionStatus(
      inlineProviderConfig() ? "ready" : "unconfigured",
    );
    const providerLanguages = [editorLanguageId];
    const emitInlineCompletionChange = () => {
      inlineCompletionListenersRef.current.forEach((listener) => listener());
    };
    const releaseContext=watchInlineProviderContext({getSemanticContext,subscribeSemanticContext,editor:mountedEditor,
      invalidate:()=>{
        requestSequence++;inlineCompletionAbortRef.current?.abort();inlineCompletionAbortRef.current=null;
        inlineCompletionCacheRef.current.clear();
        setInlineCompletionStatus(inlineProviderConfig()?"ready":"unconfigured");emitInlineCompletionChange();
      }});
    const disposables = providerLanguages.map((language) =>
      monaco.languages.registerInlineCompletionsProvider(language, {
        displayName: "OxideStudio AI",
        debounceDelayMs: 300,
        onDidChangeInlineCompletions: (listener: () => void) => {
          inlineCompletionListenersRef.current.add(listener);
          return {
            dispose: () =>
              inlineCompletionListenersRef.current.delete(listener),
          };
        },
        provideInlineCompletions: async (
          model: any,
          position: any,
          context: any,
          token: any,
        ) => {
          const uri = model.uri.toString();
          if (disposed || uri !== documentUri) {
            return { items: [] };
          }
          const explicit =
            context.triggerKind ===
            monaco.languages.InlineCompletionTriggerKind.Explicit;
          const selection = mountedEditor?.getSelection?.();
          const hasSelection = Boolean(selection && !selection.isEmpty());
          const sequence = ++requestSequence;
          inlineCompletionAbortRef.current?.abort();inlineCompletionAbortRef.current=null;
          const captured=captureInlineProviderRequest({read:getSemanticContext,model,token,
            isActive:()=>!disposed&&sequence===requestSequence&&(!mountedEditor?.getModel||mountedEditor.getModel()===model)});
          const isCurrent=captured.isCurrent;
          if(!isCurrent())return {items:[]};
          const offset = model.getOffsetAt(position);
          const value = model.getValue();
          const bounded = boundedInlineContext(value, offset);
          const inlineResult = (text: string, replaceSuffixLength = 0) => {
            if (!text || !isCurrent()) return { items: [] };
            if (!isElasticsearchConsole) {
              const edit = inlineCompletionEdit({
                text,
                model,
                position,
                selectedSuggestion: context.selectedSuggestionInfo,
                replaceSuffixLength,
              });
              return {
                items: edit
                  ? [
                      {
                        ...edit,
                        completeBracketPairs: true,
                        command: {
                          id: "editor.action.inlineSuggest.trigger",
                          title: "Continue inline completion",
                        },
                      },
                    ]
                  : [],
              };
            }
            const insertText =
              text.includes("\n") &&
              position.column < model.getLineMaxColumn(position.lineNumber)
                ? text.split("\n", 1)[0]
                : text;
            const endPosition = replaceSuffixLength
              ? model.getPositionAt(
                  Math.min(value.length, offset + replaceSuffixLength),
                )
              : position;
            return {
              items: insertText
                ? [
                    {
                      insertText,
                      range: new monaco.Range(
                        position.lineNumber,
                        position.column,
                        endPosition.lineNumber,
                        endPosition.column,
                      ),
                      completeBracketPairs: true,
                      command: {
                        id: "editor.action.inlineSuggest.trigger",
                        title: "Continue inline completion",
                      },
                    },
                  ]
                : [],
            };
          };
          if (
            isElasticsearchConsole &&
            !hasSelection &&
            (explicit || settings.automaticSuggestions)
          ) {
            const consoleText = elasticsearchConsoleInlineSuggestion(
              value,
              offset,
              preferredElasticsearchIndex,
              elasticsearchServerVersion,
            );
            if (consoleText) {
              setInlineCompletionStatus("local");
              const replaceClosingQuote =
                value[offset] === '"' && consoleText.includes('"') ? 1 : 0;
              return inlineResult(consoleText, replaceClosingQuote);
            }
          }
          if (
            !shouldRequestAiInlineCompletion({
              prefix: bounded.prefix,
              hasSelection,
              automatic: settings.automaticSuggestions,
              explicit,
              dialect: driver,
            })
          ) {
            return { items: [] };
          }
          const commandSnippetAdditions = isElasticsearchConsole
            ? []
            : sqlSyntaxFallbackCompletions(bounded.prefix, {
                driver: capabilities.driver,
                supportsSqlQuery: capabilities.supportsSqlQuery,
                keywordCase: editorSettings.sqlFormatting.keywordCase,
                functionCase: editorSettings.sqlFormatting.functionCase,
                snippets: editorSettings.sqlCompletion.snippets,
              })
                .filter((item) => item.kind === CompletionItemKind.Snippet)
                .map((item) => ({
                  label: item.label,
                  insertText: item.insertText || item.label,
                  kind: item.kind,
                  sortText: item.sortText,
                  preferred: item.sortText?.startsWith("0:") || false,
                }));
          const semantic = await optionalInlineLspContext({
            available: lspReady && canUseLsp && captured.metadataAllowed,
            load: async () => {
              if(!isCurrent())throw new Error("Inline context changed");
              await syncLspModelBeforeCompletion({
                uri,
                model,
                languageId: documentLanguageId,
                client: lspClient,
                openedDocuments: openedDocumentsRef.current,
                documentVersions: documentVersionsRef.current,
                documentTexts: documentTextsRef.current,
              });
              if(!isCurrent())throw new Error("Inline context changed");
              return lspClient.getInlineCompletionContext(
                uri,
                position.lineNumber - 1,
                position.column - 1,
              );
            },
          });
          if (!isCurrent()) return { items: [] };
          const lspContext = !semantic.context.candidates?.length&&!isElasticsearchConsole&&capabilities.supportsSqlQuery
            ? {...semantic.context,...await documentInlineContext({model,position,monaco,prefix:bounded.prefix,driver,
                sqlCompletion:editorSettings.sqlCompletion,sqlFormatting:editorSettings.sqlFormatting,token,isCurrent})}
            : semantic.context;
          if(!isCurrent())return {items:[]};
          const consoleContext = isElasticsearchConsole
            ? elasticsearchConsoleCompletionContext(value, offset)
            : null;
          const consoleRequestContext = consoleContext
            ? elasticsearchConsoleRequestContext(
                value,
                offset,
                preferredElasticsearchIndex,
              )
            : null;
          const completionContext =
            consoleRequestContext?.startOffset !== undefined
              ? boundedInlineContext(
                  consoleRequestContext.request,
                  offset - consoleRequestContext.startOffset,
                )
              : bounded;
          const scopedLspContext = consoleContext
            ? {
                ...lspContext,
                clause: `ElasticsearchConsole:${consoleContext.area}`,
                referencedObjects: consoleRequestContext?.index
                  ? [consoleRequestContext.index]
                  : [],
                expectedKinds: elasticsearchCompletionExpectsMappingField(
                  consoleContext,
                )
                  ? ["mapping-field"]
                  : [consoleContext.area],
                candidates: (lspContext.candidates || [])
                  .filter((candidate) => candidate.kind === 5)
                  .filter(
                    (candidate, index, rows) =>
                      rows.findIndex(
                        (item) =>
                          item.label.toLowerCase() ===
                          candidate.label.toLowerCase(),
                      ) === index,
                  ),
                console: {
                  ...consoleRequestContext,
                  request: consoleRequestContext?.request || "",
                  area: consoleContext.area,
                },
              }
            : mergeInlineCompletionCandidates(
                lspContext,
                commandSnippetAdditions,
                {
                  rankByUsage,
                  usageScore: (label) =>
                    completionUsageScore(usageScope, label),
                },
              );
          const canUseSchemaInlineCandidate = Boolean(
            consoleContext &&
              elasticsearchCompletionExpectsMappingField(consoleContext),
          );
          const localText =
            !isElasticsearchConsole || canUseSchemaInlineCandidate
              ? localInlineSuggestion(
                  completionContext.prefix,
                  scopedLspContext,
                )
              : "";
          const localSuffixLength=localText&&!isElasticsearchConsole?inlineIdentifierSuffixLength({
            prefix:completionContext.prefix,text:localText,context:scopedLspContext,model,monaco,position,
          }):0;

          // Mapping-aware LSP output is authoritative for Elasticsearch field
          // positions. Do not let a faster model response replace it with a
          // plausible but nonexistent field from another index.
          if (isElasticsearchConsole && localText) {
            setInlineCompletionStatus("local");
            return inlineResult(localText,localSuffixLength);
          }

          // Console syntax and mapping positions are deterministic. If the
          // local Console/LSP sources have no valid continuation, showing no
          // ghost text is safer than asking the model to invent a REST
          // operation, JSON key, or mapping field. AI remains available only
          // for genuinely unclassified Console content.
          if (isElasticsearchConsole && consoleContext?.area !== "unknown") {
            setInlineCompletionStatus("local");
            return { items: [] };
          }

          const provider = inlineProviderConfig();
          if (!provider) {
            setInlineCompletionStatus("unconfigured");
            return inlineResult(localText,localSuffixLength);
          }
          const aiLspContext = settings.includeSchemaMetadata
            ? scopedLspContext
            : {
                dialect: scopedLspContext.dialect,
                clause: scopedLspContext.clause,
                expectedKinds: scopedLspContext.expectedKinds,
                diagnostics: scopedLspContext.diagnostics,
                errorCount: scopedLspContext.errorCount,
                console: scopedLspContext.console,
              };
          const requestBase = {
            protocol: inlineCompletionProtocol,
            config: {
              ...provider,
              model: inlineCompletionModel.trim() || provider.model,
            },
            prefix: redactSecretString(completionContext.prefix),
            suffix: redactSecretString(completionContext.suffix),
            languageId: documentLanguageId,
            dialect: driver,
            ...(activeTab?.fileRelativePath
              ? { filePath: activeTab.fileRelativePath }
              : {}),
            lspContext: aiLspContext,
            relatedSnippets: [] as Array<{
              relativePath: string;
              content: string;
            }>,
          };
          const baseCacheKey = inlineCompletionCacheKey(requestBase);
          const cached = settings.includeProjectContext
            ? undefined
            : inlineCompletionCacheRef.current.get(baseCacheKey);
          if (cached !== undefined) {
            setInlineCompletionStatus("ai");
            return inlineResult(cached);
          }

          const abortController = new AbortController();
          inlineCompletionAbortRef.current = abortController;
          const cancellationSubscription = token.onCancellationRequested(() => {
            abortController.abort();
            if (!disposed && sequence === requestSequence) {
              setInlineCompletionStatus((status) =>
                status === "thinking"
                  ? localText
                    ? "local"
                    : "ready"
                  : status,
              );
            }
          });
          setInlineCompletionStatus("thinking");
          const aiPromise = (async () => {
            try {
              const relatedSnippets =
                settings.includeProjectContext && projectId && projectRootPath
                  ? await projectFilesService.getCompletionContext({
                      projectId,
                      expectedRoot: projectRootPath,
                      activeFile: activeTab?.fileRelativePath,
                      query: completionContext.prefix,
                      referencedObjects: scopedLspContext.referencedObjects,
                    })
                  : [];
              if (abortController.signal.aborted || !isCurrent()) return "";
              const request = {
                ...requestBase,
                requestId: createInlineCompletionRequestId(),
                relatedSnippets: relatedSnippets.map((snippet) => ({
                  ...snippet,
                  content: redactSecretString(snippet.content),
                })),
              };
              const cacheKey = inlineCompletionCacheKey(request);
              const cachedWithProject =
                inlineCompletionCacheRef.current.get(cacheKey);
              if (cachedWithProject !== undefined) return cachedWithProject;
              const result = await aiService.inlineCompletion(
                request,
                abortController.signal,
              );
              if (abortController.signal.aborted || !isCurrent()) {
                return "";
              }
              const completion = cleanInlineSuggestion(
                result.text,
                completionContext.prefix,
                completionContext.suffix,
              );
              if (!completion) return "";
              const nextText = `${value.slice(0, offset)}${completion}${value.slice(offset)}`;
              const nextDiagnostics = isElasticsearchConsole
                ? validateElasticsearchConsole(nextText)
                : await optionalInlineLspValidation({
                    available: semantic.available && captured.metadataAllowed && isCurrent(),
                    load: () =>
                      lspClient.validateInlineCompletion(uri, nextText),
                  });
              const baselineErrors = isElasticsearchConsole
                ? validateElasticsearchConsole(value).filter(
                    (diagnostic) => diagnostic.severity === "error",
                  ).length
                : (lspContext.errorCount ??
                  (lspContext.diagnostics || []).filter(
                    (diagnostic) => diagnostic.severity === 1,
                  ).length);
              const nextErrors = nextDiagnostics.filter((diagnostic) =>
                isElasticsearchConsole
                  ? diagnostic.severity === "error"
                  : diagnostic.severity === 1,
              ).length;
              if (!isCurrent() || abortController.signal.aborted) return "";
              if (nextErrors > baselineErrors) {
                setInlineCompletionStatus(localText ? "local" : "ready");
                return "";
              }
              inlineCompletionCacheRef.current.set(cacheKey, completion);
              if (!settings.includeProjectContext) {
                inlineCompletionCacheRef.current.set(baseCacheKey, completion);
              }
              if (isCurrent()) {
                setInlineCompletionStatus("ai");
                emitInlineCompletionChange();
              }
              return completion;
            } catch (error) {
              if (!abortController.signal.aborted && isCurrent()) {
                setInlineCompletionStatus("error");
                console.debug(
                  "[InlineCompletion] AI provider unavailable",
                  error,
                );
              }
              return "";
            } finally {
              cancellationSubscription.dispose();
              if (isCurrent()) {
                setInlineCompletionStatus((status) =>
                  status === "thinking"
                    ? localText
                      ? "local"
                      : "ready"
                    : status,
                );
              }
              if (inlineCompletionAbortRef.current === abortController) {
                inlineCompletionAbortRef.current = null;
              }
            }
          })();

          if (!localText) {
            return inlineResult(await aiPromise);
          }
          const fastAiText = await Promise.race([
            aiPromise,
            new Promise<string>((resolve) =>
              window.setTimeout(() => resolve(""), 120),
            ),
          ]);
          if (fastAiText) return inlineResult(fastAiText);
          // Keep "thinking" visible while a slower AI response is still pending.
          void aiPromise;
          return inlineResult(localText,localSuffixLength);
        },
        disposeInlineCompletions: () => undefined,
      }),
    );

    return () => {
      disposed = true;
      releaseContext();
      inlineCompletionAbortRef.current?.abort();
      inlineCompletionAbortRef.current = null;
      disposables.forEach((disposable) => disposable.dispose());
      inlineCompletionListenersRef.current.clear();
    };
  }, [
    activeTab?.fileRelativePath,
    inlineProviderConfig,
    inlineBaseUrl,
    inlineApiKey,
    inlineTimeoutMs,
    canUseLsp,
    capabilities.driver,
    capabilities.supportsSqlQuery,
    documentLanguageId,
    documentUri,
    driver,
    editorLanguageId,
    editorSettings.inlineCompletion,
    editorSettings.sqlFormatting.functionCase,
    editorSettings.sqlFormatting.keywordCase,
    editorSettings.sqlCompletion.snippets,
    inlineCompletionModel,
    inlineCompletionProtocol,
    isElasticsearchConsole,
    elasticsearchServerVersion,
    isActivePane,
    lspClient,
    lspReady,
    monaco,
    mountedEditor,
    projectId,
    projectRootPath,
    preferredElasticsearchIndex,
    rankByUsage,
    usageScope,
    getSemanticContext,subscribeSemanticContext,
  ]);
}
