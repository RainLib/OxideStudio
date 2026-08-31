import { describe, expect, it } from "vitest";
import {
  comparableRelationNames,
  prepareBatchTableComparison,
  tableDataCompareDifferenceCount,
} from "@/lib/tableDataCompareBatch";
import type { ColumnInfo, TableDataCompareResult } from "@/services/tauri";

function column(name: string, primaryKey = false): ColumnInfo {
  return {
    name,
    data_type: name === "id" ? "bigint" : "text",
    is_nullable: false,
    is_primary_key: primaryKey,
  };
}

describe("table data compare batch planning", () => {
  it("matches only physical relations and keeps their names stable", () => {
    expect(
      comparableRelationNames([
        { name: "z_events", type: "TABLE" },
        { name: "active_users", type: "VIEW" },
        { name: "accounts", type: "BASE TABLE" },
      ]),
    ).toEqual(["accounts", "z_events"]);
  });

  it("requires the same complete primary key while comparing shared columns", () => {
    expect(
      prepareBatchTableComparison(
        [column("tenant_id", true), column("id", true), column("payload")],
        [column("tenant_id", true), column("id", true), column("updated_at")],
      ),
    ).toEqual({
      columns: ["tenant_id", "id"],
      keyColumns: ["tenant_id", "id"],
    });

    expect(() =>
      prepareBatchTableComparison(
        [column("tenant_id", true), column("id", true)],
        [column("id", true), column("tenant_id")],
      ),
    ).toThrow("same complete primary key");
  });

  it("keeps exact operation totals separate from sampled metadata", () => {
    const result = {
      addedCount: 4,
      removedCount: 3,
      modifiedCount: 2,
    } as TableDataCompareResult;
    expect(tableDataCompareDifferenceCount(result)).toBe(9);
  });
});
