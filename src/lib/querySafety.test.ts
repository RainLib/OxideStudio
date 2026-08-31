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

describe("Elasticsearch Console query safety", () => {
  it("recognizes the complete read-only REST endpoint set", () => {
    for (const request of [
      "POST /orders/_field_caps",
      "POST /orders/_terms_enum",
      "POST /orders/_validate/query",
      "POST /orders/_explain/42",
      "POST /orders/_rank_eval",
      "POST /orders/_search_shards",
      "POST /_sql/translate",
      "POST /orders/_eql/search",
      "OPTIONS /orders/_search",
    ]) {
      expect(classifyAiQuerySafety(request, "elasticsearch"), request).toBe(
        "read",
      );
    }
  });

  it("uses the highest risk across multiple Console requests", () => {
    expect(
      classifyAiQuerySafety(
        "GET /orders/_search\n{}\n\nPOST /orders/_update/42\n{\"doc\":{\"active\":true}}",
        "elasticsearch",
      ),
    ).toBe("write");
    expect(
      classifyAiQuerySafety(
        "GET /orders/_search\n{}\n\nPOST /orders/_delete_by_query\n{\"query\":{\"match_all\":{}}}",
        "elasticsearch",
      ),
    ).toBe("destructive");
  });

  it("ignores commented request lines and fails closed for unknown POST actions", () => {
    const source = `
      /* POST /orders/_delete_by_query */
      // DELETE /orders
      # POST /_bulk
      POST /orders/_search
      {"query":{"match":{"note":"POST /_bulk"}}}
    `;
    expect(classifyAiQuerySafety(source, "elasticsearch")).toBe("read");
    expect(
      classifyAiQuerySafety("POST /_cluster/reroute\n{}", "elasticsearch"),
    ).toBe("destructive");
  });
});
