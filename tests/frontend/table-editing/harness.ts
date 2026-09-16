/**
 * @vitest-environment happy-dom
 */
import { beforeEach, vi } from "vitest";
import { useConnectionStore as connectionStore } from "@/store/useConnectionStore";
import { useTabStore as tabStore } from "@/store/useTabStore";
import type { ColumnInfo } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  mutateTableRows: vi.fn(async () => ({
    inserted: 0,
    updated: 0,
    deleted: 0,
    rowsAffected: 0,
  })),
  getColumns: vi.fn(async () => []),
  getIndexes: vi.fn(async () => []),
  previewTablePage: vi.fn(async () => ({
    result: { columns: [], rows: [] },
    page: 0,
    pageSize: 500,
    totalRows: 0,
  })),
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    connect: mocks.connect,
    disconnect: mocks.disconnect,
  },
  databaseService: {
    getDatabaseCapabilities: vi.fn(async () => ({})),
  },
  queryService: {
    executeQuery: vi.fn(async () => []),
  },
  schemaService: {
    getColumns: mocks.getColumns,
    getIndexes: mocks.getIndexes,
  },
  tableService: {
    mutateTableRows: mocks.mutateTableRows,
    previewTablePage: mocks.previewTablePage,
  },
}));

vi.mock("@/services/tauri/schema.service", () => ({
  schemaService: {
    getColumns: mocks.getColumns,
    getIndexes: mocks.getIndexes,
  },
}));

export function column(
  name: string,
  options: { primary?: boolean; unique?: boolean; nullable?: boolean } = {},
): ColumnInfo {
  const primary = options.primary || false;
  return {
    name,
    data_type: "text",
    is_nullable: options.nullable ?? !primary,
    is_primary_key: primary,
    is_unique: primary || Boolean(options.unique),
    is_indexed: primary,
    default_value: null,
    is_auto_increment: false,
    comment: null,
  };
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.disconnect.mockReset().mockResolvedValue(undefined);
  mocks.mutateTableRows.mockReset().mockResolvedValue({
    inserted: 0,
    updated: 0,
    deleted: 0,
    rowsAffected: 0,
  });
  mocks.getColumns.mockReset().mockResolvedValue([]);
  mocks.getIndexes.mockReset().mockResolvedValue([]);
  mocks.previewTablePage.mockReset().mockResolvedValue({
    result: { columns: [], rows: [] },
    page: 0,
    pageSize: 500,
    totalRows: 0,
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );

  connectionStore.setState({
    connections: [
      {
        id: "postgres-1",
        name: "Postgres",
        driver: "postgres",
        url: "postgres://localhost/app",
      },
    ],
    activeConnectionId: "postgres-1",
    connectedConnectionIds: ["postgres-1"],
    isConnected: true,
    isLoading: false,
    selectedConnection: null,
  });

  tabStore.setState({
    activeTabId: "tab-1",
    closedTabsStack: [],
    tabs: [
      {
        id: "tab-1",
        title: "users",
        type: "table",
        sql: "",
        connectionId: "postgres-1",
        schemaName: "public",
        tableName: "users",
        tableColumns: [column("email")],
        results: [
          {
            columns: [{ name: "email", data_type: "text" }],
            rows: [["old@example.test"]],
          },
        ],
        pendingEdits: new Map([["0:0", "new@example.test"]]),
        isExecuting: false,
        error: null,
        isPinned: false,
      },
    ],
  });
});

export const mocksForTests = mocks;
export const useConnectionStore = connectionStore;
export const useTabStore = tabStore;
