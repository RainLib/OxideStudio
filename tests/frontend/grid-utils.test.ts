import { describe, expect, it } from "vitest";
import { createTypedCell, formatValue } from "@/lib/gridUtils";

describe("data grid value formatting", () => {
  it("keeps SQL NULL visually distinct from an empty string", () => {
    const nullCell = createTypedCell(null);
    const emptyCell = createTypedCell("");

    expect("displayData" in nullCell && nullCell.displayData).toBe("NULL");
    expect("displayData" in emptyCell && emptyCell.displayData).toBe("");
  });

  it("serializes JSON values instead of displaying object placeholders", () => {
    expect(formatValue({ role: "admin" })).toBe('{"role":"admin"}');
    expect(formatValue([1, 2, 3])).toBe("[1,2,3]");
  });
});
