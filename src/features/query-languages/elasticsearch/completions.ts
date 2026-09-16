import { elasticsearchConsoleCompletionContext } from "@/features/query-languages/elasticsearch/completionContext";
import { HTTP_METHODS } from "@/features/query-languages/elasticsearch/languagePolicy";
import { ENDPOINT_COMPLETIONS } from "@/features/query-languages/elasticsearch/operationCatalog";
import {
  globalOperationCompletions,
  indexOperationCompletions,
  operationCompletions,
  requestBodyCompletions,
  rootPathCompletions,
} from "@/features/query-languages/elasticsearch/operationCompletions";
import {
  AGGREGATION_NAME_COMPLETIONS,
  AGGREGATION_TYPE_COMPLETIONS,
  BOOL_CLAUSE_COMPLETIONS,
  QUERY_CLAUSE_COMPLETIONS,
  SEARCH_BODY_COMPLETIONS,
  SOURCE_VALUE_COMPLETIONS,
} from "@/features/query-languages/elasticsearch/queryCatalog";
import { elasticsearchRequestNearOffset } from "@/features/query-languages/elasticsearch/requests";
import {
  type ElasticsearchConsoleCompletion,
  type ElasticsearchConsoleCompletionContext,
  type ElasticsearchVersionInput,
} from "@/features/query-languages/elasticsearch/types";
import {
  filterVersionedQueryCompletions,
  filterVersionedSearchBodyCompletions,
} from "@/features/query-languages/elasticsearch/versionPolicy";

/**
 * Provides Kibana Console-style request and JSON-body completions alongside
 * schema-aware mapping-field suggestions supplied by the database LSP.
 */
export function elasticsearchConsoleCompletions(
  source: string,
  cursorOffset: number,
  version?: ElasticsearchVersionInput,
): ElasticsearchConsoleCompletion[] {
  const context = elasticsearchConsoleCompletionContext(source, cursorOffset);
  return indentElasticsearchJsonCompletionItems(
    elasticsearchConsoleCompletionsForContext(
      source,
      cursorOffset,
      context,
      version,
    ),
    source,
    cursorOffset,
    context,
  );
}

/**
 * Console snippets are authored relative to the JSON key being replaced.  A
 * provider must add the current line indentation to every later line; Monaco
 * only replaces the key range and otherwise has no knowledge of a snippet's
 * JSON nesting.  Keep request-line and fresh-body snippets untouched because
 * those start a document/request rather than continue an existing object.
 */
function indentElasticsearchJsonCompletionItems(
  items: readonly ElasticsearchConsoleCompletion[],
  source: string,
  cursorOffset: number,
  context: ElasticsearchConsoleCompletionContext,
): ElasticsearchConsoleCompletion[] {
  if (["method", "path", "operation", "body-start"].includes(context.area)) {
    return [...items];
  }
  const cursor = Math.max(0, Math.min(cursorOffset, source.length));
  const lineStart = source.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const baseIndent =
    source.slice(lineStart, cursor).match(/^[\t ]*/u)?.[0] ?? "";
  if (!baseIndent) return [...items];
  return items.map((item) =>
    item.insertText.includes("\n")
      ? {
          ...item,
          insertText: item.insertText.replace(/\n/g, `\n${baseIndent}`),
        }
      : item,
  );
}

export function elasticsearchConsoleCompletionsForContext(
  source: string,
  cursorOffset: number,
  context: ElasticsearchConsoleCompletionContext,
  version?: ElasticsearchVersionInput,
): ElasticsearchConsoleCompletion[] {
  if (context.area === "method") {
    return HTTP_METHODS.map((method) => ({
      label: method,
      insertText: `${method} `,
      detail: `Elasticsearch ${method} request`,
      kind: "keyword" as const,
    }));
  }

  if (context.area === "operation") {
    return context.index
      ? indexOperationCompletions(context.method, context.typed, version)
      : globalOperationCompletions(context.method, context.typed);
  }
  if (context.area === "path") {
    if (context.typed === "/" || context.typed === "") {
      return rootPathCompletions(context.method);
    }
    return operationCompletions(
      ENDPOINT_COMPLETIONS,
      context.method,
      context.typed,
    );
  }
  if (context.area === "body-start") {
    return filterVersionedSearchBodyCompletions(
      requestBodyCompletions(context.operation, context.method),
      version,
    );
  }
  if (context.area === "query-clause") {
    return withoutExistingElasticsearchKeyValue(
      filterVersionedQueryCompletions(QUERY_CLAUSE_COMPLETIONS, version),
      context,
    );
  }
  if (context.area === "bool-clause") {
    return withoutExistingElasticsearchKeyValue(
      BOOL_CLAUSE_COMPLETIONS,
      context,
    );
  }
  if (context.area === "aggregation-name") {
    return AGGREGATION_NAME_COMPLETIONS;
  }
  if (context.area === "aggregation-type") {
    return withoutExistingElasticsearchKeyValue(
      AGGREGATION_TYPE_COMPLETIONS,
      context,
    );
  }
  if (context.area === "top-level") {
    const request = elasticsearchRequestNearOffset(source, cursorOffset);
    const requestLine = request?.text.slice(
      0,
      request.text.indexOf("\n") === -1
        ? request.text.length
        : request.text.indexOf("\n"),
    );
    return /\/(?:_search|_count)(?:[/?]|$)/i.test(requestLine || "")
      ? withoutExistingElasticsearchKeyValue(
          filterVersionedSearchBodyCompletions(
            SEARCH_BODY_COMPLETIONS,
            version,
          ),
          context,
        )
      : [];
  }
  if (context.area === "value" && context.valueKey === "_source") {
    return SOURCE_VALUE_COMPLETIONS;
  }

  return [];
}

function withoutExistingElasticsearchKeyValue(
  completions: readonly ElasticsearchConsoleCompletion[],
  context: ElasticsearchConsoleCompletionContext,
) {
  if (!context.hasKeySeparator) return [...completions];
  return completions.map((completion) =>
    completion.kind === "property"
      ? { ...completion, insertText: JSON.stringify(completion.label) }
      : completion,
  );
}
