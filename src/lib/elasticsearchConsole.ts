export interface ElasticsearchConsoleRequest {
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface ElasticsearchConsoleCompletion {
  label: string;
  insertText: string;
  detail: string;
  kind: "keyword" | "property" | "snippet";
}

export interface ElasticsearchConsoleDiagnostic {
  message: string;
  startOffset: number;
  endOffset: number;
  severity: "error" | "warning";
}

export type ElasticsearchConsoleCompletionArea =
  | "method"
  | "path"
  | "operation"
  | "body-start"
  | "top-level"
  | "query-clause"
  | "bool-clause"
  | "aggregation-name"
  | "aggregation-type"
  | "field-name"
  | "value"
  | "unknown";

export interface ElasticsearchConsoleCompletionContext {
  area: ElasticsearchConsoleCompletionArea;
  typed: string;
  method?: string;
  index?: string;
  operation?: string;
  ownerKey?: string;
  valueKey?: string;
}

export interface ElasticsearchConsoleRequestContext {
  request: string;
  startOffset?: number;
  endOffset?: number;
  method?: string;
  path?: string;
  index?: string;
}

export interface ElasticsearchSchemaCompletion {
  label: string;
  detail?: string;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
}

export const ELASTICSEARCH_CONSOLE_LANGUAGE_ID = "elasticsearch-console";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
type ElasticsearchHttpMethod = (typeof HTTP_METHODS)[number];
type ElasticsearchOperationCompletion = ElasticsearchConsoleCompletion & {
  methods: readonly ElasticsearchHttpMethod[];
};

const SEARCH_REQUEST_BODY = `{
  "query": {
    "match_all": {}
  }
}`;
const ENDPOINT_COMPLETIONS: ElasticsearchOperationCompletion[] = [
  {
    label: "/{index}/_search",
    insertText:
      "/${1:index}/_search\n{\n  \"query\": {\n    \"match_all\": {}\n  }\n}",
    detail: "Search an index",
    kind: "snippet",
    methods: ["GET", "POST"],
  },
  {
    label: "/{index}/_mapping",
    insertText: "/${1:index}/_mapping",
    detail: "Read index mapping",
    kind: "snippet",
    methods: ["GET", "PUT"],
  },
  {
    label: "/_cat/indices",
    insertText: "/_cat/indices?v=true",
    detail: "List indices",
    kind: "snippet",
    methods: ["GET"],
  },
  {
    label: "/_cluster/health",
    insertText: "/_cluster/health",
    detail: "Read cluster health",
    kind: "snippet",
    methods: ["GET"],
  },
  {
    label: "/_search",
    insertText:
      "/_search\n{\n  \"query\": {\n    \"match_all\": {}\n  }\n}",
    detail: "Search all available indices",
    kind: "snippet",
    methods: ["GET", "POST"],
  },
];

const INDEX_OPERATION_COMPLETIONS: ElasticsearchOperationCompletion[] = [
    {
      label: "_search",
      insertText: `_search\n${SEARCH_REQUEST_BODY}`,
      detail: "Search this index",
      kind: "snippet" as const,
      methods: ["GET", "POST"],
    },
    {
      label: "_count",
      insertText: `_count\n${SEARCH_REQUEST_BODY}`,
      detail: "Count matching documents",
      kind: "snippet" as const,
      methods: ["GET", "POST"],
    },
    {
      label: "_msearch",
      insertText:
        '_msearch\n{"index":"${1:index}"}\n{"query":{"match_all":{}}}\n',
      detail: "Run multiple searches with NDJSON",
      kind: "snippet" as const,
      methods: ["GET", "POST"],
    },
    {
      label: "_search/template",
      insertText:
        '_search/template\n{\n  "id": "${1:template-id}",\n  "params": {}\n}',
      detail: "Run a search template",
      kind: "snippet" as const,
      methods: ["GET", "POST"],
    },
    {
      label: "_mapping",
      insertText: "_mapping",
      detail: "Read or update this index mapping",
      kind: "property" as const,
      methods: ["GET", "PUT"],
    },
    {
      label: "_settings",
      insertText: "_settings",
      detail: "Read or update this index settings",
      kind: "property" as const,
      methods: ["GET", "PUT"],
    },
    {
      label: "_stats",
      insertText: "_stats",
      detail: "Read index statistics",
      kind: "property" as const,
      methods: ["GET"],
    },
    {
      label: "_field_caps",
      insertText: '_field_caps?fields=${1:*}',
      detail: "Read field capabilities",
      kind: "snippet" as const,
      methods: ["GET", "POST"],
    },
    {
      label: "_validate/query",
      insertText: `_validate/query?explain=true\n${SEARCH_REQUEST_BODY}`,
      detail: "Validate Query DSL without running it",
      kind: "snippet" as const,
      methods: ["GET", "POST"],
    },
    {
      label: "_bulk",
      insertText:
        '_bulk\n{"index":{"_id":"${1:id}"}}\n{"${2:field}":"${3:value}"}\n',
      detail: "Run bulk operations with NDJSON",
      kind: "snippet" as const,
      methods: ["POST", "PUT"],
    },
    {
      label: "_update_by_query",
      insertText: `_update_by_query\n${SEARCH_REQUEST_BODY}`,
      detail: "Update documents matching a query",
      kind: "snippet" as const,
      methods: ["POST"],
    },
    {
      label: "_delete_by_query",
      insertText: `_delete_by_query\n${SEARCH_REQUEST_BODY}`,
      detail: "Delete documents matching a query",
      kind: "snippet" as const,
      methods: ["POST"],
    },
    {
      label: "_analyze",
      insertText:
        '_analyze\n{\n  "analyzer": "${1:standard}",\n  "text": "${2:text}"\n}',
      detail: "Analyze text with this index",
      kind: "snippet" as const,
      methods: ["POST"],
    },
    {
      label: "_refresh",
      insertText: "_refresh",
      detail: "Refresh this index",
      kind: "property" as const,
      methods: ["GET", "POST"],
    },
    {
      label: "_forcemerge",
      insertText: "_forcemerge?max_num_segments=${1:1}",
      detail: "Force merge this index",
      kind: "snippet" as const,
      methods: ["POST"],
    },
    {
      label: "_cache/clear",
      insertText: "_cache/clear",
      detail: "Clear this index cache",
      kind: "property" as const,
      methods: ["POST"],
    },
    {
      label: "_doc/{id}",
      insertText: '_doc/${1:id}',
      detail: "Read, index, or delete a document",
      kind: "snippet" as const,
      methods: ["GET", "POST", "PUT", "DELETE", "HEAD"],
    },
    {
      label: "_update/{id}",
      insertText:
        '_update/${1:id}\n{\n  "doc": {\n    "${2:field}": "${3:value}"\n  }\n}',
      detail: "Update one document",
      kind: "snippet" as const,
      methods: ["POST"],
    },
    {
      label: "_explain/{id}",
      insertText: `_explain/\${1:id}\n${SEARCH_REQUEST_BODY}`,
      detail: "Explain why a document matches a query",
      kind: "snippet" as const,
      methods: ["GET", "POST"],
    },
];

const GLOBAL_OPERATION_COMPLETIONS: ElasticsearchOperationCompletion[] = [
  {
    label: "_search",
    insertText: `_search\n${SEARCH_REQUEST_BODY}`,
    detail: "Search all accessible indices",
    kind: "snippet",
    methods: ["GET", "POST"],
  },
  {
    label: "_count",
    insertText: `_count\n${SEARCH_REQUEST_BODY}`,
    detail: "Count documents across accessible indices",
    kind: "snippet",
    methods: ["GET", "POST"],
  },
  {
    label: "_msearch",
    insertText:
      '_msearch\n{"index":"${1:index}"}\n{"query":{"match_all":{}}}\n',
    detail: "Run multiple searches with NDJSON",
    kind: "snippet",
    methods: ["GET", "POST"],
  },
  {
    label: "_bulk",
    insertText:
      '_bulk\n{"index":{"_index":"${1:index}","_id":"${2:id}"}}\n{"${3:field}":"${4:value}"}\n',
    detail: "Run bulk operations with NDJSON",
    kind: "snippet",
    methods: ["POST", "PUT"],
  },
  {
    label: "_reindex",
    insertText:
      '_reindex\n{\n  "source": { "index": "${1:source}" },\n  "dest": { "index": "${2:destination}" }\n}',
    detail: "Copy documents into another index",
    kind: "snippet",
    methods: ["POST"],
  },
  {
    label: "_cluster/health",
    insertText: "_cluster/health",
    detail: "Read cluster health",
    kind: "property",
    methods: ["GET"],
  },
  {
    label: "_cluster/state",
    insertText: "_cluster/state",
    detail: "Read cluster state",
    kind: "property",
    methods: ["GET"],
  },
  {
    label: "_cat/indices",
    insertText: "_cat/indices?v=true",
    detail: "List indices",
    kind: "property",
    methods: ["GET"],
  },
  {
    label: "_cat/nodes",
    insertText: "_cat/nodes?v=true",
    detail: "List cluster nodes",
    kind: "property",
    methods: ["GET"],
  },
  {
    label: "_aliases",
    insertText: "_aliases",
    detail: "Read or update aliases",
    kind: "property",
    methods: ["GET", "POST"],
  },
  {
    label: "_tasks",
    insertText: "_tasks?detailed=true",
    detail: "List running tasks",
    kind: "property",
    methods: ["GET"],
  },
  {
    label: "_nodes/stats",
    insertText: "_nodes/stats",
    detail: "Read node statistics",
    kind: "property",
    methods: ["GET"],
  },
];

function rootPathCompletions(method: string | undefined) {
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
      suggestions.findIndex((candidate) => candidate.label === completion.label) ===
      index,
  );
}

function operationCompletions(
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
        completion.label
          .toLowerCase()
          .startsWith(typedOperation.toLowerCase()),
    )
    .map(({ methods: _methods, ...completion }) => completion);
}

function indexOperationCompletions(
  method: string | undefined,
  typedOperation: string,
) {
  return operationCompletions(
    INDEX_OPERATION_COMPLETIONS,
    method,
    typedOperation,
  );
}

function globalOperationCompletions(
  method: string | undefined,
  typedOperation: string,
) {
  return operationCompletions(
    GLOBAL_OPERATION_COMPLETIONS,
    method,
    typedOperation,
  );
}

function requestBodyCompletions(
  operation: string | undefined,
  method: string | undefined,
): ElasticsearchConsoleCompletion[] {
  const normalizedOperation =
    (operation || "").split(/[?#]/, 1)[0] ?? "";
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
        insertText:
          '{\n  "index": {\n    "number_of_replicas": ${1:1}\n  }\n}',
        detail: "Update dynamic index settings",
        kind: "snippet",
      },
    ];
  }
  if (normalizedOperation === "_msearch") {
    return [
      {
        label: "multi-search NDJSON",
        insertText:
          '{"index":"${1:index}"}\n{"query":{"match_all":{}}}\n',
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
const SEARCH_BODY_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
  {
    label: "query",
    insertText: "\"query\": {\n  ${1:\"match_all\": {}}\n}",
    detail: "Query DSL clause",
    kind: "property",
  },
  {
    label: "aggs",
    insertText:
      "\"aggs\": {\n  \"${1:name}\": {\n    \"${2:terms}\": {\n      \"field\": \"${3:field}\"\n    }\n  }\n}",
    detail: "Aggregation definition",
    kind: "property",
  },
  {
    label: "_source",
    insertText: "\"_source\": ${1:true}",
    detail: "Return _source or replace true with a field array",
    kind: "property",
  },
  {
    label: "sort",
    insertText: "\"sort\": [\n  { \"${1:field}\": \"${2:desc}\" }\n]",
    detail: "Sort search hits",
    kind: "property",
  },
  {
    label: "size",
    insertText: "\"size\": ${1:100}",
    detail: "Maximum number of hits",
    kind: "property",
  },
  {
    label: "from",
    insertText: "\"from\": ${1:0}",
    detail: "Search result offset",
    kind: "property",
  },
  {
    label: "track_total_hits",
    insertText: '"track_total_hits": ${1:true}',
    detail: "Track an accurate total hit count",
    kind: "property",
  },
  {
    label: "search_after",
    insertText: '"search_after": [${1:sort_value}]',
    detail: "Continue deep pagination after sort values",
    kind: "property",
  },
  {
    label: "post_filter",
    insertText: '"post_filter": {\n  ${1:"term": {}}\n}',
    detail: "Filter hits after aggregations are calculated",
    kind: "property",
  },
  {
    label: "highlight",
    insertText:
      '"highlight": {\n  "fields": {\n    "${1:field}": {}\n  }\n}',
    detail: "Highlight matching text",
    kind: "property",
  },
  {
    label: "fields",
    insertText: '"fields": ["${1:field}"]',
    detail: "Return selected mapped fields",
    kind: "property",
  },
  {
    label: "timeout",
    insertText: '"timeout": "${1:5s}"',
    detail: "Set a search timeout",
    kind: "property",
  },
];
const BOOL_CLAUSE_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
  {
    label: "filter",
    insertText: '"filter": [\n  { ${1:"term": {}} }\n]',
    detail: "Required filter clauses without score contribution",
    kind: "property",
  },
  {
    label: "must",
    insertText: '"must": [\n  { ${1:"match": {}} }\n]',
    detail: "Required scoring query clauses",
    kind: "property",
  },
  {
    label: "should",
    insertText: '"should": [\n  { ${1:"match": {}} }\n]',
    detail: "Optional scoring query clauses",
    kind: "property",
  },
  {
    label: "must_not",
    insertText: '"must_not": [\n  { ${1:"term": {}} }\n]',
    detail: "Excluded query clauses",
    kind: "property",
  },
  {
    label: "minimum_should_match",
    insertText: '"minimum_should_match": ${1:1}',
    detail: "Minimum number of should clauses to match",
    kind: "property",
  },
];

const SOURCE_VALUE_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
  {
    label: "true",
    insertText: "true",
    detail: "Return the full _source document",
    kind: "keyword",
  },
  {
    label: "false",
    insertText: "false",
    detail: "Do not return _source",
    kind: "keyword",
  },
  {
    label: "field list",
    insertText: '[\n  "${1:field}"\n]',
    detail: "Return selected _source fields",
    kind: "snippet",
  },
  {
    label: "includes / excludes",
    insertText:
      '{\n  "includes": ["${1:field.*}"],\n  "excludes": ["${2:field.secret}"]\n}',
    detail: "Filter _source with include and exclude patterns",
    kind: "snippet",
  },
];
const QUERY_CLAUSE_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
  {
    label: "match_all",
    insertText: "\"match_all\": {}",
    detail: "Match all documents",
    kind: "property",
  },
  {
    label: "match_none",
    insertText: '"match_none": {}',
    detail: "Match no documents",
    kind: "property",
  },
  {
    label: "match",
    insertText: "\"match\": {\n  \"${1:field}\": \"${2:value}\"\n}",
    detail: "Full-text match",
    kind: "property",
  },
  {
    label: "term",
    insertText: "\"term\": {\n  \"${1:field}\": ${2:\"value\"}\n}",
    detail: "Exact term match",
    kind: "property",
  },
  {
    label: "range",
    insertText:
      "\"range\": {\n  \"${1:field}\": {\n    \"gte\": ${2:value},\n    \"lte\": ${3:value}\n  }\n}",
    detail: "Range query",
    kind: "property",
  },
  {
    label: "bool",
    insertText:
      "\"bool\": {\n  \"filter\": [\n    { ${1:\"term\": {}} }\n  ]\n}",
    detail: "Boolean query",
    kind: "property",
  },
  {
    label: "terms",
    insertText: '"terms": {\n  "${1:field}": [${2:"value"}]\n}',
    detail: "Match one of several exact terms",
    kind: "property",
  },
  {
    label: "exists",
    insertText: '"exists": {\n  "field": "${1:field}"\n}',
    detail: "Match documents containing a field",
    kind: "property",
  },
  {
    label: "match_phrase",
    insertText: '"match_phrase": {\n  "${1:field}": "${2:value}"\n}',
    detail: "Match an analyzed phrase",
    kind: "property",
  },
  {
    label: "multi_match",
    insertText:
      '"multi_match": {\n  "query": "${1:value}",\n  "fields": ["${2:field}"]\n}',
    detail: "Full-text match across several fields",
    kind: "property",
  },
  {
    label: "query_string",
    insertText:
      '"query_string": {\n  "query": "${1:query}",\n  "fields": ["${2:field}"]\n}',
    detail: "Run a Lucene query string",
    kind: "property",
  },
  {
    label: "prefix",
    insertText: '"prefix": {\n  "${1:field}": "${2:prefix}"\n}',
    detail: "Match terms by prefix",
    kind: "property",
  },
  {
    label: "wildcard",
    insertText: '"wildcard": {\n  "${1:field}": "${2:value*}"\n}',
    detail: "Match terms using wildcard syntax",
    kind: "property",
  },
  {
    label: "nested",
    insertText:
      '"nested": {\n  "path": "${1:path}",\n  "query": {\n    ${2:"match_all": {}}\n  }\n}',
    detail: "Query nested objects",
    kind: "property",
  },
  {
    label: "ids",
    insertText: '"ids": {\n  "values": ["${1:id}"]\n}',
    detail: "Match documents by _id",
    kind: "property",
  },
  {
    label: "constant_score",
    insertText:
      '"constant_score": {\n  "filter": {\n    ${1:"term": {}}\n  }\n}',
    detail: "Wrap a filter with a constant score",
    kind: "property",
  },
  {
    label: "function_score",
    insertText:
      '"function_score": {\n  "query": { ${1:"match_all": {}} },\n  "boost_mode": "${2:multiply}"\n}',
    detail: "Modify relevance scores with functions",
    kind: "property",
  },
  {
    label: "geo_distance",
    insertText:
      '"geo_distance": {\n  "distance": "${1:10km}",\n  "${2:location}": { "lat": ${3:0}, "lon": ${4:0} }\n}',
    detail: "Match geo points within a distance",
    kind: "property",
  },
];

const AGGREGATION_TYPE_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
  {
    label: "terms",
    insertText: '"terms": {\n  "field": "${1:field}"\n}',
    detail: "Bucket by unique field values",
    kind: "property",
  },
  {
    label: "date_histogram",
    insertText:
      '"date_histogram": {\n  "field": "${1:date_field}",\n  "calendar_interval": "${2:day}"\n}',
    detail: "Bucket dates by calendar interval",
    kind: "property",
  },
  {
    label: "avg",
    insertText: '"avg": {\n  "field": "${1:field}"\n}',
    detail: "Average a numeric field",
    kind: "property",
  },
  {
    label: "sum",
    insertText: '"sum": {\n  "field": "${1:field}"\n}',
    detail: "Sum a numeric field",
    kind: "property",
  },
  {
    label: "cardinality",
    insertText: '"cardinality": {\n  "field": "${1:field}"\n}',
    detail: "Estimate unique value count",
    kind: "property",
  },
  {
    label: "filter",
    insertText: '"filter": {\n  ${1:"term": {}}\n}',
    detail: "Create a single filtered bucket",
    kind: "property",
  },
];

const AGGREGATION_NAME_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
  {
    label: "terms aggregation",
    insertText:
      '"${1:by_field}": {\n  "terms": {\n    "field": "${2:field}"\n  }\n}',
    detail: "Create a named terms aggregation",
    kind: "snippet",
  },
  {
    label: "date histogram aggregation",
    insertText:
      '"${1:over_time}": {\n  "date_histogram": {\n    "field": "${2:date_field}",\n    "calendar_interval": "${3:day}"\n  }\n}',
    detail: "Create a named date histogram aggregation",
    kind: "snippet",
  },
];

export function registerElasticsearchConsoleLanguage(monaco: any) {
  const registrationKey = "__oxideElasticsearchConsoleRegistration";
  const previousRegistration = monaco[registrationKey] as
    | { version: number; disposables: Array<{ dispose: () => void }> }
    | Array<{ dispose: () => void }>
    | undefined;
  const registrationVersion = 2;
  if (
    !Array.isArray(previousRegistration) &&
    previousRegistration?.version === registrationVersion
  ) {
    return;
  }
  const previousDisposables = Array.isArray(previousRegistration)
    ? previousRegistration
    : previousRegistration?.disposables;
  previousDisposables?.forEach((disposable) => disposable.dispose());

  const isLanguageRegistered = monaco.languages
    .getLanguages()
    .some(
      (language: { id: string }) =>
        language.id === ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    );
  if (!isLanguageRegistered) {
    monaco.languages.register({
      id: ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      extensions: [".es", ".esdsl"],
      aliases: ["Elasticsearch Console", "Elasticsearch Query DSL"],
    });
  }

  const disposables: Array<{ dispose: () => void }> = [];
  disposables.push(monaco.languages.setMonarchTokensProvider(
    ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    {
      tokenizer: {
        root: [
          [
            /^(\s*)(GET|POST|PUT|PATCH|DELETE|HEAD)(\s+)(\/?\S+)/,
            ["white", "keyword", "white", "string"],
          ],
          [/^\s*#.*$/, "comment"],
          [/\/\/.*$/, "comment"],
          [/[{}[\]]/, "@brackets"],
          [/[,:]/, "delimiter"],
          [/"([^"\\]|\\.)*"(?=\s*:)/, "key"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
          [/\b(?:true|false|null)\b/, "keyword"],
        ],
      },
    },
  ));
  disposables.push(monaco.languages.setLanguageConfiguration(
    ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    {
      comments: {
        lineComment: "//",
      },
      brackets: [
        ["{", "}"],
        ["[", "]"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
      ],
    },
  ));
  disposables.push(monaco.languages.registerCompletionItemProvider(
    ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    {
      triggerCharacters: [" ", "/", "{", ",", '"', ":"],
      provideCompletionItems(model: any, position: any) {
        const offset = model.getOffsetAt(position);
        const word = model.getWordUntilPosition(position);
        const defaultRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const kindMap = {
          keyword: monaco.languages.CompletionItemKind.Keyword,
          property: monaco.languages.CompletionItemKind.Property,
          snippet: monaco.languages.CompletionItemKind.Snippet,
        };

        const lineBeforeCursor = model
          .getLineContent(position.lineNumber)
          .slice(0, position.column - 1);
        const pathMatch = lineBeforeCursor.match(
          /^(\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+)(.*)$/i,
        );
        const lineAfterCursor = model
          .getLineContent(position.lineNumber)
          .slice(position.column - 1);
        const keyFragment = lineBeforeCursor.match(/"[\w.@*-]*"?$/u)?.[0];
        const completionContext = elasticsearchConsoleCompletionContext(
          model.getValue(),
          offset,
        );
        const pathText = pathMatch?.[2] || "";
        const normalizedPath = pathText.replace(/^\/+/, "");
        const firstSlash = normalizedPath.indexOf("/");
        const operationStartInPath = normalizedPath.startsWith("_")
          ? pathText.length - normalizedPath.length
          : firstSlash >= 0
            ? pathText.length - normalizedPath.length + firstSlash + 1
            : pathText.length;
        const operationRange = pathMatch
          ? {
              ...defaultRange,
              startColumn:
                pathMatch[1]!.length + operationStartInPath + 1,
              endColumn: position.column,
            }
          : defaultRange;
        const completions = elasticsearchConsoleCompletions(
          model.getValue(),
          offset,
        );

        return {
          suggestions: completions.map((completion, index) => ({
            ...completion,
            kind: kindMap[completion.kind],
            range:
              completionContext.area === "operation"
                ? operationRange
                : pathMatch
              ? {
                  ...defaultRange,
                  startColumn: pathMatch[1]!.length + 1,
                  endColumn: position.column,
                }
              : completion.kind === "property" && keyFragment
                ? {
                    ...defaultRange,
                    startColumn:
                      lineBeforeCursor.length - keyFragment.length + 1,
                    endColumn:
                      !keyFragment.endsWith('"') &&
                      lineAfterCursor.startsWith('"')
                        ? position.column + 1
                        : position.column,
                  }
                : defaultRange,
            sortText: String(index).padStart(3, "0"),
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          })),
        };
      },
    },
  ));
  disposables.push(monaco.languages.registerDocumentFormattingEditProvider(
    ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    {
      provideDocumentFormattingEdits(model: any) {
        const formatted = formatElasticsearchConsole(model.getValue());
        if (!formatted || formatted === model.getValue()) return [];
        return [
          {
            range: model.getFullModelRange(),
            text: formatted,
          },
        ];
      },
    },
  ));
  disposables.push(monaco.languages.registerCodeActionProvider(
    ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    {
      provideCodeActions(model: any, range: any, context: any) {
        const line = model.getLineContent(range.startLineNumber);
        const match = line.match(
          /^(\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+)(\S+)/i,
        );
        if (!match) return { actions: [], dispose: () => undefined };
        const originalPath = match[2]!;
        let canonicalPath = originalPath.replace(/["']/g, "");
        if (!canonicalPath.startsWith("/")) canonicalPath = `/${canonicalPath}`;
        if (canonicalPath === originalPath) {
          return { actions: [], dispose: () => undefined };
        }
        const pathStartColumn = match[1]!.length + 1;
        return {
          actions: [
            {
              title: `Use Console path ${canonicalPath}`,
              kind: "quickfix",
              diagnostics: context.markers,
              isPreferred: true,
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: {
                        startLineNumber: range.startLineNumber,
                        startColumn: pathStartColumn,
                        endLineNumber: range.startLineNumber,
                        endColumn: pathStartColumn + originalPath.length,
                      },
                      text: canonicalPath,
                    },
                  },
                ],
              },
            },
          ],
          dispose: () => undefined,
        };
      },
    },
  ));
  monaco[registrationKey] = {
    version: registrationVersion,
    disposables,
  };
}

const REQUEST_LINE =
  /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+(?:\s+.*)?$/i;

interface LineSpan {
  startOffset: number;
  text: string;
}

function lineSpans(value: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let startOffset = 0;

  for (const line of value.split("\n")) {
    lines.push({ startOffset, text: line });
    startOffset += line.length + 1;
  }

  return lines;
}

/**
 * Replaces Console comments with spaces while preserving offsets and strings.
 * Elasticsearch receives JSON rather than JSONC, so the same representation
 * can be used for local validation and transport preparation.
 */
export function maskElasticsearchConsoleComments(source: string) {
  const output = source.split("");
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let lineHasOnlyWhitespace = true;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];

    if (character === "\n") {
      inLineComment = false;
      lineHasOnlyWhitespace = true;
      continue;
    }

    if (inLineComment) {
      output[index] = " ";
      continue;
    }

    if (inBlockComment) {
      output[index] = " ";
      if (character === "*" && next === "/") {
        output[index + 1] = " ";
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      lineHasOnlyWhitespace = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      lineHasOnlyWhitespace = false;
      continue;
    }

    if (
      character === "/" &&
      next === "/" &&
      source[index - 1] !== ":"
    ) {
      output[index] = " ";
      output[index + 1] = " ";
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (character === "#" && lineHasOnlyWhitespace) {
      output[index] = " ";
      inLineComment = true;
      continue;
    }

    if (!/\s/.test(character)) lineHasOnlyWhitespace = false;
  }

  return output.join("");
}

function trimRequestSpan(
  source: string,
  startOffset: number,
  endOffset: number,
): ElasticsearchConsoleRequest | null {
  const raw = source.slice(startOffset, endOffset);
  const trailingWhitespace = raw.match(/\s+$/)?.[0].length ?? 0;
  const normalizedEnd = Math.max(startOffset, endOffset - trailingWhitespace);
  const text = source.slice(startOffset, normalizedEnd);
  if (!text.trim()) return null;

  return {
    startOffset,
    endOffset: normalizedEnd,
    text,
  };
}

/**
 * Splits Kibana Console-style Elasticsearch requests without parsing their
 * JSON bodies. A request starts at a standalone `METHOD path` line and ends
 * immediately before the next request line.
 */
export function parseElasticsearchConsoleRequests(
  source: string,
): ElasticsearchConsoleRequest[] {
  if (!source.trim()) return [];

  const requestStarts = lineSpans(maskElasticsearchConsoleComments(source))
    .filter((line) => REQUEST_LINE.test(line.text))
    .map((line) => line.startOffset);

  if (requestStarts.length === 0) {
    const leadingWhitespace = source.match(/^\s+/)?.[0].length ?? 0;
    const request = trimRequestSpan(source, leadingWhitespace, source.length);
    return request ? [request] : [];
  }

  return requestStarts.flatMap((startOffset, index) => {
    const endOffset = requestStarts[index + 1] ?? source.length;
    const request = trimRequestSpan(source, startOffset, endOffset);
    return request ? [request] : [];
  });
}

/**
 * Returns the request under the cursor. Whitespace between two requests stays
 * associated with the preceding request, matching Kibana Console behavior.
 */
export function elasticsearchRequestAtOffset(
  source: string,
  cursorOffset: number,
): ElasticsearchConsoleRequest | null {
  const requests = parseElasticsearchConsoleRequests(source);
  if (requests.length === 0) return null;

  const boundedOffset = Math.max(0, Math.min(cursorOffset, source.length));
  return (
    requests.find(
      (request, index) =>
        boundedOffset >= request.startOffset &&
        (boundedOffset <= request.endOffset ||
          (index + 1 < requests.length &&
            boundedOffset < requests[index + 1]!.startOffset)),
    ) ??
    (boundedOffset < requests[0]!.startOffset
      ? requests[0]!
      : requests[requests.length - 1]!)
  );
}

export function elasticsearchConsoleRequestContext(
  source: string,
  cursorOffset: number,
  preferredIndex?: string,
): ElasticsearchConsoleRequestContext {
  const request = elasticsearchRequestAtOffset(source, cursorOffset);
  if (!request) return { request: "", index: preferredIndex };
  const requestLine = request.text.split("\n", 1)[0]?.trim() || "";
  const match = requestLine.match(
    /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)/i,
  );
  const path = match?.[2]?.replace(/["']/g, "");
  const firstPathSegment = path
    ?.replace(/^\/+/, "")
    .split(/[/?#]/, 1)[0]
    ?.trim();
  const explicitIndex =
    firstPathSegment &&
    !firstPathSegment.startsWith("_") &&
    !/[,*${}]/.test(firstPathSegment)
      ? firstPathSegment
      : undefined;
  return {
    request: request.text,
    startOffset: request.startOffset,
    endOffset: request.endOffset,
    method: match?.[1]?.toUpperCase(),
    path,
    index: explicitIndex || preferredIndex,
  };
}

/**
 * Expands an editor selection to complete Console requests. Kibana executes
 * selected requests sequentially; sending a partial JSON fragment produces a
 * confusing server error and is never useful for Console semantics.
 */
export function elasticsearchRequestsForSelection(
  source: string,
  selectionStart: number,
  selectionEnd: number,
) {
  const start = Math.max(
    0,
    Math.min(selectionStart, selectionEnd, source.length),
  );
  const end = Math.max(
    0,
    Math.min(Math.max(selectionStart, selectionEnd), source.length),
  );
  if (start === end) {
    const request = elasticsearchRequestAtOffset(source, start);
    return request ? [request] : [];
  }

  return parseElasticsearchConsoleRequests(source).filter(
    (request) => request.startOffset < end && request.endOffset > start,
  );
}

export function elasticsearchRequestNavigationOffset(
  source: string,
  cursorOffset: number,
  direction: "previous" | "next",
) {
  const requests = parseElasticsearchConsoleRequests(source);
  if (requests.length === 0) return null;
  const current = elasticsearchRequestAtOffset(source, cursorOffset);
  const currentIndex = current
    ? requests.findIndex(
        (request) =>
          request.startOffset === current.startOffset &&
          request.endOffset === current.endOffset,
      )
    : -1;

  if (direction === "next") {
    return requests[Math.min(requests.length - 1, currentIndex + 1)]!
      .startOffset;
  }
  return requests[Math.max(0, currentIndex - 1)]!.startOffset;
}

export function prepareElasticsearchConsoleExecution(source: string) {
  return maskElasticsearchConsoleComments(source).trim();
}

export function elasticsearchConsoleVariableNames(source: string) {
  const names: string[] = [];
  for (const match of source.matchAll(/\$\{([\w.-]+)\}/g)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function parsedConsoleVariable(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function isInsideJsonString(source: string, offset: number) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < offset; index += 1) {
    const character = source[index]!;
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = inString;
    } else if (character === '"') {
      inString = !inString;
    }
  }
  return inString;
}

/**
 * Applies Kibana-compatible variable coercion. A quoted, standalone variable
 * may become a JSON scalar/object; triple quotes always force a string.
 */
export function substituteElasticsearchConsoleVariables(
  source: string,
  variables: Record<string, string> = {},
) {
  const missingVariable = elasticsearchConsoleVariableNames(source).find(
    (name) => !Object.prototype.hasOwnProperty.call(variables, name),
  );
  if (missingVariable) {
    throw new Error(
      `Elasticsearch Console variable "\${${missingVariable}}" needs a value.`,
    );
  }

  const resolve = (name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(
        `Elasticsearch Console variable "\${${name}}" needs a value.`,
      );
    }
    return parsedConsoleVariable(variables[name]!);
  };

  let substituted = source.replace(
    /"""\s*\$\{([\w.-]+)\}\s*"""/g,
    (_match, name: string) => JSON.stringify(String(resolve(name))),
  );
  substituted = substituted.replace(
    /"\$\{([\w.-]+)\}"/g,
    (_match, name: string) => JSON.stringify(resolve(name)),
  );
  substituted = substituted.replace(
    /\$\{([\w.-]+)\}/g,
    (_match, name: string, offset: number) => {
      const value = resolve(name);
      if (isInsideJsonString(substituted, offset)) {
        return JSON.stringify(String(value)).slice(1, -1);
      }
      const lineStart = substituted.lastIndexOf("\n", offset - 1) + 1;
      const linePrefix = substituted.slice(lineStart, offset);
      if (/^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S*$/i.test(linePrefix)) {
        return String(value);
      }
      return JSON.stringify(value);
    },
  );
  return substituted;
}

export function compileElasticsearchConsoleExecution(
  source: string,
  variables: Record<string, string> = {},
) {
  return substituteElasticsearchConsoleVariables(
    prepareElasticsearchConsoleExecution(source),
    variables,
  );
}

function requestBody(request: ElasticsearchConsoleRequest) {
  const masked = maskElasticsearchConsoleComments(request.text);
  const firstLineEnd = masked.indexOf("\n");
  const firstLine = masked.slice(
    0,
    firstLineEnd === -1 ? masked.length : firstLineEnd,
  );
  const hasRequestLine = REQUEST_LINE.test(firstLine);
  if (!hasRequestLine) {
    return {
      body: masked.trim(),
      bodyStartOffset:
        request.startOffset + (masked.match(/^\s+/)?.[0].length ?? 0),
      requestPath: "/_search",
    };
  }

  const path =
    firstLine.match(
      /^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/?\S+)/i,
    )?.[1] || "";
  if (firstLineEnd === -1) {
    const inlineBody = firstLine
      .replace(
        /^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+\s*/i,
        "",
      )
      .trim();
    return {
      body: inlineBody,
      bodyStartOffset: request.startOffset + firstLine.length - inlineBody.length,
      requestPath: path,
    };
  }

  const rawBody = masked.slice(firstLineEnd + 1);
  const leadingWhitespace = rawBody.match(/^\s+/)?.[0].length ?? 0;
  return {
    body: rawBody.trim(),
    bodyStartOffset: request.startOffset + firstLineEnd + 1 + leadingWhitespace,
    requestPath: path,
  };
}

function jsonErrorOffset(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/position\s+(\d+)/i);
  return {
    message: message.replace(/^JSON\.parse:\s*/i, ""),
    offset: match ? Number(match[1]) : 0,
  };
}

function validationBody(body: string) {
  return body
    .replace(/"""\s*\$\{[\w.-]+\}\s*"""/g, '"variable"')
    .replace(/\$\{[\w.-]+\}/g, "null");
}

function isNdjsonEndpoint(path: string) {
  const pathname = path.split(/[?#]/, 1)[0]?.toLowerCase() || "";
  return /(?:^|\/)_(?:bulk|msearch|msearch\/template)$/.test(pathname);
}

/**
 * Produces local, offset-aware diagnostics before a request reaches the
 * server. API-semantic errors still come from Elasticsearch.
 */
export function validateElasticsearchConsole(
  source: string,
): ElasticsearchConsoleDiagnostic[] {
  if (!source.trim()) return [];
  const requests = parseElasticsearchConsoleRequests(source);
  if (requests.length === 0) {
    return [
      {
        message:
          "Start an Elasticsearch request with GET, POST, PUT, PATCH, DELETE, or HEAD.",
        startOffset: 0,
        endOffset: Math.max(1, source.length),
        severity: "error",
      },
    ];
  }

  const diagnostics: ElasticsearchConsoleDiagnostic[] = [];
  const masked = maskElasticsearchConsoleComments(source);
  const firstRequest = requests[0]!;
  const prefix = masked.slice(0, firstRequest.startOffset).trim();
  if (prefix) {
    const startOffset = masked.indexOf(prefix);
    diagnostics.push({
      message: "Unexpected content before the first Elasticsearch request.",
      startOffset,
      endOffset: startOffset + prefix.length,
      severity: "error",
    });
  }

  requests.forEach((request) => {
    const { body, bodyStartOffset, requestPath } = requestBody(request);
    const pathOffset = request.text.indexOf(requestPath);
    if (requestPath.includes("://")) {
      diagnostics.push({
        message:
          "Use a relative Elasticsearch API path; the configured data source supplies the server address.",
        startOffset: request.startOffset + Math.max(0, pathOffset),
        endOffset:
          request.startOffset +
          Math.max(0, pathOffset) +
          requestPath.length,
        severity: "error",
      });
    }
    if (/["']/.test(requestPath)) {
      diagnostics.push({
        message:
          'Do not quote an Elasticsearch request path or index name. Use POST /index/_search.',
        startOffset: request.startOffset + Math.max(0, pathOffset),
        endOffset:
          request.startOffset + Math.max(0, pathOffset) + requestPath.length,
        severity: "error",
      });
    } else if (requestPath && !requestPath.startsWith("/")) {
      diagnostics.push({
        message:
          'Console request paths should start with "/", for example POST /index/_search.',
        startOffset: request.startOffset + Math.max(0, pathOffset),
        endOffset:
          request.startOffset + Math.max(0, pathOffset) + requestPath.length,
        severity: "warning",
      });
    }
    if (!body) return;

    if (isNdjsonEndpoint(requestPath)) {
      let lineOffset = 0;
      body.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          lineOffset += line.length + 1;
          return;
        }
        try {
          JSON.parse(validationBody(trimmed));
        } catch (error) {
          const detail = jsonErrorOffset(error);
          diagnostics.push({
            message: `Invalid NDJSON line: ${detail.message}`,
            startOffset: bodyStartOffset + lineOffset + detail.offset,
            endOffset: Math.min(
              source.length,
              bodyStartOffset + lineOffset + Math.max(1, line.length),
            ),
            severity: "error",
          });
        }
        lineOffset += line.length + 1;
      });
      return;
    }

    try {
      JSON.parse(validationBody(body));
    } catch (error) {
      const detail = jsonErrorOffset(error);
      diagnostics.push({
        message: `Invalid JSON request body: ${detail.message}`,
        startOffset: Math.min(
          source.length,
          bodyStartOffset + detail.offset,
        ),
        endOffset: Math.min(
          source.length,
          bodyStartOffset + detail.offset + 1,
        ),
        severity: "error",
      });
    }
  });

  return diagnostics;
}

function currentLineAtOffset(source: string, offset: number) {
  const boundedOffset = Math.max(0, Math.min(offset, source.length));
  const lineStart = source.lastIndexOf("\n", boundedOffset - 1) + 1;
  const nextNewline = source.indexOf("\n", boundedOffset);
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  return {
    beforeCursor: source.slice(lineStart, boundedOffset),
    text: source.slice(lineStart, lineEnd),
  };
}

type JsonContextFrame = {
  kind: "object" | "array";
  ownerKey?: string;
  lastKey?: string;
};

function scanJsonCompletionContext(source: string) {
  const frames: JsonContextFrame[] = [];
  let previous: string | undefined;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let stringIsKey = false;
  let lastClosedStringWasKey = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
        lastClosedStringWasKey = stringIsKey;
        if (stringIsKey) {
          const frame = frames[frames.length - 1];
          if (frame?.kind === "object") {
            frame.lastKey = source.slice(stringStart + 1, index);
          }
        }
        previous = '"';
      }
      continue;
    }
    if (/\s/.test(character)) continue;

    if (character === '"') {
      inString = true;
      escaped = false;
      stringStart = index;
      stringIsKey = previous === "{" || previous === ",";
      continue;
    }
    if (character === "{") {
      const parent = frames[frames.length - 1];
      const ownerKey =
        previous === ":"
          ? parent?.lastKey
          : previous === "["
            ? parent?.ownerKey
            : undefined;
      frames.push({ kind: "object", ownerKey });
      previous = character;
      continue;
    }
    if (character === "[") {
      const parent = frames[frames.length - 1];
      frames.push({
        kind: "array",
        ownerKey: previous === ":" ? parent?.lastKey : undefined,
      });
      previous = character;
      continue;
    }
    if (character === "}" || character === "]") {
      frames.pop();
      previous = character;
      continue;
    }
    previous = character;
  }

  const current = frames[frames.length - 1];
  const parent = frames[frames.length - 2];
  const typed = inString
    ? source.slice(stringStart + 1)
    : source.match(/[\w.@*-]+$/u)?.[0] || "";
  return {
    frames,
    current,
    parent,
    previous,
    inString,
    stringIsKey,
    lastClosedStringWasKey,
    typed,
  };
}

const FIELD_OBJECT_KEYS = new Set([
  "match",
  "match_phrase",
  "match_phrase_prefix",
  "term",
  "terms",
  "range",
  "prefix",
  "wildcard",
  "regexp",
  "fuzzy",
  "sort",
]);
const QUERY_ARRAY_KEYS = new Set(["filter", "must", "must_not", "should"]);

/**
 * Classifies the cursor with Console semantics before any completion source is
 * consulted. This prevents JSON/LSP candidates from leaking into HTTP paths
 * and prevents index candidates from being quoted like JSON strings.
 */
export function elasticsearchConsoleCompletionContext(
  source: string,
  cursorOffset: number,
): ElasticsearchConsoleCompletionContext {
  const boundedOffset = Math.max(0, Math.min(cursorOffset, source.length));
  const line = currentLineAtOffset(source, boundedOffset);
  const beforeCursor = line.beforeCursor.trimStart();
  const requestLine = beforeCursor.match(
    /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(.*)$/i,
  );
  if (requestLine) {
    const method = requestLine[1]!.toUpperCase();
    const typedPath = requestLine[2] || "";
    const pathWithoutQuery = typedPath.split(/[?#]/, 1)[0] || "";
    const normalizedPath = pathWithoutQuery.replace(/^\/+/, "");
    const segments = normalizedPath.split("/");
    const firstSegment = segments[0] || "";
    const hasOperationSegment =
      firstSegment.startsWith("_") || segments.length > 1;
    if (hasOperationSegment) {
      const index = firstSegment.startsWith("_") ? undefined : firstSegment;
      const operation = index ? segments.slice(1).join("/") : normalizedPath;
      return {
        area: "operation",
        typed: operation,
        method,
        index,
        operation,
        ownerKey: index,
      };
    }
    return {
      area: "path",
      typed: typedPath,
      method,
      index: firstSegment || undefined,
    };
  }

  const request = elasticsearchRequestAtOffset(source, boundedOffset);
  const requestHeaderEnd = request
    ? source.indexOf("\n", request.startOffset)
    : -1;
  const cursorIsInRequestBody = Boolean(
    request &&
      requestHeaderEnd >= request.startOffset &&
      boundedOffset > requestHeaderEnd,
  );

  // A blank body line after `METHOD /path` belongs to that request. Treating
  // it as a new method line is what previously produced a stray `GET` ghost
  // suggestion below a valid `_search` request.
  if (
    (!beforeCursor || /^[A-Za-z]*$/.test(beforeCursor)) &&
    !cursorIsInRequestBody
  ) {
    return { area: "method", typed: beforeCursor };
  }
  if (!request) return { area: "unknown", typed: "" };

  const requestBeforeCursor = source.slice(request.startOffset, boundedOffset);
  const firstNewline = requestBeforeCursor.indexOf("\n");
  if (firstNewline === -1) return { area: "unknown", typed: "" };

  const bodyBeforeCursor = maskElasticsearchConsoleComments(
    requestBeforeCursor.slice(firstNewline + 1),
  );
  const requestContext = elasticsearchConsoleRequestContext(
    source,
    boundedOffset,
  );
  const requestPathSegments = requestContext.path
    ?.split(/[?#]/, 1)[0]
    ?.replace(/^\/+/, "")
    .split("/");
  const operation = requestPathSegments?.[0]?.startsWith("_")
    ? requestPathSegments.join("/")
    : requestPathSegments?.slice(1).join("/");
  if (!bodyBeforeCursor.trim()) {
    return {
      area: "body-start",
      typed: "",
      method: requestContext.method,
      index: requestContext.index,
      operation,
      ownerKey: operation,
    };
  }
  const scan = scanJsonCompletionContext(bodyBeforeCursor);

  // Once a complete body is followed by a genuinely empty line, users are
  // starting the next Console request rather than adding another JSON key.
  if (!beforeCursor && scan.frames.length === 0) {
    return { area: "method", typed: "" };
  }
  const currentObject = [...scan.frames]
    .reverse()
    .find((frame) => frame.kind === "object");
  const currentObjectIndex = scan.frames.lastIndexOf(currentObject!);
  const parentObject = scan.frames
    .slice(0, Math.max(0, currentObjectIndex))
    .reverse()
    .find((frame) => frame.kind === "object");
  const ownerKey = currentObject?.ownerKey;
  const keyPosition =
    scan.previous === "{" ||
    scan.previous === "," ||
    (scan.inString && scan.stringIsKey) ||
    (!scan.inString && scan.previous === '"' && scan.lastClosedStringWasKey);
  const typed =
    !scan.inString && scan.previous === '"' && scan.lastClosedStringWasKey
      ? currentObject?.lastKey || scan.typed
      : scan.typed;

  if (!keyPosition) {
    return {
      area: "value",
      typed,
      ownerKey,
      valueKey: currentObject?.lastKey,
    };
  }
  if (!ownerKey) {
    return { area: "top-level", typed };
  }
  if (ownerKey === "query" || QUERY_ARRAY_KEYS.has(ownerKey)) {
    return { area: "query-clause", typed, ownerKey };
  }
  if (ownerKey === "bool") {
    return { area: "bool-clause", typed, ownerKey };
  }
  if (ownerKey === "aggs" || ownerKey === "aggregations") {
    return { area: "aggregation-name", typed, ownerKey };
  }
  if (
    parentObject?.ownerKey === "aggs" ||
    parentObject?.ownerKey === "aggregations"
  ) {
    return { area: "aggregation-type", typed, ownerKey };
  }
  if (FIELD_OBJECT_KEYS.has(ownerKey)) {
    return { area: "field-name", typed, ownerKey };
  }
  return { area: "unknown", typed, ownerKey };
}

/**
 * Provides Kibana Console-style request and JSON-body completions alongside
 * schema-aware mapping-field suggestions supplied by the database LSP.
 */
export function elasticsearchConsoleCompletions(
  source: string,
  cursorOffset: number,
): ElasticsearchConsoleCompletion[] {
  const context = elasticsearchConsoleCompletionContext(source, cursorOffset);
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
      ? indexOperationCompletions(context.method, context.typed)
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
    return requestBodyCompletions(context.operation, context.method);
  }
  if (context.area === "query-clause") {
    return QUERY_CLAUSE_COMPLETIONS;
  }
  if (context.area === "bool-clause") {
    return BOOL_CLAUSE_COMPLETIONS;
  }
  if (context.area === "aggregation-name") {
    return AGGREGATION_NAME_COMPLETIONS;
  }
  if (context.area === "aggregation-type") {
    return AGGREGATION_TYPE_COMPLETIONS;
  }
  if (context.area === "top-level") {
    const request = elasticsearchRequestAtOffset(source, cursorOffset);
    const requestLine = request?.text.slice(
      0,
      request.text.indexOf("\n") === -1
        ? request.text.length
        : request.text.indexOf("\n"),
    );
    return /\/(?:_search|_count)(?:[/?]|$)/i.test(requestLine || "")
      ? SEARCH_BODY_COMPLETIONS
      : [];
  }
  if (context.area === "value" && context.valueKey === "_source") {
    return SOURCE_VALUE_COMPLETIONS;
  }

  return [];
}

function plainElasticsearchSnippet(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "$" || value[index + 1] !== "{") {
      if (value[index] === "$" && /\d/.test(value[index + 1] || "")) {
        while (/\d/.test(value[index + 1] || "")) index += 1;
      } else {
        output += value[index];
      }
      continue;
    }

    let cursor = index + 2;
    while (/\d/.test(value[cursor] || "")) cursor += 1;
    if (value[cursor] === "}") {
      index = cursor;
      continue;
    }
    if (value[cursor] !== ":") {
      output += value[index];
      continue;
    }

    const defaultStart = cursor + 1;
    let depth = 1;
    cursor = defaultStart;
    for (; cursor < value.length; cursor += 1) {
      if (value[cursor] === "{") depth += 1;
      if (value[cursor] === "}") depth -= 1;
      if (depth === 0) break;
    }
    output += value.slice(defaultStart, cursor);
    index = cursor;
  }
  return output;
}

/** Deterministic, syntax-safe ghost text used by Smart Tab in Console tabs. */
export function elasticsearchConsoleInlineSuggestion(
  source: string,
  cursorOffset: number,
  preferredIndex?: string,
) {
  const context = elasticsearchConsoleCompletionContext(source, cursorOffset);
  if (context.area === "method") {
    const method = HTTP_METHODS.find((item) =>
      item.toLowerCase().startsWith(context.typed.toLowerCase()),
    );
    return method ? `${method.slice(context.typed.length)} ` : "";
  }

  if (context.area === "path") {
    if (/["']/.test(context.typed)) return "";
    const canonicalIndex = preferredIndex?.trim().replace(/^\/+|\/+$/g, "");
    const target = canonicalIndex
      ? `/${canonicalIndex}/_search\n{\n  \"query\": {\n    \"match_all\": {}\n  }\n}`
      : "/_search\n{\n  \"query\": {\n    \"match_all\": {}\n  }\n}";
    if (!context.typed) return target;
    if (target.startsWith(context.typed)) {
      return target.slice(context.typed.length);
    }
    return "";
  }

  if (context.area === "operation") {
    const candidate = elasticsearchConsoleCompletions(
      source,
      cursorOffset,
    )[0];
    if (!candidate) return "";
    const insertion = plainElasticsearchSnippet(candidate.insertText);
    return insertion.startsWith(context.typed)
      ? insertion.slice(context.typed.length)
      : "";
  }

  const completions = elasticsearchConsoleCompletions(source, cursorOffset);
  const candidate = completions.find((item) =>
    item.label.toLowerCase().startsWith(context.typed.toLowerCase()),
  );
  if (!candidate) return "";
  const insertion = plainElasticsearchSnippet(candidate.insertText);
  const beforeCursor = source.slice(0, cursorOffset);
  const quotedClosed = context.typed
    ? `"${context.typed}"`
    : "";
  const quotedOpen = context.typed ? `"${context.typed}` : "";
  const fragment = quotedClosed && beforeCursor.endsWith(quotedClosed)
    ? quotedClosed
    : quotedOpen && beforeCursor.endsWith(quotedOpen)
      ? quotedOpen
      : context.typed;
  return insertion.startsWith(fragment)
    ? insertion.slice(fragment.length)
    : "";
}

/**
 * Narrows schema/LSP results to the responsibility of the current Console
 * context. Built-in DSL keywords are deliberately owned by the Console
 * provider because it inserts complete, valid property snippets.
 */
export function elasticsearchSchemaCompletionsForContext<
  T extends ElasticsearchSchemaCompletion,
>(
  items: T[],
  context: ElasticsearchConsoleCompletionContext,
  preferredIndex?: string,
): T[] {
  const normalizedPreferred = preferredIndex?.toLowerCase();
  if (
    context.area === "method" ||
    context.area === "operation" ||
    context.area === "body-start"
  ) {
    return [];
  }

  if (context.area === "path") {
    return items
      .filter((item) => /elasticsearch index/i.test(item.detail || ""))
      .filter(
        (item, index, rows) =>
          rows.findIndex(
            (candidate) =>
              candidate.label.toLowerCase() === item.label.toLowerCase(),
          ) === index,
      )
      .sort((left, right) => {
        const leftPreferred =
          left.label.toLowerCase() === normalizedPreferred ? 0 : 1;
        const rightPreferred =
          right.label.toLowerCase() === normalizedPreferred ? 0 : 1;
        return (
          leftPreferred - rightPreferred ||
          left.label.localeCompare(right.label, undefined, {
            sensitivity: "base",
            numeric: true,
          })
        );
      })
      .map((item, index) => ({
        ...item,
        insertText: `/${item.label}`,
        insertTextFormat: 1,
        sortText: String(index).padStart(3, "0"),
        detail: item.detail || "Elasticsearch index",
      }));
  }

  const expectsMappingField =
    context.area === "field-name" ||
    (context.area === "value" &&
      ["field", "fields", "_source"].includes(context.valueKey || ""));
  if (!expectsMappingField) return [];

  return items
    .filter((item) => /elasticsearch field in /i.test(item.detail || ""))
    .sort((left, right) => {
      const leftCurrent = normalizedPreferred
        ? left.detail?.toLowerCase().endsWith(` ${normalizedPreferred}`)
          ? 0
          : 1
        : 0;
      const rightCurrent = normalizedPreferred
        ? right.detail?.toLowerCase().endsWith(` ${normalizedPreferred}`)
          ? 0
          : 1
        : 0;
      return (
        leftCurrent - rightCurrent ||
        left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      );
    })
    .filter(
      (item, index, rows) =>
        rows.findIndex(
          (candidate) =>
            candidate.label.toLowerCase() === item.label.toLowerCase(),
        ) === index,
    )
    .map((item, index) => ({
      ...item,
      sortText: String(index).padStart(3, "0"),
    }));
}

/**
 * Formats every JSON request body while preserving Kibana Console request
 * lines. Invalid or non-JSON bodies are left untouched for the server to
 * report with its native error details.
 */
export function formatElasticsearchConsole(source: string) {
  const requests = parseElasticsearchConsoleRequests(source);
  if (requests.length === 0) return source;

  return requests
    .map((request) => {
      const newline = request.text.indexOf("\n");
      if (newline === -1) return request.text.trim();
      const header = request.text.slice(0, newline).trim();
      const body = request.text.slice(newline + 1).trim();
      if (!body) return header;
      try {
        return `${header}\n${JSON.stringify(JSON.parse(body), null, 2)}`;
      } catch {
        return request.text.trim();
      }
    })
    .join("\n\n");
}
