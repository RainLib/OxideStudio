import { describe, expect, it } from "vitest";
import type { DataGridVisualRow } from "@/lib/dataGridRows";
import {
  DATA_GRID_MAX_EXPANDABLE_PASTE_ROWS,
  planExpandableNewRowPaste,
} from "./newRowPaste";

function draftRows(count: number): DataGridVisualRow[] {
  return Array.from({ length: count }, (_, offset) => ({
    rowKey: -1 - offset,
    isNew: true,
  }));
}

const visibleColumns = [
  { columnIndex: 0, editable: true, dataType: "integer" },
  { columnIndex: 2, editable: true, dataType: "text" },
  { columnIndex: 3, editable: true, dataType: "text" },
];

function rows(count: number, width = 1) {
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: width }, (_, column) => `${row + 1}.${column + 1}`),
  );
}

describe("planExpandableNewRowPaste", () => {
  it("reuses selected blank rows and plans the additional rows", () => {
    const plan = planExpandableNewRowPaste({
      target: [0, 0],
      selection: { x: 0, y: 0, width: 1, height: 5 },
      pastedRows: rows(10),
      visualRows: draftRows(5),
      pendingEdits: new Map(),
      visibleColumns,
    });

    expect(plan?.targetRowKey).toBe(-1);
    expect(plan?.reusableRowKeys).toEqual([-1, -2, -3, -4, -5]);
    expect(plan?.rows).toHaveLength(10);
  });

  it("reuses exactly the pasted row count and leaves extra blanks untouched", () => {
    const plan = planExpandableNewRowPaste({
      target: [0, 0],
      selection: { x: 0, y: 0, width: 1, height: 10 },
      pastedRows: rows(5),
      visualRows: draftRows(10),
      pendingEdits: new Map(),
      visibleColumns,
    });

    expect(plan?.reusableRowKeys).toEqual([-1, -2, -3, -4, -5]);
    expect(plan?.rows).toHaveLength(5);
  });

  it("starts from the selected visible column without shifting hidden columns", () => {
    const plan = planExpandableNewRowPaste({
      target: [1, 0],
      selection: { x: 1, y: 0, width: 1, height: 5 },
      pastedRows: rows(10, 2),
      visualRows: draftRows(5),
      pendingEdits: new Map(),
      visibleColumns,
    });

    expect(plan?.rows[0]).toEqual([
      { columnIndex: 2, value: "1.1", dataType: "text" },
      { columnIndex: 3, value: "1.2", dataType: "text" },
    ]);
  });

  it("prioritizes a single selected draft row and starts from the first visible column", () => {
    const plan = planExpandableNewRowPaste({
      target: [2, 0],
      selectedRows: [0],
      selection: { x: 2, y: 0, width: 1, height: 1 },
      pastedRows: rows(10, 2),
      visualRows: draftRows(5),
      pendingEdits: new Map(),
      visibleColumns,
    });

    expect(plan?.reusableRowKeys).toEqual([-1, -2, -3, -4, -5]);
    expect(plan?.rows[0]?.map((cell) => cell.columnIndex)).toEqual([0, 2]);
  });

  it("keeps a single-row multi-column selection on the ordinary paste path", () => {
    expect(
      planExpandableNewRowPaste({
        target: [0, 0],
        selection: { x: 0, y: 0, width: 2, height: 1 },
        pastedRows: rows(2, 2),
        visualRows: draftRows(1),
        pendingEdits: new Map(),
        visibleColumns,
      }),
    ).toBeNull();
  });

  it("rejects an existing row or any nonblank row in a multi-row selection", () => {
    const shared = {
      target: [0, 0] as const,
      selection: { x: 0, y: 0, width: 1, height: 2 },
      pastedRows: rows(3),
      visibleColumns,
    };
    expect(
      planExpandableNewRowPaste({
        ...shared,
        visualRows: [{ rowKey: 0, isNew: false }, ...draftRows(1)],
        pendingEdits: new Map(),
      }),
    ).toBeNull();
    expect(
      planExpandableNewRowPaste({
        ...shared,
        visualRows: draftRows(2),
        pendingEdits: new Map([["-2:3", "occupied"]]),
      }),
    ).toBeNull();
  });

  it("rejects readonly targets, empty matrices, and oversized pastes", () => {
    const base = {
      target: [0, 0] as const,
      visualRows: draftRows(1),
      pendingEdits: new Map<string, unknown>(),
    };
    expect(
      planExpandableNewRowPaste({
        ...base,
        pastedRows: rows(2),
        visibleColumns: [{ columnIndex: 0, editable: false }],
      }),
    ).toBeNull();
    expect(
      planExpandableNewRowPaste({
        ...base,
        pastedRows: [[""], [" "]],
        visibleColumns,
      }),
    ).toBeNull();
    expect(
      planExpandableNewRowPaste({
        ...base,
        pastedRows: rows(DATA_GRID_MAX_EXPANDABLE_PASTE_ROWS + 1),
        visibleColumns,
      }),
    ).toBeNull();
  });

  it("keeps multi-row and column selections on the ordinary paste path", () => {
    const base = {
      target: [0, 0] as const,
      pastedRows: rows(3),
      visualRows: draftRows(3),
      pendingEdits: new Map<string, unknown>(),
      visibleColumns,
    };
    expect(
      planExpandableNewRowPaste({ ...base, selectedRows: [0, 1] }),
    ).toBeNull();
    expect(
      planExpandableNewRowPaste({ ...base, hasColumnSelection: true }),
    ).toBeNull();
  });
});
