import { describe, expect, it } from "vitest";
import { filterDataGridColumnLookupItems } from "./columnLookup";

describe("filterDataGridColumnLookupItems", () => {
  const columns = [
    { index: 0, name: "account_id", detail: "BIGINT · primary key" },
    { index: 1, name: "email", detail: "TEXT · customer email" },
    { index: 2, name: "created_at", detail: "TIMESTAMPTZ" },
  ];

  it("matches names, metadata and one-based column ordinals in visual order", () => {
    expect(filterDataGridColumnLookupItems(columns, "email")).toEqual([
      columns[1],
    ]);
    expect(filterDataGridColumnLookupItems(columns, "timestamp")).toEqual([
      columns[2],
    ]);
    expect(filterDataGridColumnLookupItems(columns, "1")).toEqual([
      columns[0],
    ]);
  });

  it("returns every visual column for an empty query without mutating the input", () => {
    const result = filterDataGridColumnLookupItems(columns, "  ");
    expect(result).toEqual(columns);
    expect(result).not.toBe(columns);
  });
});
