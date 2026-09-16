import { type ElasticsearchConsoleCompletion } from "@/features/query-languages/elasticsearch/types";

export const SEARCH_BODY_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
  {
    label: "query",
    insertText: '"query": {\n  ${1:"match_all": {}}\n}',
    detail: "Query DSL clause",
    kind: "property",
  },
  {
    label: "aggs",
    insertText:
      '"aggs": {\n  "${1:name}": {\n    "${2:terms}": {\n      "field": "${3:field}"\n    }\n  }\n}',
    detail: "Aggregation definition",
    kind: "property",
  },
  {
    label: "_source",
    insertText: '"_source": ${1:true}',
    detail: "Return _source or replace true with a field array",
    kind: "property",
  },
  {
    label: "sort",
    insertText: '"sort": [\n  { "${1:field}": "${2:desc}" }\n]',
    detail: "Sort search hits",
    kind: "property",
  },
  {
    label: "size",
    insertText: '"size": ${1:100}',
    detail: "Maximum number of hits",
    kind: "property",
  },
  {
    label: "from",
    insertText: '"from": ${1:0}',
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
    insertText: '"highlight": {\n  "fields": {\n    "${1:field}": {}\n  }\n}',
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
  {
    label: "runtime_mappings",
    insertText:
      '"runtime_mappings": {\n  "${1:field}": {\n    "type": "${2:keyword}"\n  }\n}',
    detail: "Define runtime fields for this search (Elasticsearch 7.11+)",
    kind: "property",
  },
  {
    label: "knn",
    insertText:
      '"knn": {\n  "field": "${1:vector}",\n  "query_vector": [${2:0.1}],\n  "k": ${3:10},\n  "num_candidates": ${4:100}\n}',
    detail: "Run an approximate k-nearest-neighbor search (Elasticsearch 8+)",
    kind: "property",
  },
];

export const BOOL_CLAUSE_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
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

export const SOURCE_VALUE_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
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

export const QUERY_CLAUSE_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
  {
    label: "match_all",
    insertText: '"match_all": {}',
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
    insertText: '"match": {\n  "${1:field}": "${2:value}"\n}',
    detail: "Full-text match",
    kind: "property",
  },
  {
    label: "term",
    insertText: '"term": {\n  "${1:field}": ${2:"value"}\n}',
    detail: "Exact term match",
    kind: "property",
  },
  {
    label: "range",
    insertText:
      '"range": {\n  "${1:field}": {\n    "gte": ${2:value},\n    "lte": ${3:value}\n  }\n}',
    detail: "Range query",
    kind: "property",
  },
  {
    label: "bool",
    insertText: '"bool": {\n  "filter": [\n    { ${1:"term": {}} }\n  ]\n}',
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
  {
    label: "type",
    insertText: '"type": {\n  "value": "${1:type}"\n}',
    detail: "Match an Elasticsearch mapping type (Elasticsearch 6 only)",
    kind: "property",
  },
  {
    label: "intervals",
    insertText:
      '"intervals": {\n  "${1:field}": {\n    "all_of": { "intervals": [] }\n  }\n}',
    detail: "Run a positional intervals query (Elasticsearch 7+)",
    kind: "property",
  },
  {
    label: "distance_feature",
    insertText:
      '"distance_feature": {\n  "field": "${1:date_or_geo_field}",\n  "pivot": "${2:7d}",\n  "origin": "${3:now}"\n}',
    detail: "Boost results by distance from an origin (Elasticsearch 7+)",
    kind: "property",
  },
  {
    label: "rank_feature",
    insertText: '"rank_feature": {\n  "field": "${1:rank_field}"\n}',
    detail: "Boost results from a rank_feature field (Elasticsearch 7+)",
    kind: "property",
  },
  {
    label: "pinned",
    insertText:
      '"pinned": {\n  "ids": ["${1:id}"],\n  "organic": { "match_all": {} }\n}',
    detail: "Pin selected documents above organic matches (Elasticsearch 7+)",
    kind: "property",
  },
  {
    label: "combined_fields",
    insertText:
      '"combined_fields": {\n  "query": "${1:value}",\n  "fields": ["${2:field}"]\n}',
    detail: "Search multiple text fields as one field (Elasticsearch 7.13+)",
    kind: "property",
  },
];

export const AGGREGATION_TYPE_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
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

export const AGGREGATION_NAME_COMPLETIONS: ElasticsearchConsoleCompletion[] = [
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
