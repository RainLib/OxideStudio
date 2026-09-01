import { describe, expect, it } from "vitest";
import {
  DATABASE_SEARCH_TABLE_BATCH_SIZE,
  databaseSearchBatchRange,
  databaseSearchNextBatchSize,
  databaseSearchResultByteSize,
  eligibleDatabaseSearchTables,
  findMatchedSearchColumns,
  isNumericSearchColumn,
  isTextSearchColumn,
  mapDatabaseSearchWithConcurrency,
} from "./databaseSearch";

describe("database search model", () => {
  it("continues across bounded table batches without treating 200 as a cap", () => {
    expect(DATABASE_SEARCH_TABLE_BATCH_SIZE).toBe(200);
    expect(databaseSearchBatchRange(0, 450)).toEqual({ start: 0, end: 200 });
    expect(databaseSearchBatchRange(200, 450)).toEqual({
      start: 200,
      end: 400,
    });
    expect(databaseSearchBatchRange(400, 450)).toEqual({
      start: 400,
      end: 450,
    });
    expect(databaseSearchNextBatchSize(400, 450)).toBe(50);
    expect(databaseSearchBatchRange(200, 450, true)).toEqual({
      start: 200,
      end: 450,
    });
  });

  it("classifies searchable values and matches returned rows", () => {
    expect(isTextSearchColumn({ data_type: "varchar" })).toBe(true);
    expect(isNumericSearchColumn({ data_type: "bigint" })).toBe(true);
    expect(isTextSearchColumn({ data_type: "blob" })).toBe(false);
    expect(
      findMatchedSearchColumns(
        ["id", "email", "note"],
        [42, "Alice@Example.com", "inactive"],
        [
          { name: "id", data_type: "integer" },
          { name: "email", data_type: "varchar" },
          { name: "note", data_type: "text" },
        ],
        "alice",
      ),
    ).toEqual(["email"]);
  });

  it("counts UTF-8 bytes for the global result budget", () => {
    expect(databaseSearchResultByteSize("用户", "邮箱", "id = 1")).toBe(
      new TextEncoder().encode("用户\0邮箱\0id = 1").length,
    );
  });

  it("deduplicates base tables and bounds metadata planning", () => {
    expect(
      eligibleDatabaseSearchTables(
        [
          { name: "users", type: "TABLE" },
          { name: "user_view", type: "VIEW" },
          { name: "users", type: "BASE TABLE" },
          { name: "orders", type: "BASE TABLE" },
        ],
        1,
      ),
    ).toEqual({
      tables: [{ name: "users", type: "TABLE" }],
      truncated: true,
    });
  });

  it("keeps bounded metadata work ordered", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapDatabaseSearchWithConcurrency(
      [3, 1, 2, 4],
      2,
      async (value) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return value * 2;
      },
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(result).toEqual([6, 2, 4, 8]);
  });
});
