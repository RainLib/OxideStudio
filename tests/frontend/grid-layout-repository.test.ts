import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  gridLayoutKey,
  loadGridLayout,
  normalizeGridLayout,
  removeGridLayout,
  saveGridLayout,
} from "@/features/data-grid";
import { useTabStore } from "@/store/useTabStore";

const tableScope = {
  type: "table" as const,
  connectionId: "conn-1",
  databaseName: "app",
  schemaName: "public",
  tableName: "orders",
};

describe("grid layout repository", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it("uses an object key for table layouts and a SQL revision for query layouts", () => {
    expect(gridLayoutKey(tableScope)).toBe("table:conn-1:app:public:orders");
    expect(
      gridLayoutKey({
        type: "query",
        connectionId: "conn-1",
        schemaName: "public",
        queryLanguage: "sql",
        sql: "SELECT id FROM orders",
      }),
    ).toContain("query:conn-1::public:sql:memory:");
    expect(gridLayoutKey({ type: "query", connectionId: "conn-1", sql: "" })).toBeNull();
  });

  it("round-trips only the columns present in the newly opened result", () => {
    saveGridLayout(tableScope, {
      columnWidths: { id: 280, removed: 180 },
      columnOrder: ["removed", "name", "id", "id"],
      hiddenColumns: ["removed", "name"],
      frozenColumnCount: 9,
    });

    expect(loadGridLayout(tableScope, ["id", "name"])).toEqual({
      columnWidths: { id: 280 },
      columnOrder: ["name", "id"],
      hiddenColumns: ["name"],
      frozenColumnCount: 0,
    });
  });

  it("rejects invalid widths and limits frozen columns to visible columns", () => {
    expect(
      normalizeGridLayout(
        { columnWidths: { id: 20, name: 4000, valid: 180 }, frozenColumnCount: 3 },
        ["id", "name", "valid"],
      ),
    ).toEqual({
      columnWidths: { valid: 180 },
      columnOrder: [],
      hiddenColumns: [],
      frozenColumnCount: 2,
    });
  });

  it("removes only the selected object layout", () => {
    saveGridLayout(tableScope, {
      columnWidths: { id: 180 },
      columnOrder: [],
      hiddenColumns: [],
      frozenColumnCount: 0,
    });
    removeGridLayout(tableScope);
    expect(loadGridLayout(tableScope, ["id"])).toBeNull();
  });

  it("persists layout changes made through the tab store", () => {
    useTabStore.setState({
      tabs: [
        {
          id: "orders-tab",
          title: "orders",
          type: "table",
          sql: "",
          connectionId: "conn-1",
          databaseName: "app",
          schemaName: "public",
          tableName: "orders",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
      activeTabId: "orders-tab",
    });

    useTabStore.getState().setColumnWidth("orders-tab", "id", 240);
    useTabStore.getState().setColumnOrder("orders-tab", ["id", "name"]);
    useTabStore.getState().setColumnHidden("orders-tab", "name", true);

    expect(loadGridLayout(tableScope, ["id", "name"])).toEqual({
      columnWidths: { id: 240 },
      columnOrder: ["id", "name"],
      hiddenColumns: ["name"],
      frozenColumnCount: 0,
    });
  });
});
