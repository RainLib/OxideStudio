import {
  normalizedDatabaseName,
  tabMatchesDatabase,
} from "@/features/workspace-tabs/model/tabIdentity";
import { TabData } from "@/features/workspace-tabs/model/types";
import type { TableTabReuseMode } from "@/lib/appSettings";
import { v4 as uuidv4 } from "uuid";
import type { TabSlice } from "./types";

export const createCreationSlice: TabSlice<
  | "createTab"
  | "findOrCreateTableTab"
  | "findOrCreateObjectQueryTab"
  | "findOrCreateObjectDataTab"
  | "createTableTab"
  | "openDatabaseBrowser"
  | "openObjectBrowser"
  | "openRocketMqWorkspace"
  | "retargetTableTabs"
  | "updateTabTitle"
> = (set, get) => ({
  createTab: (
    type = "query",
    title = "New Query",
    initialSql = "",
    metadata = {},
  ) => {
    const newTab: TabData = {
      id: uuidv4(),
      title,
      type,
      createdAt: Date.now(),
      sql: initialSql,
      results: null,
      explainPlan: null,
      queryOutputView: "results",
      activeResultIndex: 0,
      isExecuting: false,
      error: null,
      isPinned: false,
      newRowsCount: 0,
      newRowPlacements: [],
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
    objectType?: string | null,
    databaseName?: string,
    options?: { reuseMode?: TableTabReuseMode },
  ) => {
    const { tabs } = get();
    const normalizedDatabase = normalizedDatabaseName(databaseName);
    const reuseMode = options?.reuseMode || "same-table";

    if (reuseMode === "always-new") {
      return get().createTab("table", tableName, "", {
        connectionId,
        databaseName: normalizedDatabase,
        tableName,
        schemaName,
        objectType: objectType || null,
      });
    }

    // Find existing tab with same schema+table
    const existingTab = tabs.find(
      (tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        tab.tableName === tableName &&
        tab.schemaName === schemaName &&
        tabMatchesDatabase(tab, normalizedDatabase),
    );

    if (existingTab) {
      // Reuse existing tab
      set((state) => ({
        activeTabId: existingTab.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id && objectType
            ? { ...tab, objectType }
            : tab,
        ),
      }));
      return existingTab.id;
    }

    if (reuseMode === "active-tab") {
      const activeTab = tabs.find((tab) => tab.id === get().activeTabId);
      if (
        activeTab?.type === "table" &&
        activeTab.connectionId === connectionId &&
        tabMatchesDatabase(activeTab, normalizedDatabase) &&
        !activeTab.isExecuting &&
        (activeTab.pendingEdits?.size ?? 0) === 0
      ) {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === activeTab.id
              ? {
                  ...tab,
                  title: tableName,
                  tableName,
                  schemaName,
                  objectType: objectType || null,
                  results: null,
                  error: null,
                  queryError: null,
                  tablePage: 0,
                  tableTotalRows: null,
                  tableFilterSql: null,
                  tableFilters: null,
                  visualFilters: undefined,
                  sqlFilter: undefined,
                  tableColumns: undefined,
                  tableIndexes: undefined,
                  tableConstraints: undefined,
                }
              : tab,
          ),
        }));
        return activeTab.id;
      }
    }

    // Include the remote database in the title so same-named tables remain
    // distinguishable when several PostgreSQL databases are open at once.
    const title = normalizedDatabase
      ? `${tableName} · ${normalizedDatabase}`
      : tableName;

    // Create new tab if no match found
    return get().createTab("table", title, "", {
      connectionId,
      databaseName: normalizedDatabase,
      tableName,
      schemaName,
      objectType: objectType || null,
    });
  },

  findOrCreateObjectQueryTab: (
    connectionId: string,
    schemaName: string | null | undefined,
    objectName: string,
    objectType: string | null | undefined,
    initialSql: string,
    title = objectName,
  ) => {
    const normalizedSchema = schemaName || "";
    const normalizedObjectType = objectType || null;
    const existingTab = get().tabs.find(
      (tab) =>
        tab.type === "query" &&
        tab.connectionId === connectionId &&
        (tab.schemaName || "") === normalizedSchema &&
        tab.tableName === objectName,
    );

    if (existingTab) {
      set((state) => ({
        activeTabId: existingTab.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id
            ? {
                ...tab,
                title,
                sql: initialSql,
                schemaName: normalizedSchema,
                objectType: normalizedObjectType,
              }
            : tab,
        ),
      }));
      return existingTab.id;
    }

    return get().createTab("query", title, initialSql, {
      connectionId,
      schemaName: normalizedSchema,
      tableName: objectName,
      objectType: normalizedObjectType,
    });
  },

  findOrCreateObjectDataTab: (
    connectionId: string,
    schemaName: string | null | undefined,
    objectName: string,
    objectType: string | null | undefined,
    previewCommand: string,
    title = objectName,
  ) => {
    const normalizedSchema = schemaName || "";
    const normalizedObjectType = objectType || null;
    const existingTab = get().tabs.find(
      (tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        (tab.schemaName || "") === normalizedSchema &&
        tab.tableName === objectName,
    );

    if (existingTab) {
      set((state) => ({
        activeTabId: existingTab.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id
            ? {
                ...tab,
                title,
                sql: previewCommand,
                schemaName: normalizedSchema,
                objectType: normalizedObjectType,
              }
            : tab,
        ),
      }));
      return existingTab.id;
    }

    return get().createTab("table", title, previewCommand, {
      connectionId,
      schemaName: normalizedSchema,
      tableName: objectName,
      objectType: normalizedObjectType,
    });
  },

  createTableTab: (connectionId: string, schemaName: string) => {
    const newTab: TabData = {
      id: uuidv4(),
      title: "New Table",
      type: "create_table",
      createdAt: Date.now(),
      sql: "",
      connectionId,
      schemaName,
      tableName: undefined,
      results: null,
      activeResultIndex: 0,
      isExecuting: false,
      error: null,
      isPinned: false,
      newRowsCount: 0,
      newRowPlacements: [],
      targetSchema: schemaName,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
    return newTab.id;
  },

  openDatabaseBrowser: (connectionId, connectionName) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.type === "database_browser" && tab.connectionId === connectionId,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    return get().createTab(
      "database_browser",
      `${connectionName} databases`,
      "",
      { connectionId },
    );
  },

  openObjectBrowser: (
    connectionId,
    connectionName,
    databaseName,
    schemaName,
  ) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.type === "object_browser" &&
        tab.connectionId === connectionId &&
        tab.databaseName === databaseName &&
        tab.schemaName === schemaName,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const scopeName = schemaName || databaseName || connectionName;
    return get().createTab("object_browser", scopeName, "", {
      connectionId,
      databaseName,
      schemaName,
    });
  },

  openRocketMqWorkspace: (connectionId, connectionName) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.type === "rocketmq_workspace" && tab.connectionId === connectionId,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    return get().createTab(
      "rocketmq_workspace",
      `${connectionName} RocketMQ`,
      "",
      { connectionId },
    );
  },

  retargetTableTabs: (
    connectionId: string,
    schemaName: string,
    oldTableName: string,
    newTableName: string,
    objectType?: string | null,
    databaseName?: string,
  ) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.type === "table" &&
        tab.connectionId === connectionId &&
        tab.schemaName === schemaName &&
        tab.tableName === oldTableName &&
        tabMatchesDatabase(tab, databaseName)
          ? {
              ...tab,
              title: newTableName,
              tableName: newTableName,
              objectType: objectType ?? tab.objectType ?? null,
              results: null,
              activeResultIndex: 0,
              error: null,
              pendingEdits: new Map(),
              newRowsCount: 0,
              newRowPlacements: [],
              tablePage: 0,
              tableTotalRows: null,
            }
          : tab,
      ),
    }));
  },

  updateTabTitle: (id: string, title: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },
});
