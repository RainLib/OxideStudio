import { describe, expect, it } from "vitest";
import {
  importFormatForPath,
  importTableNameSuggestion,
} from "./importSource";

describe("table creation import source", () => {
  it("classifies supported data files and rejects unknown extensions", () => {
    expect(importFormatForPath("/exports/customers.CSV")).toBe("csv");
    expect(importFormatForPath("orders.ndjson")).toBe("json");
    expect(importFormatForPath("report.xlsx")).toBe("xlsx");
    expect(importFormatForPath("README.md")).toBeNull();
  });

  it("derives a stable editable table name from a selected path", () => {
    expect(importTableNameSuggestion("/exports/Customer Orders!.csv")).toBe(
      "Customer_Orders",
    );
    expect(importTableNameSuggestion("/exports/---.json")).toBe("imported_data");
  });
});
