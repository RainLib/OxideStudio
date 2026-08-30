import { describe, expect, it } from "vitest";
import {
  buildCsvImportPlan,
  csvSourceColumns,
  decodeCsvBytes,
  selectCsvDataRecords,
  validateCsvRowSelection,
} from "./csvImport";

describe("decodeCsvBytes", () => {
  it("auto-detects UTF-16 BOM and strips it before preview", () => {
    const bytes = new Uint8Array([
      0xff, 0xfe,
      0x69, 0x00, 0x64, 0x00, 0x0a, 0x00,
      0x31, 0x00, 0x0a, 0x00,
    ]);

    expect(decodeCsvBytes(bytes, "auto")).toEqual({
      text: "id\n1\n",
      encoding: "utf-16le",
    });
  });

  it("falls back from strict UTF-8 to GB18030 during automatic detection", () => {
    const bytes = new Uint8Array([
      0x6e, 0x61, 0x6d, 0x65, 0x0a,
      0xd6, 0xd0, 0xce, 0xc4, 0x0a,
    ]);

    expect(decodeCsvBytes(bytes, "auto")).toEqual({
      text: "name\n中文\n",
      encoding: "gb18030",
    });
  });

  it("rejects malformed bytes instead of inserting replacement characters", () => {
    expect(() => decodeCsvBytes(new Uint8Array([0x61, 0xff]), "utf-8"))
      .toThrow("invalid bytes for UTF-8");
  });
});

describe("delimited import row selection", () => {
  const records = [
    { line: 1, values: ["generated report", "ignore"] },
    { line: 2, values: ["metadata", "ignore"] },
    { line: 3, values: [" id ", " name "] },
    { line: 4, values: ["skip", "skip"] },
    { line: 5, values: [" 1 ", " Ada "] },
    { line: 6, values: [" 2 ", " Bob "] },
    { line: 7, values: ["footer", "ignore"] },
  ];

  it("uses independent title, data start, and last data rows", () => {
    const selection = {
      hasHeader: true,
      titleRow: 3,
      dataStartRow: 5,
      lastDataRow: 6,
    };
    expect(validateCsvRowSelection(selection)).toBeNull();
    expect(selectCsvDataRecords(records, selection).map((record) => record.line))
      .toEqual([5, 6]);
    expect(csvSourceColumns(records, true, 3, 5, 6)).toEqual(["id", "name"]);
  });

  it("rejects overlapping title and data ranges", () => {
    expect(validateCsvRowSelection({
      hasHeader: true,
      titleRow: 3,
      dataStartRow: 3,
      lastDataRow: 0,
    })).toContain("before the data start");
    expect(validateCsvRowSelection({
      hasHeader: false,
      titleRow: 0,
      dataStartRow: 5,
      lastDataRow: 4,
    })).toContain("must not be before");
  });

  it("applies trim before empty/null and type conversion", () => {
    const plan = buildCsvImportPlan({
      records,
      hasHeader: true,
      titleRow: 3,
      dataStartRow: 5,
      lastDataRow: 5,
      mapping: [
        { sourceIndex: 0, sourceName: "id", targetColumn: "id" },
        { sourceIndex: 1, sourceName: "name", targetColumn: "name" },
      ],
      columns: [
        {
          name: "id",
          data_type: "integer",
          is_nullable: false,
          is_primary_key: true,
        },
        {
          name: "name",
          data_type: "text",
          is_nullable: false,
          is_primary_key: false,
        },
      ],
      emptyAsNull: false,
      trimValues: true,
    });

    expect(plan.errorCount).toBe(0);
    expect(plan.rows).toEqual([{ id: "1", name: "Ada" }]);
  });
});
