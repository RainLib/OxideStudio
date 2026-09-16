export interface ElasticsearchConsoleFileImportResult {
  filePath: string;
  fileName: string;
  content: string;
}

export interface ElasticsearchConsoleFileExportResult {
  exported: boolean;
  filePath?: string | null;
  byteCount: number;
}

export type SearchIndexMetadataKind = "mapping" | "settings" | "stats";

export interface ElasticsearchIndexClearPlan {
  index: string;
  isPattern: boolean;
  documentCount?: number | null;
  requestPreview: string;
  confirmationPhrase?: string | null;
  confirmationToken: string;
  serverVersion?: string | null;
}

export interface SearchIndexClearResult {
  total: number;
  deleted: number;
  versionConflicts: number;
  timedOut: boolean;
  failures: string[];
}
