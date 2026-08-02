import { describe, expect, it } from "vitest";
import {
  compactResultColumnType,
  resolveHeaderColumnType,
  resolveRenderedColumnType,
  resultColumnTypeFamily,
} from "@/features/data-grid";

describe("result column type presentation", () => {
  it("uses table metadata for headers and result metadata for rendering", () => {
    expect(
      resolveHeaderColumnType({
        tableColumnType: "numeric(12,2)",
        resultColumnType: "text",
      }),
    ).toBe("numeric(12,2)");
    expect(
      resolveRenderedColumnType({
        tableColumnType: "numeric(12,2)",
        resultColumnType: "text",
      }),
    ).toBe("text");
  });

  it("keeps arbitrary query column types when table metadata is unavailable", () => {
    expect(
      resolveHeaderColumnType({ resultColumnType: "Nullable(UInt64)" }),
    ).toBe("Nullable(UInt64)");
    expect(resultColumnTypeFamily("Nullable(UInt64)")).toBe("number");
    expect(resultColumnTypeFamily("LowCardinality(String)")).toBe("string");
  });

  it("classifies common cross-database types", () => {
    expect(resultColumnTypeFamily("uniqueidentifier")).toBe("reference");
    expect(resultColumnTypeFamily("jsonb")).toBe("json");
    expect(resultColumnTypeFamily("Array(Int32)")).toBe("array");
    expect(resultColumnTypeFamily("timestamp with time zone")).toBe(
      "datetime",
    );
    expect(compactResultColumnType("enum('a', 'b')")).toBe("enum");
  });
});
