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

export function queryHistoryStatusFromError(
  errorMessage: string
): QueryHistoryStatus {
  return /cancel(?:led|ed|lation)?/i.test(errorMessage) ? "cancelled" : "error";
}

export function queryHistoryRowCount(
  results:
    | Array<{ rows: unknown[][]; rowsAffected?: number }>
    | null
    | undefined
): number {
  return (
    results?.reduce(
      (total, result) =>
        total + (result.rowsAffected ?? result.rows?.length ?? 0),
      0
    ) ?? 0
  );
}
