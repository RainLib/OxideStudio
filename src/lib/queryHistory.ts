export const QUERY_HISTORY_LIMIT = 500;

export type QueryHistoryStatus = "success" | "error" | "cancelled";
export type QueryHistoryExecutionMode = "console" | "statement";

export interface QueryHistoryItem {
  id: string;
  projectId: string;
  connectionId: string | null;
  connectionName: string | null;
  driver: string | null;
  databaseName: string | null;
  schemaName: string | null;
  sql: string;
  status: QueryHistoryStatus;
  durationMs: number;
  rowCount: number | null;
  errorMessage: string | null;
  executionMode: QueryHistoryExecutionMode;
  startedAt: number;
  finishedAt: number;
}

export type QueryHistoryExecution = Omit<QueryHistoryItem, "id">;

export interface QueryHistoryScope {
  connectionId: string;
  databaseName?: string | null;
  schemaName?: string | null;
}

function normalizedScopeValue(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized || null;
}

/**
 * Returns recent, unique queries for an Explorer node. A missing database or
 * schema in the requested scope means "all descendants"; an explicit value
 * must match so history from another namespace is never suggested.
 */
export function queryHistoryForScope(
  history: QueryHistoryItem[],
  scope: QueryHistoryScope,
  limit = 10,
) {
  const databaseName = normalizedScopeValue(scope.databaseName);
  const schemaName = normalizedScopeValue(scope.schemaName);
  const shouldMatchDatabase = scope.databaseName !== undefined;
  const shouldMatchSchema = scope.schemaName !== undefined;
  const seenSql = new Set<string>();

  return [...history]
    .sort(
      (left, right) =>
        right.startedAt - left.startedAt || right.id.localeCompare(left.id),
    )
    .filter((item) => {
      if (item.connectionId !== scope.connectionId) return false;
      if (
        shouldMatchDatabase &&
        normalizedScopeValue(item.databaseName) !== databaseName
      ) {
        return false;
      }
      if (
        shouldMatchSchema &&
        normalizedScopeValue(item.schemaName) !== schemaName
      ) {
        return false;
      }
      const sqlKey = item.sql.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (!sqlKey || seenSql.has(sqlKey)) return false;
      seenSql.add(sqlKey);
      return true;
    })
    .slice(0, Math.max(0, limit));
}

export function queryHistoryDisplayTitle(
  item: Pick<QueryHistoryItem, "sql">,
  maxLength = 54,
) {
  const firstLine = item.sql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Untitled query";
  const compact = firstLine.replace(/\s+/g, " ");
  return compact.length > maxLength
    ? `${compact.slice(0, Math.max(1, maxLength - 1))}\u2026`
    : compact;
}

export function queryHistoryStatusFromError(
  errorMessage: string,
): QueryHistoryStatus {
  return /cancel(?:led|ed|lation)?/i.test(errorMessage) ? "cancelled" : "error";
}

export function queryHistoryRowCount(
  results:
    Array<{ rows: unknown[][]; rowsAffected?: number }> | null | undefined,
): number {
  return (
    results?.reduce(
      (total, result) =>
        total + (result.rowsAffected ?? result.rows?.length ?? 0),
      0,
    ) ?? 0
  );
}
