import { describe, expect, it } from "vitest";
import { createTypedCell, formatValue } from "@/lib/gridUtils";

describe("data grid value formatting", () => {
  it("keeps SQL NULL visually distinct from an empty string", () => {
    const nullCell = createTypedCell(null);
    const emptyCell = createTypedCell("");

    expect("displayData" in nullCell && nullCell.displayData).toBe("NULL");
    expect("displayData" in emptyCell && emptyCell.displayData).toBe("''");
  });

  it("keeps an unloaded database default distinct from SQL NULL", () => {
    const unloadedCell = createTypedCell(undefined, true, "DEFAULT");
    const nullCell = createTypedCell(null);

    expect("displayData" in unloadedCell && unloadedCell.displayData).toBe(
      "DEFAULT",
    );
    expect("displayData" in nullCell && nullCell.displayData).toBe("NULL");
  });

  it("serializes JSON values instead of displaying object placeholders", () => {
    expect(formatValue({ role: "admin" })).toBe('{"role":"admin"}');
    expect(formatValue([1, 2, 3])).toBe("[1,2,3]");
  });

  it("keeps raw numeric text editable without locale separators", () => {
    const cell = createTypedCell(1234567);

    expect("displayData" in cell && cell.displayData).toContain("1");
    expect("data" in cell && cell.data).toBe("1234567");
  });
});
