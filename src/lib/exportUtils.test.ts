import { describe, expect, it } from "vitest";
import type { QueryResult } from "@/services/tauri";
import {
  serializeQueryResultToJsonLines,
  serializeQueryResultToMarkdown,
  serializeQueryResultToSql,
  serializeQueryResultToTsv,
} from "./exportUtils";

const RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer" },
    { name: "display name", data_type: "text" },
    { name: "active", data_type: "boolean" },
  ],
  rows: [
    [1, "Ada's account", true],
    [2, null, false],
  ],
};

describe("query result export formats", () => {
  it("serializes JSONL as one object per line", () => {
    expect(serializeQueryResultToJsonLines(RESULT).split("\n")).toEqual([
      '{"id":1,"display name":"Ada\'s account","active":true}',
      '{"id":2,"display name":null,"active":false}',
    ]);
  });

  it("serializes a header row for TSV/Excel", () => {
    expect(serializeQueryResultToTsv(RESULT)).toBe(
      "id\tdisplay name\tactive\n1\tAda's account\ttrue\n2\t\tfalse",
    );
  });

  it("serializes Markdown tables with escaped structure and explicit nulls", () => {
    const result: QueryResult = {
      columns: [{ name: "name|path", data_type: "text" }],
      rows: [["Ada|one\nline"], [null]],
    };

    expect(serializeQueryResultToMarkdown(result)).toBe(
      "| name\\|path |\n| --- |\n| Ada\\|one<br>line |\n| NULL |",
    );
  });

  it("generates reviewed SQL INSERT batches with escaped values", () => {
    const sql = serializeQueryResultToSql(RESULT);

    expect(sql).toContain('INSERT INTO "target_table" ("id", "display name", "active")');
    expect(sql).toContain("(1, 'Ada''s account', TRUE)");
    expect(sql).toContain("(2, NULL, FALSE)");
  });
});
