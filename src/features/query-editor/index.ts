export { useCachedSqlCompletionSource } from "./hooks/useCachedSqlCompletionSource";
export {
  attachConsoleAutoSuggest,
  useConsoleAutoSuggest,
  type ConsoleAutoSuggestOptions,
  type UseConsoleAutoSuggestOptions,
} from "./hooks/useConsoleAutoSuggest";
export {
  useConsoleFileController,
  type ConsoleFileOperation,
} from "./hooks/useConsoleFileController";
export {
  attachCurrentStatementDecoration,
  useCurrentStatementDecoration,
  type CurrentStatementDecorationOptions,
  type UseCurrentStatementDecorationOptions,
} from "./hooks/useCurrentStatementDecoration";
export {
  registerLspCompletionProvider,
  useLspCompletionProviderCoordinator,
  type LspCompletionProviderCoordinatorOptions,
  type MonacoCompletionProvider,
  type MonacoCompletionResolver,
} from "./hooks/useLspCompletionProviderCoordinator";
export {
  registerLspCoreProviders,
  useLspCoreProviderCoordinator,
  type LspCoreProviderCoordinatorOptions,
} from "./hooks/useLspCoreProviderCoordinator";
export {
  useLspDocumentLifecycle,
  type LspDocumentLifecycleClient,
} from "./hooks/useLspDocumentLifecycle";
export {
  registerLspHoverProvider,
  useLspHoverProviderCoordinator,
  type LspHoverProviderCoordinatorOptions,
  type LspHoverProviderRuntime,
} from "./hooks/useLspHoverProviderCoordinator";
export {
  attachMonacoEditorViewState,
  normalizedEditorViewSelection,
  useMonacoEditorViewState,
  type MonacoEditorViewStateOptions,
  type UseMonacoEditorViewStateOptions,
} from "./hooks/useMonacoEditorViewState";
export {
  captureQueryExecutionSnapshot,
  useQueryExecutionController,
  type ParameterExecutionRequest,
  type QueryExecutionEditor,
} from "./hooks/useQueryExecutionController";
export {
  useQueryTransactionController,
  type QueryTransactionMode,
  type QueryTransactionOperation,
  type QueryTransactionState,
} from "./hooks/useQueryTransactionController";
export {
  boundedSqlCompletionTextBeforeCursor,
  cachedRelationCompletionSuggestions,
  createCachedSqlCompletionRequest,
  type CachedSqlCompletionRequest,
  type CachedSqlCompletionRequestOptions,
  type CachedSqlCompletionSourceOptions,
} from "./model/cachedSqlCompletion";
export { mergeCatalogNames } from "./model/catalogSelection";
export {
  completionSuggestionsOrCached,
  limitCompletionSuggestions,
  mergeCompletionFallbackSuggestions,
} from "./model/completionFallback";
export {
  completionFilterTextForQuery,
  completionMatchScore,
  completionMatches,
  containsHan,
  ensurePinyinCompletionSupport,
  pinyinInitials,
} from "./model/completionMatch";
export {
  cachedCurrentStatementRangeAtOffset,
  currentStatementLineFrames,
  type CurrentStatementLineFrame,
  type CurrentStatementRange,
  type CurrentStatementRangeCache,
  type OffsetPositionModel,
} from "./model/currentStatementDecoration";
export { shouldRetriggerDocumentCompletion } from "./model/documentCompletionRefresh";
export {
  editorDocumentIdentity,
  type EditorDocumentIdentity,
  type EditorDocumentTab,
} from "./model/editorDocumentIdentity";
export {
  insertLineBelow,
  type EditorLineActionTarget,
} from "./model/editorLineActions";
export { buildQueryEditorOptions } from "./model/editorOptions";
export {
  elasticsearchJsonStringCompletionRange,
  elasticsearchPathCompletionRange,
} from "./model/elasticsearchCompletionRange";
export { parseElasticsearchConsoleServerVersion } from "./model/elasticsearchConsoleVersion";
export {
  queryTransactionExecutionId,
  selectedOrFullEditorText,
  type QueryEditorTextModel,
} from "./model/executionTarget";
export {
  applyResolvedLspCompletionItem,
  completionLabelForMonaco,
  completionResolveRequestContext,
  lspCompletionItemsToMonacoSuggestions,
  markResolvableLspCompletionItems,
  sourceLspCompletionItem,
  type LspCompletionPresentationOptions,
  type LspCompletionResolveContext,
} from "./model/lspCompletionPresentation";
export {
  enqueueLspDocumentSync,
  syncLspModelBeforeCompletion,
  type LspDocumentSyncChains,
  type LspDocumentSyncClient,
  type LspTextModel,
} from "./model/lspDocumentSync";
export {
  flattenLspSelectionRanges,
  isPublishDiagnosticsParams,
  lspDiagnosticToMonacoMarker,
  lspDocumentationForMonaco,
  shouldApplyLspDiagnostics,
  toMonacoCompletionRange,
  toMonacoRange,
  toMonacoWorkspaceEdit,
} from "./model/lspMonacoAdapter";
export {
  mongodbCommandRangeAtCursor,
  mongodbCommandRanges,
  type MongoDbCommandRange,
} from "./model/mongodbCommandRanges";
export {
  analyzeMysqlRoutineSyntax,
  isMysqlRoutineParserDiagnostic,
  supportsMysqlRoutineSyntaxDiagnostics,
  type MysqlRoutineSyntaxAnalysis,
  type MysqlRoutineSyntaxDiagnostic,
} from "./model/mysqlRoutineSyntaxDiagnostics";
export {
  buildOracleSyntaxDiagnostics,
  supportsOracleSyntaxDiagnostics,
  type OracleSyntaxDiagnostic,
} from "./model/oracleSyntaxDiagnostics";
export {
  resolveQueryExecutionTarget,
  type QueryExecutionKind,
  type QueryExecutionMode,
  type QueryExecutionSnapshot,
  type QueryExecutionTarget,
} from "./model/queryExecutionTarget";
export {
  DEFAULT_SQL_COMMAND_SNIPPETS,
  MANTICORE_SQL_COMMAND_SNIPPETS,
  sqlCommandSnippetCompletions,
  type SqlCommandSnippetOptions,
  type SqlSnippetSetting,
} from "./model/sqlCommandSnippets";
export {
  appendSqlCompletionSpace,
  shouldChainSqlCompletionAfterAccept,
  sqlCompletionItemType,
  sqlFunctionCompletionInsertion,
  type SqlCompletionItemType,
} from "./model/sqlCompletionInsertion";
export {
  recordSqlCompletionTelemetry,
  resetSqlCompletionTelemetryForTests,
  sqlCompletionTelemetrySnapshot,
  type SqlCompletionOutcome,
  type SqlCompletionTelemetryEvent,
  type SqlCompletionTelemetrySnapshot,
} from "./model/sqlCompletionTelemetry";
export {
  sqlCompletionIdentifierPrefix,
  sqlCompletionTriggerDecision,
  type SqlCompletionTriggerDecision,
  type SqlCompletionTriggerMode,
} from "./model/sqlCompletionTriggerPolicy";
export {
  quoteSqlIdentifierSelection,
  sqlInListFromClipboard,
  unquoteSqlIdentifierSelection,
} from "./model/sqlEditorIntentions";
export {
  sqlForeignKeyJoinCompletions,
  sqlJoinConstraintsFromRelationshipIndex,
  type SqlForeignKeyJoinCompletion,
  type SqlForeignKeyJoinCompletionOptions,
} from "./model/sqlJoinCompletion";
export { sqlSyntaxFallbackCompletions } from "./model/sqlSyntaxFallback";
