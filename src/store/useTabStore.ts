import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { queryService, QueryResult } from "@/services/tauri";
import { schemaService } from "@/services/tauri/schema.service";
import type { ColumnInfo } from "@/services/tauri/types";
import { useHistoryStore } from "./useHistoryStore";
import { useConnectionStore } from "./useConnectionStore";
import { useSchemaStore } from "./useSchemaStore";
import type { FilterOperator } from "@/components/workspace/GridFilterRow";

function formatSqlValue(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return val.toString();
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  // Escape single quotes for SQL string
  return `'${String(val).replace(/'/g, "''")}'`;
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
  filters?: any[];
  results: QueryResult[] | null;
  isExecuting: boolean;
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
}

interface TabState {
  tabs: TabData[];
  activeTabId: string | null;
  closedTabsStack: TabData[];

  createTab: (
    type?: TabType,
    title?: string,
    initialSql?: string,
    metadata?: Partial<Pick<TabData, "tableName" | "schemaName" | "filters">>
  ) => string;
  findOrCreateTableTab: (
    connectionId: string,
    schemaName: string,
    tableName: string
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
    sqlOverride?: string
  ) => Promise<void>;
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
    _connectionId: string, // Reserved for future use
    schemaName: string,
    tableName: string
  ) => {
    const { tabs } = get();

    // Find existing tab with same schema+table
    const existingTab = tabs.find(
      (tab) =>
        tab.type === "table" &&
        tab.tableName === tableName &&
        tab.schemaName === schemaName
      // Note: We don't store connectionId in tab, but in practice
      // if schema+table match, it's likely the same tab
      // You could add connectionId to TabData if needed
    );

    if (existingTab) {
      // Reuse existing tab
      set({ activeTabId: existingTab.id });
      return existingTab.id;
    }

    // Create new tab if no match found
    return get().createTab("table", tableName, "", {
      tableName,
      schemaName,
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
    sqlOverride?: string
  ) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;

    const sqlToRun = sqlOverride || tab.sql;
    if (!sqlToRun.trim()) return;

    // Update state to executing
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, isExecuting: true, error: null, results: null }
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
        schemaContext || undefined
      );

      // Add to history if it's the full tab SQL and successful
      if (!sqlOverride) {
        useHistoryStore.getState().addToHistory(tab.sql);
      }

      console.log("[TabStore] Query successfully finished", results);

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? { ...t, isExecuting: false, results: results || null }
            : t
        ),
      }));
    } catch (e: any) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? { ...t, isExecuting: false, error: e.message || String(e) }
            : t
        ),
      }));
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

    const schema = tab.schemaName || "public";
    const table = tab.tableName;
    if (!table) return;

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

    if (pks.length === 0) {
      console.warn("No Primary Key found for table:", table);
      // We could allow INSERTs but UPDATEs are risky.
      // For now, proceed but UPDATEs might fail or require full row match (not implemented).
      // Let's block UPDATEs if no PK.
    }

    const editsByRow = new Map<number, Record<number, any>>();
    for (const [key, value] of currentTab.pendingEdits!.entries()) {
      const [rStr, cStr] = key.split(":");
      const r = parseInt(rStr);
      const c = parseInt(cStr);
      if (!editsByRow.has(r)) editsByRow.set(r, {});
      editsByRow.get(r)![c] = value;
    }

    const sqlStatements: string[] = [];

    for (const [rowIndex, rowEdits] of editsByRow.entries()) {
      const colDefs = currentTab.results?.[0]?.columns;
      if (!colDefs) continue;

      if (rowIndex < 0) {
        // INSERT
        const cols: string[] = [];
        const vals: string[] = [];

        for (const [cIdx, val] of Object.entries(rowEdits)) {
          const colName = colDefs[parseInt(cIdx)]?.name;
          if (colName) {
            cols.push(`"${colName}"`);
            vals.push(formatSqlValue(val));
          }
        }

        if (cols.length > 0) {
          sqlStatements.push(
            `INSERT INTO "${schema}"."${table}" (${cols.join(
              ", "
            )}) VALUES (${vals.join(", ")});`
          );
        }
      } else {
        // UPDATE
        if (pks.length === 0) continue; // Skip updates if no PK

        const originalRow = currentTab.results?.[0]?.rows[rowIndex];
        if (!originalRow) continue;

        const updates: string[] = [];
        for (const [cIdx, val] of Object.entries(rowEdits)) {
          const colName = colDefs[parseInt(cIdx)]?.name;
          if (colName) {
            updates.push(`"${colName}" = ${formatSqlValue(val)}`);
          }
        }

        // Build WHERE clause
        const whereParts: string[] = [];
        for (const pk of pks) {
          const pkIdx = colDefs.findIndex((c) => c.name === pk.name);
          if (pkIdx !== -1) {
            const pkVal = originalRow[pkIdx];
            whereParts.push(`"${pk.name}" = ${formatSqlValue(pkVal)}`);
          }
        }

        if (updates.length > 0 && whereParts.length > 0) {
          sqlStatements.push(
            `UPDATE "${schema}"."${table}" SET ${updates.join(
              ", "
            )} WHERE ${whereParts.join(" AND ")};`
          );
        }
      }
    }

    if (sqlStatements.length === 0) {
      // Nothing to do or failed to generate
      console.log("No statements generated");
      return;
    }

    console.log("Executing Save SQL:", sqlStatements);

    // Execute
    try {
      // Get connection ID. currently not stored in tab explicitly for tables,
      // but `results` usually comes from a connection.
      // We stored `connectionId` in `createTableTab`!
      const connId =
        currentTab.connectionId ||
        useConnectionStore.getState().activeConnectionId;

      if (!connId) {
        console.error("No connection ID found");
        return;
      }

      await queryService.executeQuery(connId, sqlStatements.join("\n"));

      // Success - clear edits and refresh data (re-run implicit query)
      // We'll just runTabQuery with empty override to re-fetch
      await state.runTabQuery(tabId, connId);

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

  fetchTableColumns: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.tableName || !tab.schemaName) return;

    const connId =
      tab.connectionId || useConnectionStore.getState().activeConnectionId;
    if (!connId) return;

    try {
      const cols = await schemaService.getColumns(
        connId,
        tab.schemaName,
        tab.tableName
      );
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tableColumns: cols } : t
        ),
      }));
    } catch (e) {
      console.error("Failed to fetch columns:", e);
    }
  },

  cancelEdits: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, pendingEdits: new Map() } : t
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
