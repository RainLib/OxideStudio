import {
  errorMessage,
  missingMutationKeyMessage,
  mutationKeyColumns,
  mutationPreservedDraftsMessage,
  mutationRefreshError,
  newRowPlacementsAfterRowDeletion,
  pendingEditsAfterRowDeletion,
  rowMutationKey,
} from "@/features/workspace-tabs/model/rowMutation";
import { hasPendingTableChanges } from "@/features/workspace-tabs/model/tabLifecycle";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { tableService } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import type { TabSlice } from "../types";

/** Owns the durable row-deletion lifecycle for an editable table tab. */
export const createDeleteRowsAction: TabSlice<"deleteRows"> = (set, get) => ({
  deleteRows: async (tabId, rowIndexes) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (
      !tab ||
      tab.type !== "table" ||
      tab.isExecuting ||
      rowIndexes.length === 0
    ) {
      return;
    }

    const schema = tab.schemaName;
    const table = tab.tableName;
    const result = tab.results?.[0];
    if (!schema || !table || !result || result.columns.length === 0) return;

    if (!tab.tableColumns || !tab.tableIndexes) {
      await state.fetchTableColumns(tabId);
    }

    const currentTab = get().tabs.find((t) => t.id === tabId);
    if (!currentTab || currentTab.isExecuting) return;

    const keyColumns = mutationKeyColumns(
      currentTab.tableColumns,
      currentTab.tableIndexes,
      result.columns,
    );
    if (keyColumns.length === 0) {
      const message = missingMutationKeyMessage("delete", table);
      console.warn(message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    const connId =
      currentTab.connectionId ||
      useConnectionStore.getState().activeConnectionId;
    if (!connId) {
      console.error("No connection ID found");
      return;
    }

    const connection = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connId);
    const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
    const uniqueRowIndexes = Array.from(new Set(rowIndexes)).sort(
      (a, b) => a - b,
    );
    const deletes: Array<{ key: Record<string, unknown> }> = [];
    const deletedRowIndexes: number[] = [];

    for (const rowIndex of uniqueRowIndexes) {
      const row = result.rows[rowIndex];
      if (!row) continue;

      const key = rowMutationKey(row, result.columns, keyColumns);

      if (key) {
        deletes.push({ key });
        deletedRowIndexes.push(rowIndex);
      }
    }

    if (deletes.length === 0) {
      const message = "No deleteable rows were generated from the selection.";
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId ? { ...item, isExecuting: true, error: null } : item,
      ),
    }));

    try {
      await tableService.mutateTableRows(
        connId,
        driver,
        schema,
        table,
        [],
        [],
        deletes,
        ...(currentTab.databaseName ? [currentTab.databaseName] : []),
      );
    } catch (e) {
      console.error("Delete rows failed:", e);
      const message = errorMessage(e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isExecuting: false,
                error: `Delete rows failed: ${message}`,
              }
            : t,
        ),
      }));
      return;
    }

    // Remove the successfully deleted rows immediately. If refreshing fails,
    // the same row identities are no longer available for a duplicate delete.
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;

        const nextResults = t.results?.map((queryResult, resultIndex) =>
          resultIndex === 0
            ? {
                ...queryResult,
                rows: queryResult.rows.filter(
                  (_row, rowIndex) => !deletedRowIndexes.includes(rowIndex),
                ),
              }
            : queryResult,
        );
        return {
          ...t,
          results: nextResults ?? t.results,
          pendingEdits: pendingEditsAfterRowDeletion(
            t.pendingEdits,
            deletedRowIndexes,
          ),
          newRowPlacements: newRowPlacementsAfterRowDeletion(
            t.newRowPlacements,
            deletedRowIndexes,
          ),
          tableTotalRows:
            typeof t.tableTotalRows === "number"
              ? Math.max(0, t.tableTotalRows - deletes.length)
              : t.tableTotalRows,
          isExecuting: false,
          error: null,
        };
      }),
    }));

    const tabAfterDelete = get().tabs.find((item) => item.id === tabId);
    if (tabAfterDelete && hasPendingTableChanges(tabAfterDelete)) {
      const message = mutationPreservedDraftsMessage("delete");
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId ? { ...item, error: message } : item,
        ),
      }));
      return;
    }

    let refreshSucceeded = false;
    let refreshFailure: string | null = null;
    try {
      refreshSucceeded = await state.loadTablePage(
        tabId,
        currentTab.tablePage ?? 0,
        currentTab.tableFilterSql ?? null,
        currentTab.tableFilters ?? null,
        { discardDraftsConfirmed: true },
      );
    } catch (e) {
      refreshFailure = errorMessage(e);
    }

    if (!refreshSucceeded) {
      const refreshedTab = get().tabs.find((item) => item.id === tabId);
      const message = mutationRefreshError(
        "delete",
        refreshFailure || refreshedTab?.error,
      );
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
    }
  },
});
