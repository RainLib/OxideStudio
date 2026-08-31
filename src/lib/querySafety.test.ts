import { describe, expect, it } from "vitest";

import {
  classifyAiQuerySafety,
  looksAiQueryDestructive,
  looksAiQueryReadOnly,
} from "@/lib/querySafety";

describe("MongoDB shell query safety", () => {
  it("classifies bounded read helpers and cursor chains as read-only", () => {
    expect(
      looksAiQueryReadOnly(
        "db.users.find({active: true}).sort({createdAt: -1}).limit(20)",
        "mongodb",
      ),
    ).toBe(true);
    expect(
      classifyAiQuerySafety(
        "db.getCollection('audit.logs').countDocuments({tenant: 'acme'})",
        "mongodb",
      ),
    ).toBe("read");
    expect(classifyAiQuerySafety("show databases", "mongodb")).toBe("read");
  });

  it("classifies shell writes separately from destructive methods", () => {
    expect(
      classifyAiQuerySafety(
        "db.users.updateMany({active: false}, {$set: {active: true}})",
        "mongodb",
      ),
    ).toBe("write");
    expect(
      classifyAiQuerySafety("db.users.deleteMany({active: false})", "mongodb"),
    ).toBe("destructive");
    expect(
      looksAiQueryDestructive("db.users.dropIndexes()", "mongodb"),
    ).toBe(true);
  });

  it("treats write aggregation stages as destructive without matching literals", () => {
    expect(
      classifyAiQuerySafety(
        "db.users.aggregate([{$match: {note: '$out: literal'}}])",
        "mongodb",
      ),
    ).toBe("read");
    expect(
      classifyAiQuerySafety(
        "db.users.aggregate([{$match: {}}, {$merge: 'archive'}])",
        "mongodb",
      ),
    ).toBe("destructive");
  });

  it("does not let method-looking text inside comments or strings change safety", () => {
    const source = `
      // db.users.deleteMany({})
      db.users.find({note: "db.users.drop()"}).limit(1)
    `;
    expect(classifyAiQuerySafety(source, "mongodb")).toBe("read");
  });
});
