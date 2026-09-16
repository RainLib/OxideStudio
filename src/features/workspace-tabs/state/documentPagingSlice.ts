import { confirmDiscardTabChanges } from "@/features/workspace-tabs/model/tabLifecycle";
import { schemaService } from "@/services/tauri";
import { ensureConnectionReady } from "@/store/useConnectionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { TabSlice } from "./types";

export const createDocumentPagingSlice: TabSlice<"loadDocumentPage"> = (
  set,
  get,
) => ({
  loadDocumentPage: async (tabId, page, options) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (
      !tab ||
      tab.type !== "table" ||
      !tab.connectionId ||
      !tab.schemaName ||
      !tab.tableName
    ) {
      return false;
    }
    if (
      !options?.discardDraftsConfirmed &&
      !confirmDiscardTabChanges(
        [tab],
        options?.discardAction || "load another document page",
      )
    ) {
      return false;
    }

    const nextPage = Math.max(0, page ?? tab.tablePage ?? 0);
    const pageSize = Math.min(1_000, Math.max(1, tab.tablePageSize || 100));
    const cursor =
      nextPage === 0 ? null : tab.documentPageCursors?.[nextPage] || null;
    if (nextPage > 0 && !cursor) return false;

    const nextFilter =
      options?.filter === undefined
        ? tab.documentFilter || null
        : options.filter;
    const nextSort =
      options?.sort === undefined ? tab.documentSort || null : options.sort;
    const previousCursor =
      nextPage === 0
        ? [...(tab.documentPageCursors || [])]
            .reverse()
            .find((value): value is string => Boolean(value))
        : undefined;
    if (previousCursor) {
      void schemaService
        .closeDocumentCursor(tab.connectionId, previousCursor)
        .catch(() => undefined);
    }

    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "table",
      title: `Load ${tab.tableName}`,
      detail: `Document page ${nextPage + 1}`,
    });
    set((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.id === tabId
          ? { ...candidate, isExecuting: true, error: null }
          : candidate,
      ),
    }));

    try {
      const readiness = await ensureConnectionReady(tab.connectionId);
      if (readiness.status === "cancelled") {
        taskStore.cancelTask(taskId, "Workspace changed before loading began");
        set((state) => ({
          tabs: state.tabs.map((candidate) =>
            candidate.id === tabId
              ? { ...candidate, isExecuting: false }
              : candidate,
          ),
        }));
        return false;
      }
      if (readiness.status === "error") throw new Error(readiness.message);

      const pageResult = await schemaService.getDocumentPage(
        tab.connectionId,
        tab.schemaName,
        tab.tableName,
        cursor,
        pageSize,
        nextFilter,
        nextSort,
      );
      const currentTab = get().tabs.find((candidate) => candidate.id === tabId);
      if (
        currentTab?.connectionId !== tab.connectionId ||
        currentTab?.schemaName !== tab.schemaName ||
        currentTab?.tableName !== tab.tableName
      ) {
        if (pageResult.nextCursor) {
          void schemaService
            .closeDocumentCursor(tab.connectionId, pageResult.nextCursor)
            .catch(() => undefined);
        }
        taskStore.cancelTask(
          taskId,
          "Workspace changed while loading documents",
        );
        return false;
      }

      set((state) => ({
        tabs: state.tabs.map((candidate) => {
          if (candidate.id !== tabId) return candidate;
          const cursors =
            nextPage === 0
              ? [null]
              : (candidate.documentPageCursors || [null]).slice(
                  0,
                  nextPage + 1,
                );
          cursors[nextPage + 1] = pageResult.nextCursor || null;
          return {
            ...candidate,
            isExecuting: false,
            results: [pageResult.result],
            tablePage: nextPage,
            tablePageSize: pageSize,
            tableTotalRows: pageResult.total ?? null,
            documentPageCursors: cursors,
            documentHasNextCursor: Boolean(pageResult.nextCursor),
            documentFilter: nextFilter || null,
            documentSort: nextSort || null,
            pendingEdits: new Map(),
            newRowsCount: 0,
            newRowPlacements: [],
          };
        }),
      }));
      taskStore.finishTask(
        taskId,
        `${pageResult.result.rows.length.toLocaleString()} document${
          pageResult.result.rows.length === 1 ? "" : "s"
        }`,
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
