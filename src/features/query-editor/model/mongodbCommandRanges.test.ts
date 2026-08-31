import { describe, expect, it } from "vitest";
import {
  mongodbCommandRangeAtCursor,
  mongodbCommandRanges,
} from "./mongodbCommandRanges";

describe("MongoDB command ranges", () => {
  it("preserves strict JSON object and array behavior", () => {
    expect(mongodbCommandRanges('{"collection":"users","find":{}}')).toHaveLength(1);
    expect(
      mongodbCommandRanges('[{"collection":"a","find":{}},{"collection":"b","find":{}}]'),
    ).toHaveLength(2);
  });

  it("keeps a multiline shell chain as one executable command", () => {
    const source = `db.getCollection("audit.logs")
      .find({ message: "still; one command" })
      .sort({ createdAt: -1 })
      .limit(20)`;
    expect(mongodbCommandRanges(source)).toEqual([
      { from: 0, to: source.length, text: source },
    ]);
  });

  it("splits semicolon-delimited shell commands only at top level", () => {
    const source = "db.users.find({note: 'a;b'}).limit(5);\n\ndb.orders.count({active: true});";
    const ranges = mongodbCommandRanges(source);
    expect(ranges.map((range) => range.text)).toEqual([
      "db.users.find({note: 'a;b'}).limit(5)",
      "db.orders.count({active: true})",
    ]);
    expect(mongodbCommandRangeAtCursor(source, source.indexOf("orders"))?.text).toBe(
      "db.orders.count({active: true})",
    );
  });

  it("treats show databases as an executable shell command", () => {
    expect(mongodbCommandRanges("show databases")).toEqual([
      { from: 0, to: "show databases".length, text: "show databases" },
    ]);
  });

  it("fails closed for unbalanced or unsupported shell text", () => {
    expect(mongodbCommandRanges("db.users.find({")).toEqual([]);
    expect(mongodbCommandRanges("console.log('not mongo')")).toEqual([]);
  });
});
