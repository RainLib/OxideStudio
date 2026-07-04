import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { queryService, QueryResult, tableService } from "@/services/tauri";
import { schemaService } from "@/services/tauri/schema.service";
import type { ColumnInfo, TableFilter, TableSort } from "@/services/tauri/types";
import { useHistoryStore } from "./useHistoryStore";
import { useConnectionStore } from "./useConnectionStore";
import { useSchemaStore } from "./useSchemaStore";
import type { FilterOperator } from "@/components/workspace/GridFilterRow";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import {
  extractSchemaContextChange,
  queryMayChangeMetadata,
} from "@/lib/sqlAnalysis";

async function refreshMetadataAfterQuery(
  connectionId: string,
  schemaContext: string | undefined,
  sql: string,
  results: QueryResult[] | null | undefined
) {
  const schemaStore = useSchemaStore.getState();
  const selectedSchema = extractSchemaContextChange(sql);

  if (selectedSchema) {
    await schemaStore.setCurrentSchema(selectedSchema);
    await Promise.all([
      schemaStore.loadTables(connectionId, selectedSchema, true),
      schemaStore.loadFunctions(connectionId, selectedSchema, true),
    ]);
    schemaStore.bumpMetadataVersion();
    return;
  }

  if (!queryMayChangeMetadata(sql, results)) return;

  await schemaStore.loadSchemas(connectionId, true);
  const schemaToRefresh =
    useSchemaStore.getState().currentSchema || schemaContext || undefined;
  if (schemaToRefresh) {
    await Promise.all([
      schemaStore.loadTables(connectionId, schemaToRefresh, true),
      schemaStore.loadFunctions(connectionId, schemaToRefresh, true),
    ]);
  }
  schemaStore.bumpMetadataVersion();
}

export type TabType = "query" | "table" | "create_table";

export interface TabData {
  id: string;
  title: string;
  type: TabType;
  sql: string;
  connectionId?: string;
  tableName?: string;
  schemaName?: string;
  objectType?: string | null;
  filters?: any[];
  results: QueryResult[] | null;
  isExecuting: boolean;
  runningQueryId?: string | null;
  error: string | null;
  isPinned: boolean;
  gridState?: {
    columnFilters: Record<string, { operator: string; value: string }>;
    sortColumn: string | null;
    sortDirection: "asc" | "desc" | null;
  };
  pendingEdits?: Map<string, any>; // key: "rowIndex:colIndex" or "new-N:colIndex", value: new value
  newRowsCount?: number;
  // Filter UI state (per-tab)
  filterMode?: "visual" | "sql";
  visualFilters?: Array<{
    column: string;
    operator: FilterOperator;
    value: string;
    logic?: "AND" | "OR";
  }>;
  sqlFilter?: string;
  // Column layout state (per-tab)
  columnWidths?: Record<string, number>;
  columnOrder?: string[];
  // Target schema for query execution
  targetSchema?: string | null;
  tableColumns?: ColumnInfo[];
  isFetchingColumns?: boolean;
  tablePage?: number;
  tablePageSize?: number;
  tableTotalRows?: number | null;
  tableFilterSql?: string | null;
  tableFilters?: TableFilter[] | null;
}

interface TabState {
  tabs: TabData[];
  activeTabId: string | null;
  closedTabsStack: TabData[];

  createTab: (
    type?: TabType,
    title?: string,
    initialSql?: string,
    metadata?: Partial<
      Pick<
        TabData,
        "connectionId" | "tableName" | "schemaName" | "objectType" | "filters"
      >
    >
  ) => string;
  findOrCreateTableTab: (
    connectionId: string,
    schemaName: string,
    tableName: string,
    objectType?: string | null
  ) => string;
  createTableTab: (connectionId: string, schemaName: string) => string;
  updateTabTitle: (id: string, title: string) => void;
  closeTab: (id: string) => void;
  forceCloseTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsToLeft: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  togglePinTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  reopenTab: () => void;
  updateTabSql: (id: string, sql: string) => void;
  runTabQuery: (
    id: string,
    connectionId: string,
    sqlOverride?: string,
    transactionId?: string
  ) => Promise<void>;
  cancelTabQuery: (id: string) => Promise<void>;
  setGridFilter: (
    tabId: string,
    column: string,
    filter: { operator: string; value: string } | undefined
  ) => void;
  setGridSort: (
    tabId: string,
    column: string | null,
    direction: "asc" | "desc" | null
  ) => void;
  setCellEdit: (
    tabId: string,
    rowIndex: number,
    colIndex: number,
    value: any
  ) => void;
  setBulkCellEdit: (
    tabId: string,
    edits: Array<{ rowIndex: number; colIndex: number; value: any }>
  ) => void;
  commitEdits: (tabId: string) => Promise<void>;
  deleteRows: (tabId: string, rowIndexes: number[]) => Promise<void>;
  cancelEdits: (tabId: string) => void;
  // Filter UI methods
  addNewRow: (tabId: string) => void;
  setFilterMode: (tabId: string, mode: "visual" | "sql") => void;
  setVisualFilters: (
    tabId: string,
    filters: Array<{
      column: string;
      operator: FilterOperator;
      value: string;
      logic?: "AND" | "OR";
    }>
  ) => void;
  setSqlFilter: (tabId: string, sqlFilter: string) => void;
  // Column layout methods
  setColumnWidth: (tabId: string, columnId: string, width: number) => void;
  setColumnOrder: (tabId: string, columnOrder: string[]) => void;
  // Schema selection method
  setTargetSchema: (tabId: string, schema: string | null) => void;
  fetchTableColumns: (tabId: string) => Promise<void>;
  loadTablePage: (
    tabId: string,
    page?: number,
    filterSql?: string | null,
    filters?: TableFilter[] | null
  ) => Promise<void>;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  closedTabsStack: [],

  createTab: (
    type = "query",
    title = "New Query",
    initialSql = "",
    metadata = {}
  ) => {
    const newTab: TabData = {
      id: uuidv4(),
      title,
      type,
      sql: initialSql,
      results: null,
      isExecuting: false,
      error: null,
      isPinned: false,
      newRowsCount: 0,
      ...metadata,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
    return newTab.id;
  },

  findOrCreateTableTab: (
    connectionId: string,
    schemaName: string,
    tableName: string,
    objectType?: string | null
  ) => {
    const { tabs } = get();

    // Find existing tab with same schema+table
    const existingTab = tabs.find(
      (tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        tab.tableName === tableName &&
        tab.schemaName === schemaName
    );

    if (existingTab) {
      // Reuse existing tab
      set((state) => ({
        activeTabId: existingTab.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id && objectType
            ? { ...tab, objectType }
            : tab
        ),
      }));
      return existingTab.id;
    }

    // Create new tab if no match found
    return get().createTab("table", tableName, "", {
      connectionId,
      tableName,
      schemaName,
      objectType: objectType || null,
    });
  },

  createTableTab: (connectionId: string, schemaName: string) => {
    const newTab: TabData = {
      id: uuidv4(),
      title: "New Table",
      type: "create_table",
      sql: "",
      connectionId,
      schemaName,
      tableName: undefined,
      results: null,
      isExecuting: false,
      error: null,
      isPinned: false,
      newRowsCount: 0,
      targetSchema: schemaName,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
    return newTab.id;
  },

  updateTabTitle: (id: string, title: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },

  closeTab: (id: string) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      // Don't close pinned tabs with regular close
      if (tab.isPinned) return state;

      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1]!.id
            : null;
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveId,
        closedTabsStack: [tab, ...state.closedTabsStack].slice(0, 20), // Keep last 20
      };
    });
  },

  forceCloseTab: (id: string) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;

      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;

      if (id === state.activeTabId) {
        newActiveId =
          newTabs.length > 0 && newTabs[newTabs.length - 1]
            ? newTabs[newTabs.length - 1]!.id
            : null;
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveId,
        closedTabsStack: [tab, ...state.closedTabsStack].slice(0, 20),
      };
    });
  },

  closeOtherTabs: (id: string) => {
    set((state) => ({
      tabs: state.tabs.filter((t) => t.id === id || t.isPinned),
      activeTabId: id,
    }));
  },

  closeAllTabs: () => {
    set((state) => {
      const pinnedTabs = state.tabs.filter((t) => t.isPinned);
      return {
        tabs: pinnedTabs,
        activeTabId: pinnedTabs.length > 0 ? pinnedTabs[0]!.id : null,
      };
    });
  },

  closeTabsToLeft: (id: string) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;

      const newTabs = [
        ...state.tabs.slice(0, index).filter((t) => t.isPinned),
        ...state.tabs.slice(index),
      ];

      return { tabs: newTabs };
    });
  },

  closeTabsToRight: (id: string) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;

      const newTabs = [
        ...state.tabs.slice(0, index + 1),
        ...state.tabs.slice(index + 1).filter((t) => t.isPinned),
      ];

      return { tabs: newTabs };
    });
  },

  togglePinTab: (id: string) => {
    set((state) => {
      const tabs = state.tabs.map((t) =>
        t.id === id ? { ...t, isPinned: !t.isPinned } : t
      );

      // Sort tabs: pinned first, then unpinned
      const pinnedTabs = tabs.filter((t) => t.isPinned);
      const unpinnedTabs = tabs.filter((t) => !t.isPinned);

      return { tabs: [...pinnedTabs, ...unpinnedTabs] };
    });
  },

  setActiveTab: (id: string) => {
    set({ activeTabId: id });
  },

  reopenTab: () => {
    const { closedTabsStack, tabs } = get();
    if (closedTabsStack.length === 0) return;

    const [tabToReopen, ...newStack] = closedTabsStack;

    // Check if tab already exists (though it shouldn't be in stack if it does)
    if (tabs.find((t) => t.id === tabToReopen!.id)) {
      set({ closedTabsStack: newStack });
      return;
    }

    set({
      tabs: [...tabs, tabToReopen!],
      activeTabId: tabToReopen!.id,
      closedTabsStack: newStack,
    });
  },

  updateTabSql: (id: string, sql: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    }));
  },

  runTabQuery: async (
    id: string,
    connectionId: string,
    sqlOverride?: string,
    transactionId?: string
  ) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;

    const sqlToRun = sqlOverride || tab.sql;
    if (!sqlToRun.trim()) return;
    const queryId = `${id}:${uuidv4()}`;

    // Update state to executing
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              isExecuting: true,
              runningQueryId: queryId,
              error: null,
              results: null,
            }
          : t
      ),
    }));

    try {
      // Determine schema context: use targetSchema (if set) > tab.schemaName (if table type) > globally selected schema
      let schemaContext = tab.targetSchema || tab.schemaName;
      if (!schemaContext) {
        const { currentSchema } = useSchemaStore.getState();
        if (currentSchema) {
          schemaContext = currentSchema;
        }
      }

      console.log(
        "TabStore: Running query with schema context:",
        schemaContext
      );

      const results = await queryService.executeQuery(
        connectionId,
        sqlToRun,
        schemaContext || undefined,
        transactionId,
        queryId
      );

      // Add to history if it's the full tab SQL and successful
      if (!sqlOverride) {
        useHistoryStore.getState().addToHistory(tab.sql);
      }

      console.log("[TabStore] Query successfully finished", results);

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id && t.runningQueryId === queryId
            ? {
                ...t,
                isExecuting: false,
                runningQueryId: null,
                results: results || null,
              }
            : t
        ),
      }));

      if (!transactionId) {
        void refreshMetadataAfterQuery(
          connectionId,
          schemaContext || undefined,
          sqlToRun,
          results
        ).catch((error) => {
          console.warn("[TabStore] Metadata refresh after query failed", error);
        });
      }
    } catch (e: any) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id && t.runningQueryId === queryId
            ? {
                ...t,
                isExecuting: false,
                runningQueryId: null,
                error: e.message || String(e),
              }
            : t
        ),
      }));
    }
  },

  cancelTabQuery: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab?.runningQueryId) return;

    try {
      await queryService.cancelQuery(tab.runningQueryId);
    } catch (e) {
      console.error("Failed to cancel query:", e);
    }
  },

  setGridFilter: (tabId, column, filter) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const gridState = t.gridState || {
          columnFilters: {},
          sortColumn: null,
          sortDirection: null,
        };
        const columnFilters = { ...gridState.columnFilters };
        if (filter) {
          columnFilters[column] = filter;
        } else {
          delete columnFilters[column];
        }
        return { ...t, gridState: { ...gridState, columnFilters } };
      }),
    }));
  },

  setGridSort: (tabId, column, direction) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const gridState = t.gridState || {
          columnFilters: {},
          sortColumn: null,
          sortDirection: null,
        };
        return {
          ...t,
          gridState: {
            ...gridState,
            sortColumn: column,
            sortDirection: direction,
          },
        };
      }),
    }));

    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab?.type === "table") {
      void get().loadTablePage(tabId, 0);
    }
  },

  setCellEdit: (tabId, rowIndex, colIndex, value) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const pendingEdits = new Map(t.pendingEdits || new Map());
        const key = `${rowIndex}:${colIndex}`;
        pendingEdits.set(key, value);
        return { ...t, pendingEdits };
      }),
    }));
  },

  setBulkCellEdit: (tabId, edits) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const pendingEdits = new Map(t.pendingEdits || new Map());

        edits.forEach(({ rowIndex, colIndex, value }) => {
          const key = `${rowIndex}:${colIndex}`;
          pendingEdits.set(key, value);
        });

        return { ...t, pendingEdits };
      }),
    }));
  },

  commitEdits: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || !tab.pendingEdits || tab.pendingEdits.size === 0) return;

    const schema = tab.schemaName;
    const table = tab.tableName;
    if (!schema || !table) return;

    // Use metadata if available, otherwise we can't save safely
    const columnsMetadata = tab.tableColumns;
    if (!columnsMetadata) {
      console.error("Missing column metadata for table:", table);
      // Try to fetch it?
      await state.fetchTableColumns(tabId);
      // Re-get state
      const refreshedTab = get().tabs.find((t) => t.id === tabId);
      if (!refreshedTab?.tableColumns) {
        // Still missing
        console.error("Failed to fetch metadata, cannot save.");
        // Clear edits to avoid stuck state? No, let user retry.
        return;
      }
    }

    // Check PKs (using refreshed state)
    const currentTab = get().tabs.find((t) => t.id === tabId)!;
    const pks = currentTab.tableColumns?.filter((c) => c.is_primary_key) || [];

    const editsByRow = new Map<number, Record<number, any>>();
    for (const [key, value] of currentTab.pendingEdits!.entries()) {
      const [rStr, cStr] = key.split(":");
      const r = parseInt(rStr!);
      const c = parseInt(cStr!);
      if (!editsByRow.has(r)) editsByRow.set(r, {});
      editsByRow.get(r)![c] = value;
    }

    const connId =
      tab.connectionId || useConnectionStore.getState().activeConnectionId;
    const connection = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connId);
    const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
    const resultColumns = currentTab.results?.[0]?.columns || [];
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
    }> = [];

    for (const [rowIndex, rowEdits] of editsByRow.entries()) {
      if (colDefs.length === 0) continue;

      if (rowIndex < 0) {
        const values: Record<string, unknown> = {};

        for (const [cIdx, val] of Object.entries(rowEdits)) {
          const colName = colDefs[parseInt(cIdx)]?.name;
          if (colName) {
            values[colName] = val;
          }
        }

        if (Object.keys(values).length > 0) {
          inserts.push(values);
        }
      } else {
        if (pks.length === 0) {
          console.warn("No Primary Key found for table:", table);
          continue;
        }

        const originalRow = currentTab.results?.[0]?.rows[rowIndex];
        if (!originalRow || resultColumns.length === 0) continue;

        const values: Record<string, unknown> = {};
        for (const [cIdx, val] of Object.entries(rowEdits)) {
          const colName = colDefs[parseInt(cIdx)]?.name;
          if (colName) {
            values[colName] = val;
          }
        }

        const key: Record<string, unknown> = {};
        for (const pk of pks) {
          const pkIdx = resultColumns.findIndex((c) => c.name === pk.name);
          if (pkIdx !== -1) {
            key[pk.name] = originalRow[pkIdx];
          }
        }

        if (Object.keys(values).length > 0 && Object.keys(key).length === pks.length) {
          updates.push({ key, values });
        }
      }
    }

    if (inserts.length === 0 && updates.length === 0) {
      // Nothing to do or failed to generate
      console.log("No table mutations generated");
      return;
    }

    try {
      if (!connId) {
        console.error("No connection ID found");
        return;
      }

      await tableService.mutateTableRows(
        connId,
        driver,
        schema,
        table,
        inserts,
        updates,
        []
      );

      // Success - clear edits and refresh the current table page.
      if (tab.type === "table") {
        await state.loadTablePage(
          tabId,
          tab.tablePage ?? 0,
          tab.tableFilterSql ?? null,
          tab.tableFilters ?? null
        );
      } else {
        await state.runTabQuery(tabId, connId);
      }

      // Clear edits
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, pendingEdits: new Map(), newRowsCount: 0 }
            : t
        ),
      }));
    } catch (e) {
      console.error("Save failed:", e);
      // Don't clear edits on error
    }
  },

  deleteRows: async (tabId, rowIndexes) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.type !== "table" || rowIndexes.length === 0) return;

    const schema = tab.schemaName;
    const table = tab.tableName;
    const result = tab.results?.[0];
    if (!schema || !table || !result || result.columns.length === 0) return;

    if (!tab.tableColumns) {
      await state.fetchTableColumns(tabId);
    }

    const currentTab = get().tabs.find((t) => t.id === tabId);
    if (!currentTab) return;

    const pks = currentTab.tableColumns?.filter((c) => c.is_primary_key) || [];
    if (pks.length === 0) {
      console.warn("No Primary Key found for table:", table);
      return;
    }

    const connId =
      currentTab.connectionId || useConnectionStore.getState().activeConnectionId;
    if (!connId) {
      console.error("No connection ID found");
      return;
    }

    const connection = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connId);
    const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
    const uniqueRowIndexes = Array.from(new Set(rowIndexes)).sort((a, b) => a - b);
    const deletes: Array<{ key: Record<string, unknown> }> = [];

    for (const rowIndex of uniqueRowIndexes) {
      const row = result.rows[rowIndex];
      if (!row) continue;

      const key: Record<string, unknown> = {};
      for (const pk of pks) {
        const pkIdx = result.columns.findIndex((column) => column.name === pk.name);
        if (pkIdx !== -1) {
          key[pk.name] = row[pkIdx];
        }
      }

      if (Object.keys(key).length === pks.length) {
        deletes.push({ key });
      }
    }

    if (deletes.length === 0) return;

    try {
      await tableService.mutateTableRows(
        connId,
        driver,
        schema,
        table,
        [],
        [],
        deletes
      );
      await state.loadTablePage(
        tabId,
        currentTab.tablePage ?? 0,
        currentTab.tableFilterSql ?? null,
        currentTab.tableFilters ?? null
      );
    } catch (e) {
      console.error("Delete rows failed:", e);
    }
  },

  fetchTableColumns: async (tabId) => {
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
        t.id === tabId ? { ...t, isFetchingColumns: true } : t
      ),
    }));

    try {
      const cols = await schemaService.getColumns(
        connId,
        tab.schemaName,
        tab.tableName
      );
      console.log("[fetchTableColumns] Received metadata:", cols);

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, tableColumns: cols, isFetchingColumns: false }
            : t
        ),
      }));
    } catch (e) {
      console.error("Failed to fetch columns:", e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, isFetchingColumns: false } : t
        ),
      }));
    }
  },

  loadTablePage: async (tabId, page, filterSql, filters) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.type !== "table" || !tab.connectionId || !tab.schemaName || !tab.tableName) {
      return;
    }

    const connection = useConnectionStore
      .getState()
      .connections.find((conn) => conn.id === tab.connectionId);
    const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
    const nextPage = Math.max(0, page ?? tab.tablePage ?? 0);
    const pageSize = tab.tablePageSize || 500;
    const nextFilterSql = filterSql === undefined ? tab.tableFilterSql : filterSql;
    const nextFilters = filters === undefined ? tab.tableFilters : filters;
    const tableSort: TableSort | undefined =
      tab.gridState?.sortColumn && tab.gridState?.sortDirection
        ? {
            column: tab.gridState.sortColumn,
            direction: tab.gridState.sortDirection,
          }
        : undefined;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isExecuting: true, error: null } : t
      ),
    }));

    try {
      const pageResult = await tableService.previewTablePage(
        tab.connectionId,
        driver,
        tab.schemaName,
        tab.tableName,
        nextPage,
        pageSize,
        nextFilterSql || undefined,
        nextFilters || undefined,
        tableSort
      );

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isExecuting: false,
                results: [pageResult.result],
                tablePage: pageResult.page,
                tablePageSize: pageResult.pageSize,
                tableTotalRows: pageResult.totalRows ?? null,
                tableFilterSql: nextFilterSql || null,
                tableFilters: nextFilters || null,
              }
            : t
        ),
      }));
    } catch (e: any) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, isExecuting: false, error: e.message || String(e) }
            : t
        ),
      }));
    }
  },

  cancelEdits: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, pendingEdits: new Map(), newRowsCount: 0 } : t
      ),
    }));
  },

  addNewRow: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, newRowsCount: (t.newRowsCount || 0) + 1 } : t
      ),
    }));
  },

  setFilterMode: (tabId, mode) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, filterMode: mode } : t
      ),
    }));
  },

  setVisualFilters: (tabId, filters) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, visualFilters: filters } : t
      ),
    }));
  },

  setSqlFilter: (tabId, sqlFilter) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, sqlFilter } : t)),
    }));
  },

  setColumnWidth: (tabId, columnId, width) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const columnWidths = t.columnWidths || {};
        return {
          ...t,
          columnWidths: {
            ...columnWidths,
            [columnId]: width,
          },
        };
      }),
    }));
  },

  setColumnOrder: (tabId, columnOrder) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, columnOrder } : t)),
    }));
  },

  setTargetSchema: (tabId, schema) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, targetSchema: schema } : t
      ),
    }));
  },
}));
