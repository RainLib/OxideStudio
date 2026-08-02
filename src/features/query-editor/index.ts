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
  sqlCommandSnippetCompletions,
  type SqlCommandSnippetOptions,
} from "./model/sqlCommandSnippets";
export {
  editorDocumentIdentity,
  type EditorDocumentIdentity,
  type EditorDocumentTab,
} from "./model/editorDocumentIdentity";
export { buildQueryEditorOptions } from "./model/editorOptions";
export {
  flattenLspSelectionRanges,
  isPublishDiagnosticsParams,
  lspDiagnosticToMonacoMarker,
  lspDocumentationForMonaco,
  toMonacoRange,
  toMonacoWorkspaceEdit,
} from "./model/lspMonacoAdapter";
export {
  lspCompletionItemsToMonacoSuggestions,
  type LspCompletionPresentationOptions,
} from "./model/lspCompletionPresentation";
export {
  appendSqlCompletionSpace,
  sqlCompletionItemType,
  type SqlCompletionItemType,
} from "./model/sqlCompletionInsertion";
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
  currentStatementLineFrames,
  type CurrentStatementLineFrame,
  type OffsetPositionModel,
} from "./model/currentStatementDecoration";
export { elasticsearchJsonStringCompletionRange } from "./model/elasticsearchCompletionRange";
export { parseElasticsearchConsoleServerVersion } from "./model/elasticsearchConsoleVersion";
export {
  quoteSqlIdentifierSelection,
  sqlInListFromClipboard,
  unquoteSqlIdentifierSelection,
} from "./model/sqlEditorIntentions";
