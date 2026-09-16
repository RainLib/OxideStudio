import {
  ENDPOINT_COMPLETIONS,
  GLOBAL_OPERATION_COMPLETIONS,
  INDEX_OPERATION_COMPLETIONS,
  SEARCH_REQUEST_BODY,
} from "@/features/query-languages/elasticsearch/operationCatalog";
import {
  type ElasticsearchConsoleCompletion,
  type ElasticsearchHttpMethod,
  type ElasticsearchOperationCompletion,
  type ElasticsearchVersionInput,
} from "@/features/query-languages/elasticsearch/types";
import { normalizeElasticsearchVersion } from "@/features/query-languages/elasticsearch/versionPolicy";

export function rootPathCompletions(method: string | undefined) {
  const globalOperations = globalOperationCompletions(method, "").map(
    (completion) => ({
      ...completion,
      label: `/${completion.label}`,
      insertText: `/${completion.insertText}`,
    }),
  );
  const endpointTemplates = operationCompletions(
    ENDPOINT_COMPLETIONS,
    method,
    "",
  );
  const suggestions = [...globalOperations, ...endpointTemplates];
  return suggestions.filter(
    (completion, index) =>
      suggestions.findIndex(
        (candidate) => candidate.label === completion.label,
      ) === index,
  );
}

export function operationCompletions(
  completions: readonly ElasticsearchOperationCompletion[],
  method: string | undefined,
  typedOperation: string,
) {
  const normalizedMethod = method?.toUpperCase() as
    | ElasticsearchHttpMethod
    | undefined;
  return completions
    .filter(
      (completion) =>
        (!normalizedMethod || completion.methods.includes(normalizedMethod)) &&
        completion.label.toLowerCase().startsWith(typedOperation.toLowerCase()),
    )
    .map(({ methods: _methods, ...completion }) => completion);
}

export function indexOperationCompletions(
  method: string | undefined,
  typedOperation: string,
  version?: ElasticsearchVersionInput,
) {
  return operationCompletions(
    elasticsearchIndexOperationsForVersion(version),
    method,
    typedOperation,
  );
}

function elasticsearchIndexOperationsForVersion(
  version?: ElasticsearchVersionInput,
) {
  const majorVersion = normalizeElasticsearchVersion(version)?.major;
  if (majorVersion !== 6) return INDEX_OPERATION_COMPLETIONS;
  return INDEX_OPERATION_COMPLETIONS.map((completion) => {
    if (completion.label === "_doc/{id}") {
      return {
        ...completion,
        label: "{type}/{id}",
        insertText: "${1:type}/${2:id}",
        detail: "Read, index, or delete an Elasticsearch 6 typed document",
      };
    }
    if (completion.label === "_update/{id}") {
      return {
        ...completion,
        label: "{type}/{id}/_update",
        insertText:
          '${1:type}/${2:id}/_update\n{\n  "doc": {\n    "${3:field}": "${4:value}"\n  }\n}',
        detail: "Update one Elasticsearch 6 typed document",
      };
    }
    if (completion.label === "_explain/{id}") {
      return {
        ...completion,
        label: "{type}/{id}/_explain",
        insertText: `\${1:type}/\${2:id}/_explain\n${SEARCH_REQUEST_BODY}`,
        detail: "Explain an Elasticsearch 6 typed document match",
      };
    }
    return completion;
  });
}

export function globalOperationCompletions(
  method: string | undefined,
  typedOperation: string,
) {
  return operationCompletions(
    GLOBAL_OPERATION_COMPLETIONS,
    method,
    typedOperation,
  );
}

export function requestBodyCompletions(
  operation: string | undefined,
  method: string | undefined,
): ElasticsearchConsoleCompletion[] {
  const normalizedOperation = (operation || "").split(/[?#]/, 1)[0] ?? "";
  const normalizedMethod = method?.toUpperCase();
  if (
    [
      "_search",
      "_count",
      "_update_by_query",
      "_delete_by_query",
      "_validate/query",
    ].includes(normalizedOperation)
  ) {
    return [
      {
        label: "search body",
        insertText: SEARCH_REQUEST_BODY,
        detail: `Query DSL body for ${normalizedOperation}`,
        kind: "snippet",
      },
    ];
  }
  if (normalizedOperation === "_mapping" && normalizedMethod === "PUT") {
    return [
      {
        label: "mapping body",
        insertText:
          '{\n  "properties": {\n    "${1:field}": { "type": "${2:keyword}" }\n  }\n}',
        detail: "Add or update mapping fields",
        kind: "snippet",
      },
    ];
  }
  if (normalizedOperation === "_settings" && normalizedMethod === "PUT") {
    return [
      {
        label: "settings body",
        insertText: '{\n  "index": {\n    "number_of_replicas": ${1:1}\n  }\n}',
        detail: "Update dynamic index settings",
        kind: "snippet",
      },
    ];
  }
  if (normalizedOperation === "_msearch") {
    return [
      {
        label: "multi-search NDJSON",
        insertText: '{"index":"${1:index}"}\n{"query":{"match_all":{}}}\n',
        detail: "Header and body pair; the final newline is required",
        kind: "snippet",
      },
    ];
  }
  if (normalizedOperation === "_bulk") {
    return [
      {
        label: "bulk NDJSON",
        insertText:
          '{"index":{"_id":"${1:id}"}}\n{"${2:field}":"${3:value}"}\n',
        detail: "Bulk action and source pair; the final newline is required",
        kind: "snippet",
      },
    ];
  }
  if (normalizedOperation === "_reindex") {
    return [
      {
        label: "reindex body",
        insertText:
          '{\n  "source": { "index": "${1:source}" },\n  "dest": { "index": "${2:destination}" }\n}',
        detail: "Select source and destination indices",
        kind: "snippet",
      },
    ];
  }
  return [];
}
