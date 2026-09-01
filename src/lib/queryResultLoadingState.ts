export interface QueryResultLoadingStateLike {
  isExecuting: boolean;
  tabType?: "table" | "query";
  activeResultIndex?: number;
  activeResultRunId?: string;
  /** Result selected when this query execution began. */
  executingResultIndex?: number;
  /** Completed run selected when this query execution began. */
  executingResultRunId?: string;
}

/**
 * A query tab can keep earlier result sets visible while a new execution is
 * pending. Only obscure the result set that initiated that execution; table
 * reloads continue to obscure their single live data surface.
 *
 * Older in-memory/persisted tab objects have no execution index. Keep those
 * conservative until their next execution writes the explicit identity.
 */
export function isActiveQueryResultLoading(
  state: QueryResultLoadingStateLike,
): boolean {
  if (!state.isExecuting) return false;
  if (state.tabType === "table") return true;
  if (state.executingResultIndex === undefined) return true;
  if (
    state.executingResultRunId !== undefined &&
    state.activeResultRunId !== state.executingResultRunId
  ) {
    return false;
  }
  return (state.activeResultIndex ?? 0) === state.executingResultIndex;
}
