import { tabMatchesDatabase } from "@/features/workspace-tabs/model/tabIdentity";
import { confirmCurrentTabChanges } from "@/features/workspace-tabs/model/confirmTabAction";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import { useConnectionStore } from "@/store/useConnectionStore";
import type { TabSlice } from "./types";

export const createTableMetadataSlice: TabSlice<
  "setTableMetadata" | "fetchTableColumns" | "refreshTableTabs"
> = (set, get) => ({
  setTableMetadata: (tabId, metadata) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              tableColumns: metadata.columns,
              tableIndexes: metadata.indexes,
              tableConstraints: metadata.constraints,
              tableMetadataSource: metadata.source,
              tableMetadataUpdatedAt: metadata.updatedAt,
              isFetchingColumns: false,
            }
          : tab,
      ),
    }));
  },

  fetchTableColumns: async (tabId, force = false) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    console.log("[fetchTableColumns]", {
      tabId,
      table: tab?.tableName,
      schema: tab?.schemaName,
      isFetching: tab?.isFetchingColumns,
    });

    if (!tab || !tab.tableName || !tab.schemaName) return;
    if (tab.isFetchingColumns) return;

    const connId =
      tab.connectionId || useConnectionStore.getState().activeConnectionId;

    if (!connId) {
      console.warn("[fetchTableColumns] No connection ID found.");
      return;
    }

    // Set fetching flag immediately
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isFetchingColumns: true } : t,
      ),
    }));

    try {
      const connection = useConnectionStore
        .getState()
        .connections.find((item) => item.id === connId);
      const metadata = await loadTableMetadata({
        connectionId: connId,
        driver: connection?.driver || DEFAULT_DATABASE_DRIVER,
        databaseName: tab.databaseName,
        schema: tab.schemaName,
        table: tab.tableName,
        includeIndexes: true,
        includeConstraints: false,
        force,
      });
      console.log(
        `[fetchTableColumns] Loaded metadata from ${metadata.source}:`,
        metadata.columns,
        metadata.indexes,
      );

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                tableColumns: metadata.columns,
                tableIndexes: metadata.indexes,
                tableConstraints: metadata.constraints,
                tableMetadataSource: metadata.source,
                tableMetadataUpdatedAt: metadata.updatedAt,
                isFetchingColumns: false,
              }
            : t,
        ),
      }));
    } catch (e) {
      console.error("Failed to fetch columns:", e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, isFetchingColumns: false } : t,
        ),
      }));
    }
  },

  refreshTableTabs: async (
    connectionId,
    schemaName,
    tableName,
    refreshMetadata = true,
    databaseName,
  ) => {
    const matchingTableTabs = get().tabs.filter(
      (tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        tab.schemaName === schemaName &&
        tab.tableName === tableName &&
        tabMatchesDatabase(tab, databaseName),
    );
    const matchingTabs = matchingTableTabs.map((tab) => ({
      id: tab.id,
      page: tab.tablePage ?? 0,
      filterSql: tab.tableFilterSql ?? null,
      filters: tab.tableFilters ?? null,
    }));

    if (matchingTabs.length === 0) return;
    if (
      !(await confirmCurrentTabChanges(
        () => get().tabs.filter((candidate) => matchingTableTabs.some((tab) => tab.id === candidate.id)),
        `refresh ${schemaName}.${tableName}`,
      ))
    ) {
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((tab) =>
        matchingTabs.some((match) => match.id === tab.id)
          ? {
              ...tab,
              ...(refreshMetadata
                ? {
                    tableColumns: undefined,
                    tableIndexes: undefined,
                    tableConstraints: undefined,
                    tableMetadataSource: undefined,
                    tableMetadataUpdatedAt: undefined,
                  }
                : {}),
              isFetchingColumns: false,
              isExecuting: true,
              error: null,
            }
          : tab,
      ),
    }));

    await Promise.all(
      matchingTabs.map(async (tab) => {
        if (refreshMetadata) {
          await get().fetchTableColumns(tab.id, true);
        }
        await get().loadTablePage(
          tab.id,
          tab.page,
          tab.filterSql,
          tab.filters,
          {
            discardDraftsConfirmed: true,
          },
        );
      }),
    );
  },
});
