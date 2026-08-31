import { describe, expect, it } from "vitest";
import { buildDataGridVisualRows } from "./dataGridRows";

describe("buildDataGridVisualRows", () => {
  it("keeps cloned rows directly below their source", () => {
    expect(
      buildDataGridVisualRows([0, 1, 2], 2, [
        { anchorRowKey: 1, position: "below" },
        { anchorRowKey: 0, position: "below" },
      ]).map((row) => row.rowKey),
    ).toEqual([0, -2, 1, -1, 2]);
  });

  it("keeps pending clones below pending sources", () => {
    expect(
      buildDataGridVisualRows([0], 3, [
        null,
        { anchorRowKey: -1, position: "below" },
        { anchorRowKey: -2, position: "below" },
      ]).map((row) => row.rowKey),
    ).toEqual([0, -1, -2, -3]);
  });

  it("appends unanchored rows and clones whose source is filtered out", () => {
    expect(
      buildDataGridVisualRows([1], 2, [
        { anchorRowKey: 0, position: "below" },
        null,
      ]).map((row) => row.rowKey),
    ).toEqual([1, -1, -2]);
  });

  it("projects large source pages without changing their order", () => {
    const sourceRows = Array.from({ length: 50_000 }, (_, index) => index);
    const rows = buildDataGridVisualRows(sourceRows, 1, [
      { anchorRowKey: 25_000, position: "below" },
    ]);
    expect(rows).toHaveLength(50_001);
    expect(rows[25_000]?.rowKey).toBe(25_000);
    expect(rows[25_001]?.rowKey).toBe(-1);
    expect(rows[rows.length - 1]?.rowKey).toBe(49_999);
  });
});
