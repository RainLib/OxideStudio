import { confirmCurrentTabChanges } from "@/features/workspace-tabs/model/confirmTabAction";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { tableService } from "@/services/tauri";
import type { TableSort } from "@/services/tauri/types";
import { ensureConnectionReady } from "@/store/useConnectionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { TabSlice } from "./types";

export const createTablePagingSlice: TabSlice<"loadTablePage"> = (
  set,
  get,
) => ({
  loadTablePage: async (tabId, page, filterSql, filters, options) => {
    const tab = get().tabs.find((t) => t.id === tabId);
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
      !(await confirmCurrentTabChanges(
        () => get().tabs.filter((candidate) => candidate.id === tabId),
        options?.discardAction || "reload the table data",
      ))
    ) {
      return false;
    }

    const nextPage = Math.max(0, page ?? tab.tablePage ?? 0);
    const pageSize = tab.tablePageSize || 500;
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "table",
      title: `Load ${tab.tableName}`,
      detail: options?.includeTotal
        ? `Page ${nextPage + 1} · calculating exact total`
        : `Page ${nextPage + 1}`,
    });
    const nextFilterSql =
      filterSql === undefined ? tab.tableFilterSql : filterSql;
    const nextFilters = filters === undefined ? tab.tableFilters : filters;
    const hasSortOverride = options?.sortOverride !== undefined;
    const totalScopeChanged =
      filterSql !== undefined || filters !== undefined || hasSortOverride;
    const requestedTableSort: TableSort | undefined = hasSortOverride
      ? options.sortOverride || undefined
      : tab.gridState?.sortColumn && tab.gridState?.sortDirection
        ? {
            column: tab.gridState.sortColumn,
            direction: tab.gridState.sortDirection,
          }
        : undefined;
    const primaryKeySort = tab.tableColumns?.find(
      (column) => column.is_primary_key,
    );
    const tableSort: TableSort | undefined =
      requestedTableSort ||
      (primaryKeySort
        ? { column: primaryKeySort.name, direction: "asc" }
        : undefined);

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isExecuting: true, error: null } : t,
      ),
    }));

    try {
      const readiness = await ensureConnectionReady(tab.connectionId);
      const currentTab = get().tabs.find((candidate) => candidate.id === tabId);
      const tabContextIsCurrent = Boolean(
        currentTab?.type === "table" &&
          currentTab.connectionId === tab.connectionId &&
          currentTab.databaseName === tab.databaseName &&
          currentTab.schemaName === tab.schemaName &&
          currentTab.tableName === tab.tableName,
      );

      if (!tabContextIsCurrent || readiness.status === "cancelled") {
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

      if (readiness.status === "error") {
        throw new Error(readiness.message);
      }

      const driver = readiness.connection.driver || DEFAULT_DATABASE_DRIVER;
      const pageRequest = [
        tab.connectionId,
        driver,
        tab.schemaName,
        tab.tableName,
        nextPage,
        pageSize,
        nextFilterSql || undefined,
        nextFilters || undefined,
        tableSort,
      ] as const;
      const pageResult = tab.databaseName
        ? options?.includeTotal
          ? await tableService.previewTablePage(
              ...pageRequest,
              tab.databaseName,
              true,
            )
          : await tableService.previewTablePage(
              ...pageRequest,
              tab.databaseName,
            )
        : options?.includeTotal
          ? await tableService.previewTablePage(...pageRequest, undefined, true)
          : await tableService.previewTablePage(...pageRequest);

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isExecuting: false,
                results: [pageResult.result],
                tablePage: pageResult.page,
                tablePageSize: pageResult.pageSize,
                tableTotalRows: options?.includeTotal
                  ? (pageResult.totalRows ?? null)
                  : totalScopeChanged
                    ? null
                    : (t.tableTotalRows ?? null),
                tableFilterSql: nextFilterSql || null,
                tableFilters: nextFilters || null,
                pendingEdits: new Map(),
                newRowsCount: 0,
                newRowPlacements: [],
                ...(hasSortOverride
                  ? {
                      gridState: {
                        ...(t.gridState || {
                          columnFilters: {},
                          sortColumn: null,
                          sortDirection: null,
                        }),
                        sortColumn: options?.sortOverride?.column || null,
                        sortDirection: options?.sortOverride?.direction || null,
                      },
                    }
                  : {}),
              }
            : t,
        ),
      }));
      taskStore.finishTask(
        taskId,
        `${pageResult.result.rows.length.toLocaleString()} row${
          pageResult.result.rows.length === 1 ? "" : "s"
        }`,
      );
      return true;
    } catch (e: any) {
      taskStore.failTask(taskId, e.message || String(e));
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, isExecuting: false, error: e.message || String(e) }
            : t,
        ),
      }));
      return false;
    }
  },
});
