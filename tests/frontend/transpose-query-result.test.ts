import { describe, expect, it } from "vitest";
import { transposeQueryResult } from "@/features/data-grid";

describe("transposeQueryResult", () => {
  it("turns columns into stable read-only inspection rows without changing values", () => {
    expect(
      transposeQueryResult({
        columns: [
          { name: "id", data_type: "BIGINT" },
          { name: "name", data_type: "VARCHAR" },
        ],
        rows: [
          [1, "Ada"],
          [2, null],
        ],
        truncated: true,
        rowLimit: 2,
        statementType: "SELECT",
      }),
    ).toEqual({
      columns: [
        { name: "Field", data_type: "TEXT" },
        { name: "Row 1", data_type: "" },
        { name: "Row 2", data_type: "" },
      ],
      rows: [
        ["id (BIGINT)", 1, 2],
        ["name (VARCHAR)", "Ada", null],
      ],
      truncated: true,
      rowLimit: 2,
      statementType: "SELECT",
      message: undefined,
    });
  });

  it("keeps an empty result inspectable by preserving the field column", () => {
    expect(
      transposeQueryResult({
        columns: [{ name: "created_at", data_type: "TIMESTAMP" }],
        rows: [],
      }),
    ).toMatchObject({
      columns: [{ name: "Field", data_type: "TEXT" }],
      rows: [["created_at (TIMESTAMP)"]],
    });
  });
});
