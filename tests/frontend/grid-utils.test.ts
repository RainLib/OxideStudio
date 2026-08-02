import { describe, expect, it } from "vitest";
import { applyFilter, createTypedCell, formatValue } from "@/lib/gridUtils";

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

  it("uses the result-set type to align numeric text returned as a string", () => {
    const cell = createTypedCell("9007199254740993", true, "NOT LOADED", "DECIMAL(38,0)");

    expect("contentAlign" in cell && cell.contentAlign).toBe("right");
    expect("data" in cell && cell.data).toBe("9007199254740993");
  });

  it("supports database-tool style negative and NULL filters", () => {
    expect(
      applyFilter("active", { operator: "notEquals", value: "paused" }),
    ).toBe(true);
    expect(
      applyFilter("active", { operator: "notContains", value: "use" }),
    ).toBe(true);
    expect(applyFilter(null, { operator: "isNull", value: "" })).toBe(true);
    expect(applyFilter(undefined, { operator: "isNotNull", value: "" })).toBe(false);
    expect(applyFilter(0, { operator: "isNotNull", value: "" })).toBe(true);
  });
});
