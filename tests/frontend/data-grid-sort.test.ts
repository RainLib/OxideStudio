import { describe, expect, it } from "vitest";
import {
  compareDataGridValues,
  sortDataGridRowIndexes,
} from "@/features/data-grid";

describe("data grid sort", () => {
  it("sorts numeric values exactly and keeps NULL last in both directions", () => {
    const rows = [
      ["9007199254740993"],
      [null],
      ["-1.2e3"],
      ["9007199254740992"],
      ["-1.19e3"],
    ];

    expect(
      sortDataGridRowIndexes({
        rows,
        rowIndexes: rows.map((_, index) => index),
        columnIndex: 0,
        direction: "asc",
        columnType: "DECIMAL(38, 0)",
      }),
    ).toEqual([2, 4, 3, 0, 1]);
    expect(
      sortDataGridRowIndexes({
        rows,
        rowIndexes: rows.map((_, index) => index),
        columnIndex: 0,
        direction: "desc",
        columnType: "DECIMAL(38, 0)",
      }),
    ).toEqual([0, 3, 4, 2, 1]);
  });

  it("uses natural text and chronological date ordering", () => {
    expect(compareDataGridValues("item-2", "item-10", "asc", "varchar")).toBeLessThan(0);
    expect(
      compareDataGridValues("2026-01-01", "2025-12-31", "asc", "date"),
    ).toBeGreaterThan(0);
  });

  it("keeps equal values in stable source-row order after filtering", () => {
    const rows = [["same"], ["other"], ["same"], ["same"]];
    expect(
      sortDataGridRowIndexes({
        rows,
        rowIndexes: [3, 0, 2],
        columnIndex: 0,
        direction: "asc",
        columnType: "text",
      }),
    ).toEqual([0, 2, 3]);
  });
});
