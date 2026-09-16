import { HTTP_METHODS } from "@/features/query-languages/elasticsearch/languagePolicy";

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
  hasKeySeparator?: boolean;
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

export interface ElasticsearchMappingField {
  name: string;
  dataType?: string;
}

export type ElasticsearchMajorVersion = 6 | 7 | 8;

export type ElasticsearchServerVersion = {
  major: ElasticsearchMajorVersion;
  minor: number;
};

export type ElasticsearchVersionInput =
  | ElasticsearchMajorVersion
  | ElasticsearchServerVersion;

export type ElasticsearchHttpMethod = (typeof HTTP_METHODS)[number];

export type ElasticsearchOperationCompletion =
  ElasticsearchConsoleCompletion & {
    methods: readonly ElasticsearchHttpMethod[];
  };

export interface ElasticsearchCompletionReplacementRange {
  startOffset: number;
  endOffset: number;
  quoted: boolean;
}
