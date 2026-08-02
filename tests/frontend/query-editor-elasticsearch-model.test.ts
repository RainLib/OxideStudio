import { describe, expect, it } from "vitest";
import {
  elasticsearchJsonStringCompletionRange,
  parseElasticsearchConsoleServerVersion,
} from "@/features/query-editor";

describe("Query Editor Elasticsearch provider model", () => {
  it.each([
    ["6.8.23", { major: 6, minor: 8 }],
    ["Elasticsearch 7.13.4", { major: 7, minor: 13 }],
    ["8.14.1-SNAPSHOT", { major: 8, minor: 14 }],
    ["5.6.16", undefined],
    [null, undefined],
  ])("parses supported server version %s", (input, expected) => {
    expect(parseElasticsearchConsoleServerVersion(input)).toEqual(expected);
  });

  it("replaces the full JSON string member, including an automatic closing quote", () => {
    const line = '      "stat"';
    const position = { lineNumber: 1, column: line.length };
    const range = elasticsearchJsonStringCompletionRange(
      {
        Range: class {
          constructor(
            readonly startLineNumber: number,
            readonly startColumn: number,
            readonly endLineNumber: number,
            readonly endColumn: number,
          ) {}
        },
      },
      {
        getLineContent: () => line,
        getWordUntilPosition: () => ({ startColumn: 1, endColumn: line.length }),
      },
      position,
    );

    expect(range).toMatchObject({
      startLineNumber: 1,
      startColumn: 7,
      endLineNumber: 1,
      endColumn: line.length + 1,
    });
  });
});
