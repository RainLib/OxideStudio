import { describe, expect, it } from "vitest";
import {
  findEnclosingDollarQuoteBodyStart,
  findEnclosingDollarQuoteBodyStartInText,
  sqlInsertValueHints,
} from "./sqlInsertValueHints";

describe("SQL INSERT value hints", () => {
  it("maps INSERT SELECT DISTINCT ON and parenthesized sources", () => {
    expect(
      sqlInsertValueHints(
        "INSERT INTO t (a, b) SELECT DISTINCT ON (id) value_a, value_b FROM source",
      ).map((hint) => hint.column),
    ).toEqual(["a", "b"]);
    expect(
      sqlInsertValueHints(
        "INSERT INTO t (a, b) (SELECT value_a, value_b FROM source)",
      ).map((hint) => hint.column),
    ).toEqual(["a", "b"]);
  });

  it("finds a long dollar-quoted body through bounded document reads", () => {
    const prefix = "x".repeat(96 * 1024);
    const opening = "$procedure$";
    const body = "\nBEGIN\nINSERT INTO target (id) SELECT id FROM source;\n";
    const sql = `${prefix}${opening}${body}`;
    const readLengths: number[] = [];
    const text = {
      length: sql.length,
      sliceString(from: number, to: number) {
        readLengths.push(to - from);
        return sql.slice(from, to);
      },
    };

    expect(
      findEnclosingDollarQuoteBodyStartInText(text, sql.indexOf("INSERT") + 4),
    ).toBe(prefix.length + opening.length);
    expect(
      readLengths.reduce((max, length) => Math.max(max, length), 0),
    ).toBeLessThanOrEqual(64 * 1024);
  });

  it("does not treat literal and comment dollar tags as routine bodies", () => {
    expect(
      findEnclosingDollarQuoteBodyStart(
        "SELECT '$not_a_tag$'; -- $also_not_a_tag$\nSELECT 1",
        51,
      ),
    ).toBeNull();
  });
});
