import { describe, expect, it } from "vitest";
import {
  sqlBatchColumnInsertion,
  sqlBatchColumnMode,
  uniqueSqlBatchColumnCandidates,
} from "./sqlBatchColumnSelection";

describe("SQL batch column selection", () => {
  it("recognizes SELECT-list and INSERT-column contexts", () => {
    expect(sqlBatchColumnMode("SELECT ")).toBe("select");
    expect(sqlBatchColumnMode("SELECT id FROM users")).toBeNull();
    expect(sqlBatchColumnMode("INSERT INTO users (")).toBe("insert");
  });

  it("builds a tab-navigable INSERT values snippet", () => {
    expect(sqlBatchColumnInsertion([
      { key: "id", label: "id", insertText: "id" },
      { key: "name", label: "name", insertText: "name" },
    ], "insert", "lower")).toEqual({
      text: "id, name) values (${1:value}, ${2:value})",
      snippet: true,
    });
  });

  it("deduplicates candidates without changing server order", () => {
    expect(uniqueSqlBatchColumnCandidates([
      { key: "id", label: "id", insertText: "id" },
      { key: "id", label: "id", insertText: "id" },
      { key: "name", label: "name", insertText: "name" },
    ]).map((candidate) => candidate.key)).toEqual(["id", "name"]);
  });
});
