import { invokeWithInterceptors } from "./client";
import type {
  DatabaseSearchExecution,
  DatabaseSearchSql,
  DatabaseSearchSqlOptions,
  SearchResultWhereBatchOptions,
  SearchResultWhereOptions,
} from "./types";

export function buildDatabaseSearchSql(
  connectionId: string,
  options: DatabaseSearchSqlOptions,
) {
  return invokeWithInterceptors<DatabaseSearchSql | null>(
    "build_database_search_sql",
    { connectionId, options },
  );
}

export function buildSearchResultWhere(
  connectionId: string,
  options: SearchResultWhereOptions,
) {
  return invokeWithInterceptors<string>("build_search_result_where", {
    connectionId,
    options,
  });
}

export function buildSearchResultWheres(
  connectionId: string,
  options: SearchResultWhereBatchOptions,
) {
  return invokeWithInterceptors<string[]>("build_search_result_wheres", {
    connectionId,
    options,
  });
}

export function executeDatabaseSearch(
  connectionId: string,
  options: DatabaseSearchSqlOptions,
  queryId: string,
  database?: string,
) {
  return invokeWithInterceptors<DatabaseSearchExecution>(
    "execute_database_search",
    { connectionId, database, queryId, options },
  );
}

export const databaseSearchService = {
  buildDatabaseSearchSql,
  buildSearchResultWhere,
  buildSearchResultWheres,
  executeDatabaseSearch,
};
