import type { QueryResult } from "./query";

export interface DatabaseSearchColumn {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
}

export interface DatabaseSearchSqlOptions {
  schema?: string;
  tableName: string;
  columns: DatabaseSearchColumn[];
  term: string;
  limit?: number;
}

export interface DatabaseSearchSql {
  sql: string;
  searchableColumns: string[];
}

export interface DatabaseSearchExecution {
  searchableColumns: string[];
  results: QueryResult[];
}

export interface SearchResultWhereOptions {
  columns: DatabaseSearchColumn[];
  resultColumns: string[];
  row: unknown[];
  matchedColumns: string[];
}

export interface SearchResultWhereBatchOptions {
  columns: DatabaseSearchColumn[];
  resultColumns: string[];
  rows: unknown[][];
  matchedColumns: string[][];
}
