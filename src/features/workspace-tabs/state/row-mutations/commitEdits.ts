import {
  errorMessage,
  missingMutationKeyMessage,
  mutationKeyColumns,
  mutationPreservedDraftsMessage,
  mutationRefreshError,
  resultsAfterSubmittedEdits,
  rowMutationKey,
  tableDraftsAfterSuccessfulSave,
} from "@/features/workspace-tabs/model/rowMutation";
import { hasPendingTableChanges } from "@/features/workspace-tabs/model/tabLifecycle";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { isTableCellExpression } from "@/lib/tableCellExpression";
import { tableService } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import type { TabSlice } from "../types";

/** Owns the durable insert/update mutation lifecycle for an editable table tab. */
export const createCommitEditsAction: TabSlice<"commitEdits"> = (set, get) => ({
  commitEdits: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (
      !tab ||
      tab.isExecuting ||
      ((!tab.pendingEdits || tab.pendingEdits.size === 0) &&
        (tab.newRowsCount || 0) === 0)
    ) {
      return;
    }

    const schema = tab.schemaName;
    const table = tab.tableName;
    if (!schema || !table) return;

    // Use metadata if available, otherwise we can't save safely
    const columnsMetadata = tab.tableColumns;
    const indexesMetadata = tab.tableIndexes;
    if (!columnsMetadata || !indexesMetadata) {
      console.error("Missing table metadata for table:", table);
      // Try to fetch it?
      await state.fetchTableColumns(tabId);
      // Re-get state
      const refreshedTab = get().tabs.find((t) => t.id === tabId);
      if (!refreshedTab?.tableColumns) {
        // Still missing
        console.error("Failed to fetch metadata, cannot save.");
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  error:
                    "Cannot save edits because column metadata is unavailable.",
                }
              : t,
          ),
        }));
        // Clear edits to avoid stuck state? No, let user retry.
        return;
      }
    }

    // Check row identity columns (using refreshed state)
    const currentTab = get().tabs.find((t) => t.id === tabId);
    if (
      !currentTab ||
      currentTab.isExecuting ||
      ((!currentTab.pendingEdits || currentTab.pendingEdits.size === 0) &&
        (currentTab.newRowsCount || 0) === 0)
    ) {
      return;
    }
    const resultColumns = currentTab.results?.[0]?.columns || [];
    const keyColumns = mutationKeyColumns(
      currentTab.tableColumns,
      currentTab.tableIndexes,
      resultColumns,
    );

    const editsByRow = new Map<number, Record<number, any>>();
    for (const [key, value] of currentTab.pendingEdits || []) {
      const [rStr, cStr] = key.split(":");
      const r = parseInt(rStr!);
      const c = parseInt(cStr!);
      if (!editsByRow.has(r)) editsByRow.set(r, {});
      editsByRow.get(r)![c] = value;
    }
    for (let offset = 0; offset < (currentTab.newRowsCount || 0); offset += 1) {
      const rowIndex = -1 - offset;
      if (!editsByRow.has(rowIndex)) editsByRow.set(rowIndex, {});
    }

    const hasExistingRowEdits = Array.from(editsByRow.keys()).some(
      (rowIndex) => rowIndex >= 0,
    );
    if (hasExistingRowEdits && keyColumns.length === 0) {
      const message = missingMutationKeyMessage("update", table);
      console.warn(message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    const connId =
      tab.connectionId || useConnectionStore.getState().activeConnectionId;
    const connection = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connId);
    const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
    const metadataColumns =
      currentTab.tableColumns?.map((column) => ({
        name: column.name,
        data_type: column.data_type,
      })) || [];
    const colDefs = resultColumns.length > 0 ? resultColumns : metadataColumns;
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{
      key: Record<string, unknown>;
      values: Record<string, unknown>;
      expressions?: Record<string, string>;
    }> = [];
    const submittedEdits = new Map<string, any>();
    const insertedRowIndexes = new Set<number>();

    for (const [rowIndex, rowEdits] of editsByRow.entries()) {
      if (rowIndex < 0) {
        const values: Record<string, unknown> = {};
        const saveableEdits: Array<[string, any]> = [];

        for (const [cIdx, val] of Object.entries(rowEdits)) {
          const colName = colDefs[parseInt(cIdx)]?.name;
          if (colName) {
            if (isTableCellExpression(val)) {
              const message =
                "SQL expressions can only be staged for an existing table row.";
              set((state) => ({
                tabs: state.tabs.map((t) =>
                  t.id === tabId ? { ...t, error: message } : t,
                ),
              }));
              return;
            }
            values[colName] = val;
            saveableEdits.push([`${rowIndex}:${cIdx}`, val]);
          }
        }

        inserts.push(values);
        insertedRowIndexes.add(rowIndex);
        saveableEdits.forEach(([key, value]) => submittedEdits.set(key, value));
      } else {
        if (colDefs.length === 0) continue;
        if (keyColumns.length === 0) {
          console.warn("No row mutation key found for table:", table);
          continue;
        }

        const originalRow = currentTab.results?.[0]?.rows[rowIndex];
        if (!originalRow || resultColumns.length === 0) continue;

        const values: Record<string, unknown> = {};
        const expressions: Record<string, string> = {};
        const saveableEdits: Array<[string, any]> = [];
        for (const [cIdx, val] of Object.entries(rowEdits)) {
          const colName = colDefs[parseInt(cIdx)]?.name;
          if (colName) {
            if (isTableCellExpression(val)) {
              expressions[colName] = val.expression;
            } else {
              values[colName] = val;
            }
            saveableEdits.push([`${rowIndex}:${cIdx}`, val]);
          }
        }

        const key = rowMutationKey(originalRow, resultColumns, keyColumns);

        if (
          (Object.keys(values).length > 0 ||
            Object.keys(expressions).length > 0) &&
          key
        ) {
          updates.push({
            key,
            values,
            ...(Object.keys(expressions).length > 0 ? { expressions } : {}),
          });
          saveableEdits.forEach(([editKey, value]) =>
            submittedEdits.set(editKey, value),
          );
        }
      }
    }

    if (inserts.length === 0 && updates.length === 0) {
      // Nothing to do or failed to generate
      const message = "No saveable table mutations were generated.";
      console.log(message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, error: message } : t,
        ),
      }));
      return;
    }

    if (!connId) {
      const message = "No connection ID found for table mutation.";
      console.error(message);
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
        inserts,
        updates,
        [],
        ...(currentTab.databaseName ? [currentTab.databaseName] : []),
      );
    } catch (e) {
      console.error("Save failed:", e);
      const message = errorMessage(e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, isExecuting: false, error: `Save failed: ${message}` }
            : t,
        ),
      }));
      return;
    }

    // The mutation is durable at this point. Consume its drafts before the
    // independent, best-effort refresh so retrying cannot submit them again.
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const remainingDrafts = tableDraftsAfterSuccessfulSave(
          t.pendingEdits,
          t.newRowsCount,
          t.newRowPlacements,
          submittedEdits,
          insertedRowIndexes,
        );
        return {
          ...t,
          ...remainingDrafts,
          results: resultsAfterSubmittedEdits(t.results, submittedEdits),
          tableTotalRows:
            typeof t.tableTotalRows === "number"
              ? t.tableTotalRows + insertedRowIndexes.size
              : t.tableTotalRows,
          isExecuting: false,
          error: null,
        };
      }),
    }));

    const tabAfterSave = get().tabs.find((item) => item.id === tabId);
    if (tabAfterSave && hasPendingTableChanges(tabAfterSave)) {
      const message = mutationPreservedDraftsMessage("save");
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
      if (tab.type === "table") {
        refreshSucceeded = await state.loadTablePage(
          tabId,
          tab.tablePage ?? 0,
          tab.tableFilterSql ?? null,
          tab.tableFilters ?? null,
          { discardDraftsConfirmed: true },
        );
      } else {
        await state.runTabQuery(tabId, connId);
        const refreshedTab = get().tabs.find((item) => item.id === tabId);
        refreshSucceeded = !refreshedTab?.error;
      }
    } catch (e) {
      refreshFailure = errorMessage(e);
    }

    if (!refreshSucceeded) {
      const refreshedTab = get().tabs.find((item) => item.id === tabId);
      const message = mutationRefreshError(
        "save",
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
