export {
  enqueueLspDocumentSync,
  syncLspModelBeforeCompletion,
  type LspDocumentSyncChains,
  type LspDocumentSyncClient,
  type LspTextModel,
} from "./model/lspDocumentSync";
export { mergeCatalogNames } from "./model/catalogSelection";
export {
  completionSuggestionsOrCached,
  mergeCompletionFallbackSuggestions,
} from "./model/completionFallback";
export { sqlSyntaxFallbackCompletions } from "./model/sqlSyntaxFallback";
export {
  DEFAULT_SQL_COMMAND_SNIPPETS,
  MANTICORE_SQL_COMMAND_SNIPPETS,
  sqlCommandSnippetCompletions,
  type SqlCommandSnippetOptions,
  type SqlSnippetSetting,
} from "./model/sqlCommandSnippets";
export {
  editorDocumentIdentity,
  type EditorDocumentIdentity,
  type EditorDocumentTab,
} from "./model/editorDocumentIdentity";
export { buildQueryEditorOptions } from "./model/editorOptions";
export {
  completionFilterTextForQuery,
  completionMatchScore,
  completionMatches,
  containsHan,
  ensurePinyinCompletionSupport,
  pinyinInitials,
} from "./model/completionMatch";
export {
  sqlCompletionIdentifierPrefix,
  sqlCompletionTriggerDecision,
  type SqlCompletionTriggerDecision,
  type SqlCompletionTriggerMode,
} from "./model/sqlCompletionTriggerPolicy";
export {
  flattenLspSelectionRanges,
  isPublishDiagnosticsParams,
  lspDiagnosticToMonacoMarker,
  lspDocumentationForMonaco,
  toMonacoCompletionRange,
  toMonacoRange,
  toMonacoWorkspaceEdit,
} from "./model/lspMonacoAdapter";
export {
  completionLabelForMonaco,
  lspCompletionItemsToMonacoSuggestions,
  type LspCompletionPresentationOptions,
} from "./model/lspCompletionPresentation";
export {
  appendSqlCompletionSpace,
  sqlFunctionCompletionInsertion,
  sqlCompletionItemType,
  type SqlCompletionItemType,
} from "./model/sqlCompletionInsertion";
export {
  sqlForeignKeyJoinCompletions,
  sqlJoinConstraintsFromRelationshipIndex,
  type SqlForeignKeyJoinCompletion,
  type SqlForeignKeyJoinCompletionOptions,
} from "./model/sqlJoinCompletion";
export {
  recordSqlCompletionTelemetry,
  resetSqlCompletionTelemetryForTests,
  sqlCompletionTelemetrySnapshot,
  type SqlCompletionOutcome,
  type SqlCompletionTelemetryEvent,
  type SqlCompletionTelemetrySnapshot,
} from "./model/sqlCompletionTelemetry";
export {
  queryTransactionExecutionId,
  selectedOrFullEditorText,
  type QueryEditorTextModel,
} from "./model/executionTarget";
export {
  mongodbCommandRangeAtCursor,
  mongodbCommandRanges,
  type MongoDbCommandRange,
} from "./model/mongodbCommandRanges";
export {
  cachedCurrentStatementRangeAtOffset,
  currentStatementLineFrames,
  type CurrentStatementLineFrame,
  type CurrentStatementRange,
  type CurrentStatementRangeCache,
  type OffsetPositionModel,
} from "./model/currentStatementDecoration";
export { elasticsearchJsonStringCompletionRange } from "./model/elasticsearchCompletionRange";
export { parseElasticsearchConsoleServerVersion } from "./model/elasticsearchConsoleVersion";
export {
  quoteSqlIdentifierSelection,
  sqlInListFromClipboard,
  unquoteSqlIdentifierSelection,
} from "./model/sqlEditorIntentions";
export {
  useQueryTransactionController,
  type QueryTransactionMode,
  type QueryTransactionOperation,
  type QueryTransactionState,
} from "./hooks/useQueryTransactionController";
export {
  useQueryExecutionController,
  type ParameterExecutionRequest,
  type QueryExecutionEditor,
} from "./hooks/useQueryExecutionController";
export {
  useConsoleFileController,
  type ConsoleFileOperation,
} from "./hooks/useConsoleFileController";
export {
  useLspDocumentLifecycle,
  type LspDocumentLifecycleClient,
} from "./hooks/useLspDocumentLifecycle";
export {
  registerLspCoreProviders,
  useLspCoreProviderCoordinator,
  type LspCoreProviderCoordinatorOptions,
} from "./hooks/useLspCoreProviderCoordinator";
export {
  registerLspHoverProvider,
  useLspHoverProviderCoordinator,
  type LspHoverProviderCoordinatorOptions,
  type LspHoverProviderRuntime,
} from "./hooks/useLspHoverProviderCoordinator";
export {
  registerLspCompletionProvider,
  useLspCompletionProviderCoordinator,
  type LspCompletionProviderCoordinatorOptions,
  type MonacoCompletionProvider,
} from "./hooks/useLspCompletionProviderCoordinator";
export {
  boundedSqlCompletionTextBeforeCursor,
  cachedRelationCompletionSuggestions,
  createCachedSqlCompletionRequest,
  useCachedSqlCompletionSource,
  type CachedSqlCompletionRequest,
  type CachedSqlCompletionRequestOptions,
  type CachedSqlCompletionSourceOptions,
} from "./hooks/useCachedSqlCompletionSource";
export {
  attachMonacoEditorViewState,
  normalizedEditorViewSelection,
  useMonacoEditorViewState,
  type MonacoEditorViewStateOptions,
  type UseMonacoEditorViewStateOptions,
} from "./hooks/useMonacoEditorViewState";
export {
  attachCurrentStatementDecoration,
  useCurrentStatementDecoration,
  type CurrentStatementDecorationOptions,
  type UseCurrentStatementDecorationOptions,
} from "./hooks/useCurrentStatementDecoration";
export {
  attachConsoleAutoSuggest,
  useConsoleAutoSuggest,
  type ConsoleAutoSuggestOptions,
  type UseConsoleAutoSuggestOptions,
} from "./hooks/useConsoleAutoSuggest";
export {
  resolveQueryExecutionTarget,
  type QueryExecutionKind,
  type QueryExecutionMode,
  type QueryExecutionSnapshot,
  type QueryExecutionTarget,
} from "./model/queryExecutionTarget";
