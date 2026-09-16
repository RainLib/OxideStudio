import { type ElasticsearchOperationCompletion } from "@/features/query-languages/elasticsearch/types";

export const SEARCH_REQUEST_BODY = `{
  "query": {
    "match_all": {}
  }
}`;

export const ENDPOINT_COMPLETIONS: ElasticsearchOperationCompletion[] = [
  {
    label: "/{index}/_search",
    insertText:
      '/${1:index}/_search\n{\n  "query": {\n    "match_all": {}\n  }\n}',
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
    insertText: '/_search\n{\n  "query": {\n    "match_all": {}\n  }\n}',
    detail: "Search all available indices",
    kind: "snippet",
    methods: ["GET", "POST"],
  },
];

export const INDEX_OPERATION_COMPLETIONS: ElasticsearchOperationCompletion[] = [
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
    insertText: "_field_caps?fields=${1:*}",
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
    insertText: "_doc/${1:id}",
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

export const GLOBAL_OPERATION_COMPLETIONS: ElasticsearchOperationCompletion[] =
  [
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
      label: "_cluster/stats",
      insertText: "_cluster/stats",
      detail: "Read cluster statistics",
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
      label: "_cat/shards",
      insertText: "_cat/shards?v=true",
      detail: "List shard allocation",
      kind: "property",
      methods: ["GET"],
    },
    {
      label: "_cat/thread_pool",
      insertText: "_cat/thread_pool?v=true",
      detail: "List thread-pool statistics",
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
