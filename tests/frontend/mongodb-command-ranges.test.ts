import { describe, expect, it } from "vitest";
import {
  mongodbCommandRangeAtCursor,
  mongodbCommandRanges,
} from "@/features/query-editor";

describe("MongoDB command ranges", () => {
  it("finds one strict JSON command", () => {
    const source = '  {"collection":"users","find":{"active":true}}  ';
    expect(mongodbCommandRanges(source)).toEqual([
      {
        from: 2,
        to: source.trimEnd().length,
        text: source.trim(),
      },
    ]);
  });

  it("unwraps a top-level command array without splitting nested arrays", () => {
    const source = `[
  {"aggregate":"orders","pipeline":[{"$match":{"status":"open"}}]},
  {"collection":"users","find":{}}
]`;
    const ranges = mongodbCommandRanges(source);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]?.text).toContain('"pipeline"');
    expect(ranges[1]?.text).toBe('{"collection":"users","find":{}}');
  });

  it("supports whitespace-separated objects used by editor documents", () => {
    const source = `{"collection":"users","find":{}}

{"collection":"orders","countDocuments":{}}`;
    const ranges = mongodbCommandRanges(source);
    expect(ranges.map((range) => range.text)).toEqual([
      '{"collection":"users","find":{}}',
      '{"collection":"orders","countDocuments":{}}',
    ]);
  });

  it("selects the command under the cursor and ignores blank separator lines", () => {
    const source = `  {"collection":"users","find":{}}

  {"collection":"orders","find":{}}`;
    expect(mongodbCommandRangeAtCursor(source, source.indexOf("users"))?.text)
      .toContain("users");
    expect(mongodbCommandRangeAtCursor(source, source.indexOf("orders") - 2)?.text)
      .toContain("orders");
    expect(mongodbCommandRangeAtCursor(source, source.indexOf("\n\n") + 1))
      .toBeNull();
  });

  it("fails closed for incomplete, scalar or mixed top-level JSON", () => {
    expect(mongodbCommandRanges('{"collection":"users"')).toEqual([]);
    expect(mongodbCommandRanges('"users"')).toEqual([]);
    expect(mongodbCommandRanges('[{"collection":"users"}, 42]')).toEqual([]);
    expect(mongodbCommandRanges('{} []')).toEqual([]);
  });
});
