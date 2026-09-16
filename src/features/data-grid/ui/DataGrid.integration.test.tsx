/** @vitest-environment happy-dom */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompactSelection,
  GridCellKind,
  type DataEditorProps,
} from "@glideapps/glide-data-grid";
import { DataGrid, type DataGridHandle } from "@/components/workspace/DataGrid";
import { useTabStore, type TabData } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import type { ColumnInfo } from "@/services/tauri/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const captured = vi.hoisted(() => ({ grid: null as DataEditorProps | null }));
vi.mock("@glideapps/glide-data-grid", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@glideapps/glide-data-grid")>();
  const React = await import("react");
  return {
    ...actual,
    DataEditor: React.forwardRef((props: DataEditorProps, ref) => {
      captured.grid = props;
      React.useImperativeHandle(ref, () => ({
        focus: vi.fn(),
        scrollTo: vi.fn(),
        remeasureColumns: vi.fn(),
      }));
      return <div data-testid="canvas-boundary" />;
    }),
  };
});
vi.mock("@/theme/useTheme", () => ({ useTheme: () => ({ mode: "dark" }) }));
vi.mock("@/components/workspace/ValueEditorDialog", () => ({
  ValueEditorDialog: () => null,
}));
const initialTabs = useTabStore.getState();
const initialConnections = useConnectionStore.getState();
function metadata(name: string, generated = false): ColumnInfo {
  return {
    name,
    data_type: "text",
    is_nullable: true,
    is_primary_key: false,
    is_unique: false,
    is_indexed: false,
    is_generated: generated,
    is_hidden: false,
    default_value: undefined,
    is_auto_increment: false,
    comment: undefined,
  };
}
function tab(overrides: Partial<TabData> = {}): TabData {
  return {
    id: "grid-tab",
    title: "Grid",
    type: "query",
    sql: "",
    results: [
      {
        columns: [
          { name: "id", data_type: "int4" },
          { name: "name", data_type: "text" },
        ],
        rows: [
          [2, "second"],
          [1, "first"],
        ],
      },
    ],
    isExecuting: false,
    error: null,
    isPinned: false,
    ...overrides,
  };
}

describe("DataGrid module composition", () => {
  let container: HTMLDivElement;
  let root: Root;
  const handle = createRef<DataGridHandle>();
  beforeEach(() => {
    captured.grid = null;
    localStorage.clear();
    useTabStore.setState(initialTabs, true);
    useConnectionStore.setState(
      { ...initialConnections, connections: [] },
      true,
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useTabStore.setState(initialTabs, true);
    useConnectionStore.setState(initialConnections, true);
  });
  async function render(value: TabData, globalFilter = "") {
    useTabStore.setState({ activeTabId: value.id, tabs: [value] });
    await act(async () =>
      root.render(<DataGrid ref={handle} globalFilter={globalFilter} />),
    );
    expect(captured.grid).not.toBeNull();
  }

  it("keeps query selection in source row coordinates after sorting", async () => {
    await render(
      tab({
        gridState: {
          sortColumn: "id",
          sortDirection: "asc",
          columnFilters: {},
        },
      }),
    );
    expect(captured.grid!.getCellContent([0, 0])).toMatchObject({ data: "1" });
    await act(async () =>
      captured.grid!.onGridSelectionChange!({
        columns: CompactSelection.empty(),
        rows: CompactSelection.fromSingleSelection(0),
      }),
    );
    expect(handle.current!.getSelectedRowIndexes()).toEqual([1]);
  });

  it("stages edits against the original column and filtered source row", async () => {
    await render(
      tab({
        type: "table",
        tableColumns: [metadata("id"), metadata("name")],
        columnOrder: ["name", "id"],
      }),
      "first",
    );
    expect(captured.grid!.columns[0]?.id).toBe("name");
    expect(captured.grid!.rows).toBe(1);
    await act(async () =>
      captured.grid!.onCellEdited!([0, 0], {
        kind: GridCellKind.Text,
        data: "updated",
        displayData: "updated",
        allowOverlay: true,
      }),
    );
    expect(useTabStore.getState().tabs[0]?.pendingEdits?.get("1:1")).toBe(
      "updated",
    );
    expect(useTabStore.getState().tabs[0]?.pendingEdits?.has("0:0")).toBe(
      false,
    );
  });

  it("keeps generated columns read-only across the editing boundary", async () => {
    await render(
      tab({
        type: "table",
        tableColumns: [metadata("id"), metadata("name", true)],
      }),
    );
    expect(captured.grid!.getCellContent([1, 0])).toMatchObject({
      readonly: true,
    });
    await act(async () =>
      captured.grid!.onCellEdited!([1, 0], {
        kind: GridCellKind.Text,
        data: "blocked",
        displayData: "blocked",
        allowOverlay: true,
      }),
    );
    expect(useTabStore.getState().tabs[0]?.pendingEdits?.size || 0).toBe(0);
  });

  it("clears selection on a tab change while column lookup is open", async () => {
    await render(tab());
    await act(async () => {
      captured.grid!.onGridSelectionChange!({
        columns: CompactSelection.empty(),
        rows: CompactSelection.fromSingleSelection(0),
      });
      expect(handle.current!.openColumnLookup()).toBe(true);
    });
    expect(
      container.querySelector('[aria-label="Go to column"]'),
    ).not.toBeNull();
    await act(async () =>
      useTabStore.setState({
        activeTabId: "other",
        tabs: [tab({ id: "other" })],
      }),
    );
    expect(handle.current!.getSelectedRowIndexes()).toEqual([]);
  });
});
