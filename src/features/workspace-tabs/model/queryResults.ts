import {
  QueryResultGridState,
  QueryResultRun,
  TabData,
} from "@/features/workspace-tabs/model/types";

export const MAX_QUERY_RESULT_RUNS = 5;

export const MAX_PINNED_QUERY_RESULT_RUNS = 3;

export function boundedQueryResultRuns(
  runs: readonly QueryResultRun[],
): QueryResultRun[] {
  const pinnedRuns = runs.filter((run) => run.pinned);
  const retainedPins = pinnedRuns.slice(-MAX_PINNED_QUERY_RESULT_RUNS);
  const retainedPinIds = new Set(retainedPins.map((run) => run.id));
  const unpinnedRuns = runs.filter(
    (run) => !run.pinned || !retainedPinIds.has(run.id),
  );
  return [...retainedPins, ...unpinnedRuns.slice(-MAX_QUERY_RESULT_RUNS)].sort(
    (left, right) => left.completedAt - right.completedAt,
  );
}

export function cloneQueryResultGridState(
  gridState: QueryResultGridState | undefined,
): QueryResultGridState | undefined {
  return gridState
    ? {
        ...gridState,
        columnFilters: { ...gridState.columnFilters },
      }
    : undefined;
}

export function cloneQueryResultGridStates(
  states: Record<number, QueryResultGridState> | undefined,
): Record<number, QueryResultGridState> | undefined {
  if (!states) return undefined;
  return Object.fromEntries(
    Object.entries(states).map(([index, state]) => [
      Number(index),
      cloneQueryResultGridState(state)!,
    ]),
  );
}

export function snapshotActiveQueryResultRun(tab: TabData): TabData {
  if (
    tab.type !== "query" ||
    !tab.activeResultRunId ||
    !tab.resultRuns?.some((run) => run.id === tab.activeResultRunId)
  ) {
    return tab;
  }
  return {
    ...tab,
    resultRuns: tab.resultRuns.map((run) =>
      run.id === tab.activeResultRunId
        ? {
            ...run,
            results: tab.results || [],
            sql: tab.resultSql,
            activeResultIndex: tab.activeResultIndex ?? 0,
            gridState: cloneQueryResultGridState(tab.gridState),
            resultGridStates: cloneQueryResultGridStates(tab.resultGridStates),
          }
        : run,
    ),
  };
}

export function projectQueryResultRun(
  tab: TabData,
  run: QueryResultRun,
): TabData {
  return {
    ...tab,
    activeResultRunId: run.id,
    results: run.results,
    resultSql: run.sql,
    activeResultIndex: Math.max(
      0,
      Math.min(run.activeResultIndex, Math.max(0, run.results.length - 1)),
    ),
    gridState: cloneQueryResultGridState(run.gridState),
    resultGridStates: cloneQueryResultGridStates(run.resultGridStates),
    queryOutputView: "results",
    error: null,
    queryError: null,
  };
}
