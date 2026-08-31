import type { GridColumn } from "@glideapps/glide-data-grid";
import { describe, expect, it } from "vitest";
import { filterGridColumns } from "./GridFilterRow";

const columns = [
  { id: "customer_id", title: "Customer ID" },
  { id: "created_at", title: "Created at" },
  { id: "billing_email", title: "Billing email" },
] as unknown as GridColumn[];

describe("filterGridColumns", () => {
  it("matches both the database identifier and displayed title without reordering", () => {
    expect(filterGridColumns(columns, "EMAIL")).toEqual([columns[2]]);
    expect(filterGridColumns(columns, "created_at")).toEqual([columns[1]]);
  });

  it("keeps the complete ordered schema when the search is blank", () => {
    expect(filterGridColumns(columns, "   ")).toBe(columns);
    expect(filterGridColumns(columns, "missing")).toEqual([]);
  });
});
