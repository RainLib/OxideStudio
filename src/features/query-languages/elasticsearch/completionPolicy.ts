import {
  ELASTICSEARCH_MAPPING_FIELD_VALUE_KEYS,
  elasticsearchConsoleCompletionContext,
} from "@/features/query-languages/elasticsearch/completionContext";
import { ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS } from "@/features/query-languages/elasticsearch/languagePolicy";
import { type ElasticsearchConsoleCompletionArea } from "@/features/query-languages/elasticsearch/types";

const ELASTICSEARCH_COMPLETION_AREAS =
  new Set<ElasticsearchConsoleCompletionArea>([
    "method",
    "path",
    "operation",
    "body-start",
    "top-level",
    "query-clause",
    "bool-clause",
    "aggregation-name",
    "aggregation-type",
    "field-name",
    "value",
  ]);

export function shouldOfferElasticsearchCompletions(
  source: string,
  cursorOffset: number,
) {
  const context = elasticsearchConsoleCompletionContext(source, cursorOffset);
  return (
    ELASTICSEARCH_COMPLETION_AREAS.has(context.area) &&
    (context.area !== "value" ||
      ELASTICSEARCH_MAPPING_FIELD_VALUE_KEYS.has(context.valueKey || ""))
  );
}

export function shouldTriggerElasticsearchCompletions(
  source: string,
  cursorOffset: number,
  insertedText: string,
) {
  const lastCharacter = insertedText[insertedText.length - 1];
  return Boolean(
    lastCharacter &&
      ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS.includes(lastCharacter) &&
      shouldOfferElasticsearchCompletions(source, cursorOffset),
  );
}
