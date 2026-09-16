// Compatibility entry. Workers consume requests/validation without the editor adapter.
export { maskElasticsearchConsoleComments } from "@/features/query-languages/elasticsearch/comments";
export {
  elasticsearchCompletionExpectsMappingField,
  elasticsearchConsoleCompletionContext,
} from "@/features/query-languages/elasticsearch/completionContext";
export {
  shouldOfferElasticsearchCompletions,
  shouldTriggerElasticsearchCompletions,
} from "@/features/query-languages/elasticsearch/completionPolicy";
export { elasticsearchConsoleCompletions } from "@/features/query-languages/elasticsearch/completions";
export {
  compileElasticsearchConsoleExecution,
  elasticsearchConsoleVariableNames,
  prepareElasticsearchConsoleExecution,
  substituteElasticsearchConsoleVariables,
} from "@/features/query-languages/elasticsearch/execution";
export { formatElasticsearchConsole } from "@/features/query-languages/elasticsearch/formatting";
export { elasticsearchConsoleInlineSuggestion } from "@/features/query-languages/elasticsearch/inlineSuggestion";
export { registerElasticsearchConsoleLanguage } from "@/features/query-languages/elasticsearch/language";
export {
  ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS,
  ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
} from "@/features/query-languages/elasticsearch/languagePolicy";
export { elasticsearchJsonKeyReplacementRange } from "@/features/query-languages/elasticsearch/replacementRange";
export {
  elasticsearchConsoleRequestContext,
  elasticsearchRequestAtOffset,
  elasticsearchRequestNavigationOffset,
  elasticsearchRequestsForSelection,
  parseElasticsearchConsoleRequests,
} from "@/features/query-languages/elasticsearch/requests";
export {
  elasticsearchMappingFieldCompletions,
  elasticsearchSchemaCompletionsForContext,
} from "@/features/query-languages/elasticsearch/schemaCompletions";
export type {
  ElasticsearchCompletionReplacementRange,
  ElasticsearchConsoleCompletion,
  ElasticsearchConsoleCompletionArea,
  ElasticsearchConsoleCompletionContext,
  ElasticsearchConsoleDiagnostic,
  ElasticsearchConsoleRequest,
  ElasticsearchConsoleRequestContext,
  ElasticsearchMajorVersion,
  ElasticsearchMappingField,
  ElasticsearchSchemaCompletion,
  ElasticsearchServerVersion,
} from "@/features/query-languages/elasticsearch/types";
export { validateElasticsearchConsole } from "@/features/query-languages/elasticsearch/validation";
