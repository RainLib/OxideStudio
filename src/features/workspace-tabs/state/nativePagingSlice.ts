import { QueryResult, queryService } from "@/services/tauri";
import { useTaskStore } from "@/store/useTaskStore";

import type { TabSlice } from "./types";

export const createNativePagingSlice: TabSlice<"loadMoreNativeQueryPage"> = (
  set,
  get,
) => ({
  loadMoreNativeQueryPage: async (tabId) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    const cursor = tab?.nativeQueryCursor;
    const resultIndex = tab?.activeResultIndex ?? 0;
    const currentResult = tab?.results?.[resultIndex];
    if (
      !tab ||
      tab.type !== "query" ||
      tab.isExecuting ||
      !tab.connectionId ||
      !cursor ||
      !tab.nativeQueryHasMore ||
      !currentResult
    ) {
      return false;
    }

    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "query",
      title: `Load more ${tab.title}`,
      detail: "Fetching the next native result page",
    });
    set((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.id === tabId
          ? { ...candidate, isExecuting: true, error: null }
          : candidate,
      ),
    }));

    try {
      const page = await queryService.fetchNativeQueryPage(
        tab.connectionId,
        cursor,
        Math.min(10_000, Math.max(1, tab.nativeQueryPageSize || 500)),
      );
      const latest = get().tabs.find((candidate) => candidate.id === tabId);
      if (
        !latest ||
        latest.connectionId !== tab.connectionId ||
        latest.nativeQueryCursor !== cursor
      ) {
        if (page.nextCursor) {
          void queryService
            .closeNativeQueryPage(tab.connectionId, page.nextCursor)
            .catch(() => undefined);
        }
        taskStore.cancelTask(taskId, "Workspace changed while loading results");
        return false;
      }
      const latestIndex = latest.activeResultIndex ?? 0;
      const previous = latest.results?.[latestIndex];
      if (!previous)
        throw new Error("The native query result is no longer available");
      const sameColumns =
        previous.columns.length === page.result.columns.length &&
        previous.columns.every(
          (column, index) =>
            column.name === page.result.columns[index]?.name &&
            column.data_type === page.result.columns[index]?.data_type,
        );
      if (!sameColumns) {
        if (page.nextCursor) {
          void queryService
            .closeNativeQueryPage(tab.connectionId, page.nextCursor)
            .catch(() => undefined);
        }
        throw new Error(
          "Native query page schema changed; rerun the query to refresh safely",
        );
      }
      const merged: QueryResult = {
        ...previous,
        rows: [...previous.rows, ...page.result.rows],
        truncated: page.result.truncated,
        rowLimit: page.result.rowLimit ?? previous.rowLimit,
      };
      set((state) => ({
        tabs: state.tabs.map((candidate) => {
          if (candidate.id !== tabId) return candidate;
          const results = [...(candidate.results || [])];
          results[latestIndex] = merged;
          const resultRuns = candidate.resultRuns?.map((run) => {
            if (run.id !== candidate.activeResultRunId) return run;
            const runResults = [...run.results];
            runResults[latestIndex] = merged;
            return { ...run, results: runResults };
          });
          return {
            ...candidate,
            isExecuting: false,
            results,
            resultRuns,
            nativeQueryCursor: page.nextCursor || null,
            nativeQueryHasMore: Boolean(page.nextCursor),
          };
        }),
      }));
      taskStore.finishTask(
        taskId,
        `${page.result.rows.length.toLocaleString()} additional row${page.result.rows.length === 1 ? "" : "s"}`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      taskStore.failTask(taskId, message);
      set((state) => ({
        tabs: state.tabs.map((candidate) =>
          candidate.id === tabId
            ? { ...candidate, isExecuting: false, error: message }
            : candidate,
        ),
      }));
      return false;
    }
  },
});
