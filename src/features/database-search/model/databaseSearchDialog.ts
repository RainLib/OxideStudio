import type { DatabaseSearchRequest } from "@/lib/actionEvents";

export type SearchScope = {
  connectionId: string;
  connectionName: string;
  driver: string;
  database?: string;
  schema?: string;
  table?: string;
};

export type SearchTask = {
  schema: string;
  table: string;
  tableType?: string;
};

export type SearchPlan = {
  scope: SearchScope;
  term: string;
  limit: number;
  tasks: SearchTask[];
  nextIndex: number;
  metadataTruncated: boolean;
  databaseScopedMetadata: boolean;
};

export type SearchHit = {
  id: string;
  schema: string;
  table: string;
  tableType?: string;
  matchedColumns: string[];
  preview: string;
  whereInput: string;
};

export type SearchFailure = {
  schema: string;
  table: string;
  message: string;
};

export type DatabaseSearchDialogProps = {
  request: DatabaseSearchRequest;
  requestVersion: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function databaseSearchRelationLabel(schema: string, table: string) {
  return schema ? `${schema}.${table}` : table;
}

export function boundedDatabaseSearchError(error: unknown) {
  const message = errorMessage(error).replace(/\s+/gu, " ").trim();
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}
