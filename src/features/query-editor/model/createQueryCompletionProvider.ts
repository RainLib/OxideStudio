import { boundedSqlCompletionTextBeforeCursor } from "@/features/query-editor/model/cachedSqlCompletion";
import {
  limitCompletionSuggestions,
  mergeCompletionFallbackSuggestions,
} from "@/features/query-editor/model/completionFallback";
import {
  MAX_QUERY_EDITOR_COMPLETION_SUGGESTIONS,
  mongodbJsonStringCompletionRange,
  OPEN_BATCH_COLUMN_SELECTION_COMMAND,
  RECORD_COMPLETION_USAGE_COMMAND,
  SqlBatchColumnRuntimeSession,
} from "@/features/query-editor/model/completionProviderRuntime";
import { isCompletionRequestCurrent } from "@/features/query-editor/model/completionRequestGuard";
import {
  applyResolvedLspCompletionItem,
  completionLabelForMonaco,
  completionResolveRequestContext,
  lspCompletionItemsToMonacoSuggestions,
  markResolvableLspCompletionItems,
  sourceLspCompletionItem,
} from "@/features/query-editor/model/lspCompletionPresentation";
import { syncLspModelBeforeCompletion } from "@/features/query-editor/model/lspDocumentSync";
import {
  sqlBatchColumnMode,
  uniqueSqlBatchColumnCandidates,
} from "@/features/query-editor/model/sqlBatchColumnSelection";
import {
  appendSqlCompletionSpace,
  shouldChainSqlCompletionAfterAccept,
  sqlCompletionItemType,
} from "@/features/query-editor/model/sqlCompletionInsertion";
import { recordSqlCompletionTelemetry } from "@/features/query-editor/model/sqlCompletionTelemetry";
import { sqlCompletionTriggerDecision } from "@/features/query-editor/model/sqlCompletionTriggerPolicy";
import { sqlSyntaxFallbackCompletions } from "@/features/query-editor/model/sqlSyntaxFallback";
import {
  completionUsageScore,
  usageRankedCompletionSortText,
} from "@/lib/completionUsage";
import { lspLanguageId } from "@/lib/databaseDialect";
import {
  elasticsearchConsoleCompletionContext,
  elasticsearchConsoleRequestContext,
  elasticsearchSchemaCompletionsForContext,
} from "@/lib/elasticsearchConsole";
import {
  completionFilterText,
  completionInsertText,
  filterCompletionsForSqlContext,
  isCompletedSqlContextKeyword,
  sqlContextKeywordBeforeCursor,
  toLspCompletionContext,
  toMonacoCompletionKind,
} from "@/lib/lspCompletion";
import {
  buildRedisCompletionItems,
  getRedisCompletionContext,
  takesRedisKeyArgument,
} from "@/lib/redisCompletion";
import {
  loadRedisCommandDocumentation,
  loadRedisCompletionKeys,
} from "@/lib/redisCompletionSource";
import { extractLspDocumentIdentity } from "@/services/lsp";
import type { LspCancellationToken } from "@/services/lsp/client";

interface QueryCompletionProviderContext {
  monaco: typeof import("monaco-editor") | null;
  completionTriggerOriginRef: React.RefObject<"explicit" | "chained" | null>;
  documentUri: string;
  effectiveConnectionId: string | null;
  isCurrentLspModelUri: (uri: string) => boolean;
  activeTab: import("@/store/useTabStore").TabData | undefined;
  currentSchema: string | null;
  activeConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  metadataVersion: number;
  editorSettings: import("@/lib/appSettings").AppSettings["editor"];
  usageScope: string;
  completionRequestGenerationRef: React.RefObject<Map<string, number>>;
  createCachedSqlCompletionRequest: (
    request: import("@/features/query-editor/model/cachedSqlCompletion").CachedSqlCompletionRequestOptions,
  ) => import("@/features/query-editor/model/cachedSqlCompletion").CachedSqlCompletionRequest;
  capabilities: import("@/services/tauri/types").DatabaseCapabilities;
  rankByUsage: boolean;
  completionOwnerKey: string;
  driver: import("@/services/tauri/types").DatabaseDriver;
  batchColumnSessionsRef: React.RefObject<
    Map<string, SqlBatchColumnRuntimeSession>
  >;
  preferredElasticsearchIndex: string | undefined;
  lspReady: boolean;
  documentLanguageId: string;
  lspClient: import("@/services/lsp/client").LspClient;
  openedDocumentsRef: React.RefObject<Set<string>>;
  documentVersionsRef: React.RefObject<Map<string, number>>;
  documentTextsRef: React.RefObject<Map<string, string>>;
  mountedEditor: any;
}

export function createQueryCompletionProvider({
  monaco,
  completionTriggerOriginRef,
  documentUri,
  effectiveConnectionId,
  isCurrentLspModelUri,
  activeTab,
  currentSchema,
  activeConnection,
  metadataVersion,
  editorSettings,
  usageScope,
  completionRequestGenerationRef,
  createCachedSqlCompletionRequest,
  capabilities,
  rankByUsage,
  completionOwnerKey,
  driver,
  batchColumnSessionsRef,
  preferredElasticsearchIndex,
  lspReady,
  documentLanguageId,
  lspClient,
  openedDocumentsRef,
  documentVersionsRef,
  documentTextsRef,
  mountedEditor,
}: QueryCompletionProviderContext) {
  const provideCompletionItems = async (
    model: any,
    position: any,
    context: any,
    token: LspCancellationToken,
  ) => {
    if (!monaco) return { suggestions: [] };
    const completionStartedAt = performance.now();
    // Metadata/FK fallback work can outlive an LSP response. Capture
    // this before either branch starts so no older cursor revision can
    // publish a late merged completion list.
    const initialModelVersion = model.getVersionId();
    const completionUri = model.uri.toString();
    const textBeforeCursor = boundedSqlCompletionTextBeforeCursor(
      monaco,
      model,
      position,
    );
    const completionIdentity = extractLspDocumentIdentity(model.uri.toString());
    const completionDriver =
      completionIdentity?.driver.toLocaleLowerCase() || "";
    const isRedisCompletionDocument = completionDriver === "redis";
    const isSqlCompletionDocument = ![
      "elasticsearch",
      "elastic",
      "mongodb",
      "redis",
    ].includes(completionDriver);
    const explicitCompletion = completionTriggerOriginRef.current !== null;
    completionTriggerOriginRef.current = null;
    if (isRedisCompletionDocument) {
      if (
        completionUri !== documentUri ||
        !effectiveConnectionId ||
        !isCurrentLspModelUri(completionUri)
      ) {
        return { suggestions: [] };
      }
      const source = model.getValue();
      const offset = model.getOffsetAt(position);
      const redisDatabase =
        activeTab?.targetSchema ||
        currentSchema ||
        activeConnection?.database ||
        "0";
      const commands = await loadRedisCommandDocumentation(
        effectiveConnectionId,
        redisDatabase,
        metadataVersion,
      );
      if (
        token?.isCancellationRequested ||
        model.getVersionId() !== initialModelVersion
      ) {
        return { suggestions: [] };
      }
      const redisContext = getRedisCompletionContext(source, offset, {
        commands,
      });
      let keys: string[] = [];
      if (
        redisContext.mode === "argument" &&
        takesRedisKeyArgument(
          redisContext.commandName,
          { commands },
          redisContext.argumentIndex,
          redisContext.argumentValues,
        )
      ) {
        try {
          keys = await loadRedisCompletionKeys(
            effectiveConnectionId,
            redisDatabase,
            metadataVersion,
          );
        } catch {
          // Command and argument completion remain useful when SCAN is denied.
        }
      }
      if (
        token?.isCancellationRequested ||
        model.getVersionId() !== initialModelVersion
      ) {
        return { suggestions: [] };
      }
      const start = model.getPositionAt(redisContext.from);
      const range = new monaco.Range(
        start.lineNumber,
        start.column,
        position.lineNumber,
        position.column,
      );
      const suggestions = buildRedisCompletionItems(redisContext, {
        commands,
        keys,
      }).map((item) => ({
        label: item.label,
        kind:
          item.type === "key"
            ? monaco.languages.CompletionItemKind.Reference
            : item.type === "value"
              ? monaco.languages.CompletionItemKind.Value
              : monaco.languages.CompletionItemKind.Keyword,
        detail: item.detail,
        documentation: item.documentation
          ? { value: item.documentation }
          : undefined,
        insertText: `${item.insertText || item.label}${
          item.appendSpace ? " " : ""
        }`,
        filterText: item.label,
        sortText: item.sortText,
        range,
      }));
      return { suggestions, incomplete: false };
    }
    if (isSqlCompletionDocument) {
      const trigger = sqlCompletionTriggerDecision(
        editorSettings.sqlCompletion.triggerMode,
        textBeforeCursor,
        explicitCompletion,
        completionDriver,
      );
      if (!trigger.allowed) {
        recordSqlCompletionTelemetry({
          scope: usageScope,
          outcome: "empty",
          durationMs: performance.now() - completionStartedAt,
          suggestionCount: 0,
          reason: `trigger:${trigger.reason}`,
        });
        return { suggestions: [] };
      }
    }
    if (!isCurrentLspModelUri(completionUri)) {
      return { suggestions: [] };
    }
    // Advance the generation for every accepted request, including the
    // cache-only path used while LSP is restarting. A model version does
    // not change when the user reopens completion at the same cursor, so
    // version checks alone cannot prevent an older fallback from
    // replacing a newer list.
    const requestGeneration =
      (completionRequestGenerationRef.current.get(completionUri) || 0) + 1;
    completionRequestGenerationRef.current.set(
      completionUri,
      requestGeneration,
    );
    const isCompletionCurrent = () =>
      isCompletionRequestCurrent({
        model,
        modelVersion: initialModelVersion,
        token,
        currentGeneration:
          completionRequestGenerationRef.current.get(completionUri),
        requestGeneration,
      });
    const cachedCompletion = createCachedSqlCompletionRequest({
      completionDriver,
      model,
      monaco,
      position,
      textBeforeCursor,
      token,
    });
    const cachedJoinSuggestions = cachedCompletion.joinSuggestions;
    const cachedMetadataSuggestions = cachedCompletion.metadataSuggestions;
    const cachedSuggestions = cachedCompletion.suggestions;
    const fallbackSuggestions = async () => {
      const cached = await cachedSuggestions();
      if (!isCompletionCurrent()) return [];
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const typedWord = model.getValueInRange(range);
      const nextCharacter = model
        .getLineContent(position.lineNumber)
        .slice(position.column - 1, position.column);
      const completedContextKeyword = isCompletedSqlContextKeyword(typedWord);
      const insertRange = completedContextKeyword
        ? new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          )
        : range;
      const syntax = sqlSyntaxFallbackCompletions(textBeforeCursor, {
        driver: capabilities.driver,
        supportsSqlQuery: capabilities.supportsSqlQuery,
        keywordCase: editorSettings.sqlFormatting.keywordCase,
        functionCase: editorSettings.sqlFormatting.functionCase,
        snippets: editorSettings.sqlCompletion.snippets,
      }).map((item) => {
        // Use the same completed-keyword replacement semantics as a
        // live LSP response. In particular, an offline/restarting LSP
        // must append ` DISTINCT` after a typed `SELECT`, not replace
        // the statement keyword with the fallback proposal.
        const insertText = appendSqlCompletionSpace(
          completionInsertText(item, completedContextKeyword),
          {
            enabled: editorSettings.sqlCompletion.appendSpace,
            itemType: sqlCompletionItemType(item),
            nextCharacter,
          },
        );
        const chainCompletion = shouldChainSqlCompletionAfterAccept(
          item,
          insertText,
          completionDriver,
        );
        return {
          label: completionLabelForMonaco(item),
          kind: toMonacoCompletionKind(monaco, item.kind),
          detail: item.detail || "SQL syntax",
          documentation: item.documentation
            ? { value: item.documentation }
            : { value: "Available SQL syntax for the current clause." },
          insertText,
          filterText: completionFilterText(
            item,
            typedWord,
            completedContextKeyword,
          ),
          sortText: rankByUsage
            ? usageRankedCompletionSortText(
                item.sortText || `9:${item.label}`,
                completionUsageScore(usageScope, item.label),
              )
            : item.sortText || `9:${item.label}`,
          command:
            rankByUsage || chainCompletion
              ? {
                  id: RECORD_COMPLETION_USAGE_COMMAND,
                  title: chainCompletion
                    ? "Continue SQL completion"
                    : "Record SQL completion usage",
                  arguments: [
                    usageScope,
                    item.label,
                    chainCompletion,
                    completionOwnerKey,
                  ],
                }
              : undefined,
          insertTextRules:
            item.insertTextFormat === 2
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          range: insertRange,
        };
      });
      return mergeCompletionFallbackSuggestions(cached, syntax);
    };
    const result = (
      suggestions: any[],
      outcome: "lsp" | "fallback" | "empty" | "discarded" | "error",
      reason?: string,
      incomplete = false,
    ) => {
      let presentedSuggestions = suggestions;
      const batchMode = isSqlCompletionDocument
        ? sqlBatchColumnMode(textBeforeCursor, driver)
        : null;
      if (batchMode && suggestions.length > 1) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const replacedText = model.getValueInRange(range);
        const candidates = uniqueSqlBatchColumnCandidates(
          suggestions
            .filter(
              (suggestion) =>
                suggestion.kind === monaco.languages.CompletionItemKind.Field &&
                typeof suggestion.insertText === "string",
            )
            .map((suggestion) => {
              const label =
                typeof suggestion.label === "string"
                  ? suggestion.label
                  : suggestion.label?.label || String(suggestion.insertText);
              return {
                key: `${label}\u0000${suggestion.insertText}`,
                label,
                insertText: suggestion.insertText,
                detail: suggestion.detail,
              };
            }),
        );
        if (candidates.length > 1) {
          const sessionId = `${completionOwnerKey}\u0000${initialModelVersion}\u0000${model.getOffsetAt(position)}\u0000${batchMode}`;
          const session: SqlBatchColumnRuntimeSession = {
            id: sessionId,
            ownerKey: completionOwnerKey,
            uri: completionUri,
            modelVersion: initialModelVersion,
            mode: batchMode,
            candidates,
            range,
            replacedText,
          };
          batchColumnSessionsRef.current.clear();
          batchColumnSessionsRef.current.set(sessionId, session);
          presentedSuggestions = [
            ...suggestions,
            {
              label: `Choose columns… (${candidates.length})`,
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail:
                batchMode === "insert"
                  ? "Build columns and matching VALUES placeholders"
                  : "Select multiple columns in metadata order",
              insertText: replacedText,
              filterText: replacedText || undefined,
              // Preserve the ordinary single-column Enter target; the
              // batch action remains discoverable at the end of the list.
              sortText: "zzzz:batch-columns",
              range,
              command: {
                id: OPEN_BATCH_COLUMN_SELECTION_COMMAND,
                title: "Choose columns",
                arguments: [completionOwnerKey, sessionId],
              },
            },
          ];
        }
      }
      recordSqlCompletionTelemetry({
        scope: usageScope,
        outcome,
        durationMs: performance.now() - completionStartedAt,
        suggestionCount: presentedSuggestions.length,
        reason,
      });
      return { suggestions: presentedSuggestions, incomplete };
    };
    try {
      const uri = completionUri;
      const modelVersion = initialModelVersion;

      const identity = extractLspDocumentIdentity(uri);
      const isElasticsearchDocument =
        identity?.driver === "elasticsearch" || identity?.driver === "elastic";
      const isMongoDbDocument = identity?.driver === "mongodb";
      const elasticsearchContext = isElasticsearchDocument
        ? elasticsearchConsoleCompletionContext(
            model.getValue(),
            model.getOffsetAt(position),
          )
        : null;
      const elasticsearchRequestContext = elasticsearchContext
        ? elasticsearchConsoleRequestContext(
            model.getValue(),
            model.getOffsetAt(position),
            preferredElasticsearchIndex,
          )
        : null;
      if (elasticsearchContext) {
        // The Console provider owns methods, REST operations, DSL keys,
        // live index names, and mapping fields. Keeping all of these in
        // one provider prevents a late generic-LSP catalog from mixing
        // a previous connection's indices into the active request.
        return result([], "empty", "consoleSyntaxOwned");
      }
      if (isMongoDbDocument) {
        // MongoDB JSON commands intentionally have no SQL-LSP builtin
        // catalog. Its document-gated Console provider owns semantic
        // suggestions, avoiding an empty JSON LSP round trip on every
        // automatic trigger.
        return result([], "empty", "mongoConsoleOwned");
      }
      if (!lspReady) {
        const suggestions = await fallbackSuggestions();
        return result(
          suggestions,
          suggestions.length > 0 ? "fallback" : "empty",
          suggestions.length > 0 ? "lspNotReady" : "lspNotReadyNoFallback",
        );
      }
      const languageId =
        identity?.driver?.toLowerCase() === driver.toLowerCase()
          ? documentLanguageId
          : identity?.driver
            ? lspLanguageId(identity.driver)
            : "sql";
      await syncLspModelBeforeCompletion({
        uri,
        model,
        languageId,
        client: lspClient,
        openedDocuments: openedDocumentsRef.current,
        documentVersions: documentVersionsRef.current,
        documentTexts: documentTextsRef.current,
      });

      // Now request completions with synchronized state
      const completionList = await lspClient.getCompletionList(
        uri,
        position.lineNumber - 1, // LSP uses 0-indexed lines
        position.column - 1, // LSP uses 0-indexed columns
        toLspCompletionContext(context),
        token,
      );
      const items = markResolvableLspCompletionItems(
        completionList.items,
        completionList.resolveProvider,
      );

      if (
        !isCompletionRequestCurrent({
          model,
          modelVersion,
          token,
          currentGeneration: completionRequestGenerationRef.current.get(uri),
          requestGeneration,
        })
      ) {
        const reason = token?.isCancellationRequested
          ? "cancelled"
          : model.getVersionId() !== modelVersion
            ? "modelChanged"
            : "superseded";
        return result([], "discarded", reason);
      }

      // Get the word being typed for range calculation
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const typedWord = model.getValueInRange(range);
      const nextCharacter = model
        .getLineContent(position.lineNumber)
        .slice(position.column - 1, position.column);
      const completedContextKeyword = isCompletedSqlContextKeyword(typedWord);
      const sqlContextKeyword = sqlContextKeywordBeforeCursor(textBeforeCursor);
      const insertRange = completedContextKeyword
        ? new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          )
        : range;
      const filteredItems = elasticsearchContext
        ? elasticsearchSchemaCompletionsForContext(
            items,
            elasticsearchContext,
            elasticsearchRequestContext?.index || preferredElasticsearchIndex,
          )
        : filterCompletionsForSqlContext(items, sqlContextKeyword);
      // SQL LSPs commonly return field names after `WHERE column` but
      // omit operators, and the context filter deliberately removes
      // unrelated operators. Merge the small grammar layer afterwards
      // so a partial live result cannot hide `=`, `IN`, `LIKE`, or the
      // next boolean connector. Non-SQL console languages keep their
      // own grammar and are not mixed with this fallback.
      const completionItems =
        elasticsearchContext || isMongoDbDocument
          ? filteredItems
          : mergeCompletionFallbackSuggestions(
              filteredItems,
              sqlSyntaxFallbackCompletions(textBeforeCursor, {
                driver: capabilities.driver,
                supportsSqlQuery: capabilities.supportsSqlQuery,
                keywordCase: editorSettings.sqlFormatting.keywordCase,
                functionCase: editorSettings.sqlFormatting.functionCase,
                snippets: editorSettings.sqlCompletion.snippets,
              }),
            );
      const lineBeforeCursor = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      const requestPathPrefix = lineBeforeCursor.match(
        /^(\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+)(.*)$/i,
      );
      const jsonStringFragment = lineBeforeCursor.match(/"[\w.@*-]*"?$/u)?.[0];
      const elasticsearchInsertRange = requestPathPrefix
        ? new monaco.Range(
            position.lineNumber,
            requestPathPrefix[1]!.length + 1,
            position.lineNumber,
            position.column,
          )
        : jsonStringFragment?.endsWith('"')
          ? new monaco.Range(
              position.lineNumber,
              lineBeforeCursor.length - jsonStringFragment.length + 1,
              position.lineNumber,
              position.column,
            )
          : insertRange;
      const mongodbInsertRange = isMongoDbDocument
        ? mongodbJsonStringCompletionRange(monaco, model, position)
        : insertRange;

      const suggestions = lspCompletionItemsToMonacoSuggestions({
        monaco,
        ownerKey: completionOwnerKey,
        items: completionItems,
        typedWord,
        completedContextKeyword,
        defaultRange: elasticsearchContext
          ? elasticsearchInsertRange
          : isMongoDbDocument
            ? mongodbInsertRange
            : insertRange,
        rankByUsage,
        usageScope,
        recordUsageCommand: RECORD_COMPLETION_USAGE_COMMAND,
        driver: completionDriver,
        nextCharacter,
        requestUri: uri,
        requestModelVersion: modelVersion,
      });
      const cachedMetadata = await cachedMetadataSuggestions();
      if (
        !isCompletionRequestCurrent({
          model,
          modelVersion,
          token,
          currentGeneration: completionRequestGenerationRef.current.get(uri),
          requestGeneration,
        })
      ) {
        return result([], "discarded", "metadataChanged");
      }
      const suggestionsWithMetadata = mergeCompletionFallbackSuggestions(
        suggestions,
        cachedMetadata,
      );
      const cachedJoins = await cachedJoinSuggestions();
      if (
        token?.isCancellationRequested ||
        model.getVersionId() !== modelVersion ||
        completionRequestGenerationRef.current.get(uri) !== requestGeneration
      ) {
        return result([], "discarded", "joinMetadataChanged");
      }
      const suggestionsWithSmartJoins = mergeCompletionFallbackSuggestions(
        cachedJoins,
        suggestionsWithMetadata,
      );

      // A healthy language server can still return no proposals while
      // metadata is being refreshed, a newly opened document has not
      // reached its first semantic pass, or a generic dialect cannot
      // classify a vendor extension. Preserve the same conservative
      // cache fallback used during startup in that narrow case. It only
      // returns an unambiguous relation's columns or existing Explorer
      // objects, so an empty LSP response never turns into cross-schema
      // guessing.
      const boundedSuggestions = limitCompletionSuggestions(
        suggestionsWithSmartJoins,
        MAX_QUERY_EDITOR_COMPLETION_SUGGESTIONS,
      );
      if (boundedSuggestions.length > 0) {
        return result(
          boundedSuggestions,
          "lsp",
          undefined,
          completionList.isIncomplete,
        );
      }
      const fallback = await fallbackSuggestions();
      return result(
        fallback,
        fallback.length > 0 ? "fallback" : "empty",
        fallback.length > 0 ? "emptyLsp" : "emptyLspNoFallback",
        completionList.isIncomplete,
      );
    } catch (error) {
      console.error("[LSP] Completion failed:", error);
      const fallback = await fallbackSuggestions();
      return result(
        fallback,
        "error",
        fallback.length > 0 ? "lspErrorFallback" : "lspErrorEmpty",
      );
    }
  };

  const resolveCompletionItem = async (
    suggestion: any,
    token: LspCancellationToken,
  ) => {
    const sourceItem = sourceLspCompletionItem(suggestion);
    const resolveContext = completionResolveRequestContext(suggestion);
    const model = mountedEditor?.getModel();
    if (
      !monaco ||
      !sourceItem ||
      token?.isCancellationRequested ||
      (resolveContext &&
        (!model ||
          model.uri.toString() !== resolveContext.uri ||
          model.getVersionId() !== resolveContext.modelVersion))
    ) {
      return suggestion;
    }
    const resolvedItem = await lspClient.resolveCompletionItem(
      sourceItem,
      token,
    );
    const currentModel = mountedEditor?.getModel();
    if (
      token?.isCancellationRequested ||
      (resolveContext &&
        (!currentModel ||
          currentModel.uri.toString() !== resolveContext.uri ||
          currentModel.getVersionId() !== resolveContext.modelVersion))
    ) {
      return suggestion;
    }
    return applyResolvedLspCompletionItem(monaco, suggestion, resolvedItem);
  };

  return { provideCompletionItems, resolveCompletionItem };
}
