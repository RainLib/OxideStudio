import { describe, expect, it } from "vitest";
import type { QueryResult } from "@/services/tauri";
import {
  queryResultRowsToObjects,
  serializeQueryResultSelectionToTsv,
  serializeQueryResultToCsv,
  serializeQueryResultToJson,
} from "@/lib/exportUtils";

describe("query result export helpers", () => {
  it("serializes array-backed query rows to CSV with escaping", () => {
    const result: QueryResult = {
      columns: [
        { name: "id", data_type: "int4" },
        { name: "name", data_type: "text" },
        { name: "note", data_type: "text" },
      ],
      rows: [
        [1, "Alice", 'needs, quote "ok"'],
        [2, null, "line\nbreak"],
      ],
    };

    expect(serializeQueryResultToCsv(result)).toBe(
      'id,name,note\n1,Alice,"needs, quote ""ok"""\n2,,"line\nbreak"'
    );
  });

  it("serializes JSON as objects and disambiguates duplicate headers", () => {
    const result: QueryResult = {
      columns: [
        { name: "id", data_type: "int4" },
        { name: "id", data_type: "int4" },
        { name: "", data_type: "text" },
      ],
      rows: [[1, 2, "anonymous"]],
    };

    expect(queryResultRowsToObjects(result)).toEqual([
      { id: 1, id_2: 2, column_3: "anonymous" },
    ]);
    expect(JSON.parse(serializeQueryResultToJson(result))).toEqual([
      { id: 1, id_2: 2, column_3: "anonymous" },
    ]);
  });

  it("serializes selected rows and columns to TSV in caller-provided order", () => {
    const result: QueryResult = {
      columns: [
        { name: "id", data_type: "int4" },
        { name: "name", data_type: "text" },
        { name: "notes", data_type: "text" },
      ],
      rows: [
        [1, "Alice", "first"],
        [2, "Bob", "multi\nline"],
      ],
    };

    expect(serializeQueryResultSelectionToTsv(result, [1, 0], [2, 0])).toBe(
      "multi line\t2\nfirst\t1"
    );
    expect(serializeQueryResultSelectionToTsv(result, [0], [1, 0], true)).toBe(
      "name\tid\nAlice\t1"
    );
  });
});
