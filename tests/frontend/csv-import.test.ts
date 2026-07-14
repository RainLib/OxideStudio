import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "@/services/tauri/types";
import {
  buildCsvImportPlan,
  createCsvColumnMapping,
  csvSourceColumns,
  decodeCsvBytes,
  inferCsvDelimiter,
  parseCsv,
} from "@/lib/csvImport";

const columns: ColumnInfo[] = [
  {
    name: "id",
    data_type: "bigint",
    is_nullable: false,
    is_primary_key: true,
    is_auto_increment: true,
  },
  {
    name: "email",
    data_type: "text",
    is_nullable: false,
    is_primary_key: false,
  },
  {
    name: "enabled",
    data_type: "boolean",
    is_nullable: false,
    is_primary_key: false,
    default_value: "true",
  },
  {
    name: "profile",
    data_type: "jsonb",
    is_nullable: true,
    is_primary_key: false,
  },
];

describe("CSV import model", () => {
  it("detects BOM encodings and strips the BOM", () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x65, 0x00, 0x6d, 0x00]);
    expect(decodeCsvBytes(utf16, "auto")).toEqual({
      text: "em",
      encoding: "utf-16le",
    });
  });

  it("detects delimiters and parses quoted delimiters, quotes, and newlines", () => {
    const text = 'email;note\n"a@example.test";"line 1\nline 2; ""ok"""\n';
    expect(inferCsvDelimiter(text)).toBe(";");
    expect(parseCsv(text, ";")).toMatchObject({
      issues: [],
      records: [
        { values: ["email", "note"], line: 1 },
        {
          values: ["a@example.test", 'line 1\nline 2; "ok"'],
          line: 2,
        },
      ],
    });
  });

  it("auto maps headers case-insensitively and validates typed values", () => {
    const parsed = parseCsv(
      'EMAIL,enabled,profile\nuser@example.test,1,"{""role"":""admin""}"\n',
      ",",
    );
    const sourceColumns = csvSourceColumns(parsed.records, true);
    const mapping = createCsvColumnMapping(sourceColumns, columns, true);
    const plan = buildCsvImportPlan({
      records: parsed.records,
      parseIssues: parsed.issues,
      hasHeader: true,
      mapping,
      columns,
      emptyAsNull: true,
    });

    expect(mapping.map((item) => item.targetColumn)).toEqual([
      "email",
      "enabled",
      "profile",
    ]);
    expect(plan).toMatchObject({
      errorCount: 0,
      rows: [
        {
          email: "user@example.test",
          enabled: true,
          profile: { role: "admin" },
        },
      ],
    });
  });

  it("reports line and target column for type errors", () => {
    const parsed = parseCsv("email,enabled\nuser@example.test,perhaps\n", ",");
    const sourceColumns = csvSourceColumns(parsed.records, true);
    const plan = buildCsvImportPlan({
      records: parsed.records,
      parseIssues: parsed.issues,
      hasHeader: true,
      mapping: createCsvColumnMapping(sourceColumns, columns, true),
      columns,
      emptyAsNull: true,
    });

    expect(plan.errorCount).toBe(1);
    expect(plan.rows).toEqual([]);
    expect(plan.issues[0]).toMatchObject({
      line: 2,
      targetColumn: "enabled",
      message: "Boolean values must be true or false.",
    });
  });

  it("rejects invalid integer text before the transaction starts", () => {
    const parsed = parseCsv("id,email\nnot-a-number,user@example.test\n", ",");
    const plan = buildCsvImportPlan({
      records: parsed.records,
      hasHeader: true,
      mapping: createCsvColumnMapping(
        csvSourceColumns(parsed.records, true),
        columns,
        true,
      ),
      columns,
      emptyAsNull: true,
    });

    expect(plan.issues).toContainEqual({
      line: 2,
      sourceColumn: "id",
      targetColumn: "id",
      message: "Enter a valid numeric value.",
    });
  });

  it("requires unmapped non-null columns without defaults", () => {
    const parsed = parseCsv("enabled\ntrue\n", ",");
    const plan = buildCsvImportPlan({
      records: parsed.records,
      hasHeader: true,
      mapping: createCsvColumnMapping(
        csvSourceColumns(parsed.records, true),
        columns,
        true,
      ),
      columns,
      emptyAsNull: true,
    });

    expect(plan.issues).toContainEqual({
      targetColumn: "email",
      message: "Required column is not mapped and has no default value.",
    });
  });

  it("maps files without headers by source position", () => {
    const parsed = parseCsv("1,user@example.test\n", ",");
    const sourceColumns = csvSourceColumns(parsed.records, false);
    expect(createCsvColumnMapping(sourceColumns, columns, false)).toMatchObject([
      { sourceName: "Column 1", targetColumn: "id" },
      { sourceName: "Column 2", targetColumn: "email" },
    ]);
  });
});
