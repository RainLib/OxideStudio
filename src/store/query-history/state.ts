import { QUERY_HISTORY_LIMIT, type QueryHistoryItem } from "@/lib/queryHistory";

export function historyErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function sortedQueryHistory(items: QueryHistoryItem[]) {
  return [...items]
    .sort(
      (left, right) =>
        right.startedAt - left.startedAt || right.id.localeCompare(left.id),
    )
    .slice(0, QUERY_HISTORY_LIMIT);
}
