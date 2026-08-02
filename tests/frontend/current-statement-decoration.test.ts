import { describe, expect, it } from "vitest";
import { currentStatementLineFrames } from "@/features/query-editor";

function lineModel(source: string) {
  return {
    getPositionAt(offset: number) {
      return {
        lineNumber: source.slice(0, offset).split("\n").length,
      };
    },
  };
}

describe("current statement decoration", () => {
  it("surrounds a single-line statement with both frame edges", () => {
    const source = "SELECT 1;";
    expect(currentStatementLineFrames(lineModel(source), 0, source.length)).toEqual([
      {
        lineNumber: 1,
        className:
          "oxide-current-statement-line oxide-current-statement-start oxide-current-statement-end",
      },
    ]);
  });

  it("marks only the first and last edge of a multiline statement", () => {
    const source = "SELECT\n  id\nFROM users;\nSELECT 2;";
    const end = source.indexOf(";\n") + 1;
    expect(currentStatementLineFrames(lineModel(source), 0, end)).toEqual([
      {
        lineNumber: 1,
        className: "oxide-current-statement-line oxide-current-statement-start",
      },
      { lineNumber: 2, className: "oxide-current-statement-line " },
      {
        lineNumber: 3,
        className: "oxide-current-statement-line oxide-current-statement-end",
      },
    ]);
  });

  it("returns no frame for empty or inverted ranges", () => {
    const model = lineModel("SELECT 1");
    expect(currentStatementLineFrames(model, 3, 3)).toEqual([]);
    expect(currentStatementLineFrames(model, 5, 2)).toEqual([]);
    expect(currentStatementLineFrames(model, -1, 2)).toEqual([]);
  });
});
