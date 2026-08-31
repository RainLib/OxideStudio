import { describe, expect, it } from "vitest";
import {
  elasticsearchJsonStringCompletionRange,
  elasticsearchPathCompletionRange,
} from "./elasticsearchCompletionRange";

class Range {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

function model(line: string) {
  return {
    getLineContent: () => line,
    getWordUntilPosition: (position: { column: number }) => {
      const before = line.slice(0, position.column - 1);
      const word = before.match(/[\w.-]+$/u)?.[0] || "";
      return {
        startColumn: position.column - word.length,
        endColumn: position.column,
      };
    },
  };
}

describe("Elasticsearch completion replacement ranges", () => {
  it("replaces an index prefix and preserves the endpoint suffix", () => {
    const line = "GET /ord/_search";
    const position = { lineNumber: 1, column: "GET /ord".length + 1 };
    const range = elasticsearchPathCompletionRange(
      { Range },
      model(line),
      position,
    );

    expect(range).toEqual(new Range(1, "GET ".length + 1, 1, position.column));
    const applied = `${line.slice(0, range.startColumn - 1)}/orders${line.slice(range.endColumn - 1)}`;
    expect(applied).toBe("GET /orders/_search");
  });

  it("keeps JSON quote replacement independent from REST paths", () => {
    const line = '  "sta"';
    const position = { lineNumber: 1, column: line.indexOf('"', 3) + 1 };
    const range = elasticsearchJsonStringCompletionRange(
      { Range },
      model(line),
      position,
    );
    expect(range.startColumn).toBe(3);
    expect(range.endColumn).toBe(line.length + 1);
  });
});
