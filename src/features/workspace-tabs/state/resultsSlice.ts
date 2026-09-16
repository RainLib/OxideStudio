import {
  cloneQueryResultGridState,
  MAX_PINNED_QUERY_RESULT_RUNS,
  projectQueryResultRun,
  snapshotActiveQueryResultRun,
} from "@/features/workspace-tabs/model/queryResults";
import type { TabSlice } from "./types";

export const createResultsSlice: TabSlice<
  | "setActiveResultIndex"
  | "setActiveResultRun"
  | "toggleResultRunPin"
  | "closeResultRun"
  | "setQueryOutputView"
  | "closeResultAt"
> = (set) => ({
  setActiveResultIndex: (id: string, index: number) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id) return t;
        const maxIndex = Math.max(0, (t.results?.length ?? 1) - 1);
        const activeResultIndex = Math.max(0, Math.min(index, maxIndex));
        if (t.type === "table") return { ...t, activeResultIndex };
        const resultGridStates = { ...t.resultGridStates };
        const currentGridState = cloneQueryResultGridState(t.gridState);
        if (currentGridState) {
          resultGridStates[t.activeResultIndex ?? 0] = currentGridState;
        }
        return snapshotActiveQueryResultRun({
          ...t,
          activeResultIndex,
          resultGridStates,
          gridState: cloneQueryResultGridState(
            resultGridStates[activeResultIndex],
          ),
        });
      }),
    }));
  },

  setActiveResultRun: (id: string, runId: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id || tab.type !== "query") return tab;
        const current = snapshotActiveQueryResultRun(tab);
        const run = current.resultRuns?.find(
          (candidate) => candidate.id === runId,
        );
        return run ? projectQueryResultRun(current, run) : current;
      }),
    }));
  },

  toggleResultRunPin: (id: string, runId: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id || tab.type !== "query") return tab;
        const current = snapshotActiveQueryResultRun(tab);
        const target = current.resultRuns?.find((run) => run.id === runId);
        if (!target || !current.resultRuns) return current;
        const pinnedCount = current.resultRuns.filter(
          (run) => run.pinned,
        ).length;
        if (!target.pinned && pinnedCount >= MAX_PINNED_QUERY_RESULT_RUNS) {
          return current;
        }
        return {
          ...current,
          resultRuns: current.resultRuns.map((run) =>
            run.id === runId ? { ...run, pinned: !run.pinned } : run,
          ),
        };
      }),
    }));
  },

  closeResultRun: (id: string, runId: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id || tab.type !== "query") return tab;
        const current = snapshotActiveQueryResultRun(tab);
        const runIndex =
          current.resultRuns?.findIndex((run) => run.id === runId) ?? -1;
        if (runIndex < 0 || !current.resultRuns) return current;
        const resultRuns = current.resultRuns.filter((run) => run.id !== runId);
        if (current.activeResultRunId !== runId) {
          return { ...current, resultRuns };
        }
        const replacement =
          resultRuns[Math.min(runIndex, resultRuns.length - 1)];
        return replacement
          ? projectQueryResultRun({ ...current, resultRuns }, replacement)
          : {
              ...current,
              resultRuns: undefined,
              activeResultRunId: undefined,
              results: null,
              resultSql: undefined,
              activeResultIndex: 0,
              gridState: undefined,
              resultGridStates: undefined,
            };
      }),
    }));
  },

  setQueryOutputView: (id, queryOutputView) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, queryOutputView } : tab,
      ),
    }));
  },

  closeResultAt: (id: string, index: number) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id || !t.results) return t;
        const nextResults = t.results.filter(
          (_, resultIndex) => resultIndex !== index,
        );
        const currentIndex = t.activeResultIndex ?? 0;
        const nextActiveIndex =
          nextResults.length === 0
            ? 0
            : index < currentIndex
              ? currentIndex - 1
              : index === currentIndex
                ? Math.min(currentIndex, nextResults.length - 1)
                : currentIndex;
        const gridStatesBeforeClose = { ...t.resultGridStates };
        if (t.type !== "table") {
          const currentGridState = cloneQueryResultGridState(t.gridState);
          if (currentGridState)
            gridStatesBeforeClose[currentIndex] = currentGridState;
        }
        const resultGridStates =
          t.type === "table"
            ? undefined
            : Object.fromEntries(
                Object.entries(gridStatesBeforeClose)
                  .filter(([resultIndex]) => Number(resultIndex) !== index)
                  .map(([resultIndex, gridState]) => [
                    Number(resultIndex) > index
                      ? Number(resultIndex) - 1
                      : Number(resultIndex),
                    gridState,
                  ]),
              );

        return snapshotActiveQueryResultRun({
          ...t,
          results: nextResults.length > 0 ? nextResults : null,
          activeResultIndex: nextActiveIndex,
          resultGridStates,
          gridState:
            t.type === "table"
              ? t.gridState
              : cloneQueryResultGridState(resultGridStates?.[nextActiveIndex]),
        });
      }),
    }));
  },
});
