import { describe, expect, it } from "vitest";
import {
  dataGridCellUsesFullValueEditor,
  normalizeDataGridNumericInput,
} from "@/features/data-grid";

describe("data grid cell input alignment", () => {
  it("normalizes ambiguous comma numbers using the runtime locale", () => {
    expect(
      normalizeDataGridNumericInput("114,870", "decimal(14,4)", {
        groupSeparator: ",",
        decimalSeparator: ".",
      }),
    ).toBe("114870");
    expect(
      normalizeDataGridNumericInput("114,870", "decimal(14,4)", {
        groupSeparator: ".",
        decimalSeparator: ",",
      }),
    ).toBe("114.870");
  });

  it("keeps exact grouped numeric text and ignores non-numeric columns", () => {
    expect(
      normalizeDataGridNumericInput("9,007,199,254,740,993", "bigint", {
        groupSeparator: ",",
        decimalSeparator: ".",
      }),
    ).toBe("9007199254740993");
    expect(
      normalizeDataGridNumericInput("10,000", "varchar(255)", {
        groupSeparator: ",",
        decimalSeparator: ".",
      }),
    ).toBe("10,000");
  });

  it("routes long and structured values to the full viewport-safe editor", () => {
    expect(dataGridCellUsesFullValueEditor("short", "text")).toBe(false);
    expect(dataGridCellUsesFullValueEditor("line one\nline two", "text")).toBe(true);
    expect(dataGridCellUsesFullValueEditor("x".repeat(161), "varchar")).toBe(true);
    expect(dataGridCellUsesFullValueEditor("{}", "jsonb")).toBe(true);
  });
});
