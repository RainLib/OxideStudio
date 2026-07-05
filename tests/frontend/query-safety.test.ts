import { describe, expect, it } from "vitest";
import {
  classifyAiQuerySafety,
  looksAiQueryDestructive,
  looksAiQueryReadOnly,
} from "@/lib/querySafety";

describe("AI query safety classification", () => {
  it("classifies relational reads, writes, and destructive SQL", () => {
    expect(classifyAiQuerySafety("select * from users", "postgres")).toBe("read");
    expect(classifyAiQuerySafety("insert into users(id) values (1)", "postgres")).toBe(
      "write"
    );
    expect(classifyAiQuerySafety("drop table users", "postgres")).toBe(
      "destructive"
    );
    expect(looksAiQueryReadOnly("select * from users for update", "postgres")).toBe(
      false
    );
  });

  it("accepts only explicit MongoDB reads and rejects unsafe unknown shapes", () => {
    const preview = JSON.stringify({
      database: "app",
      collection: "users",
      find: { active: true },
      limit: 100,
    });
    const implicitFind = JSON.stringify({
      collection: "users",
      projection: { email: 1 },
      limit: 20,
    });
    const unknownShape = JSON.stringify({
      collection: "users",
      drop: true,
    });

    expect(looksAiQueryReadOnly(preview, "mongodb")).toBe(true);
    expect(looksAiQueryReadOnly(implicitFind, "mongodb")).toBe(true);
    expect(looksAiQueryReadOnly(unknownShape, "mongodb")).toBe(false);
    expect(looksAiQueryDestructive(unknownShape, "mongodb")).toBe(true);
    expect(
      classifyAiQuerySafety(
        JSON.stringify({ collection: "users", updateMany: { filter: {}, update: {} } }),
        "mongodb"
      )
    ).toBe("write");
    expect(
      classifyAiQuerySafety(
        JSON.stringify({ command: { drop: "users" } }),
        "mongodb"
      )
    ).toBe("destructive");
    expect(
      classifyAiQuerySafety(
        JSON.stringify({ database: "app", command: { create: "users" } }),
        "mongodb"
      )
    ).toBe("write");
  });

  it("classifies Redis command batches by command family", () => {
    expect(classifyAiQuerySafety('TYPE "user:1"\nHGETALL "user:1"', "redis")).toBe(
      "read"
    );
    expect(classifyAiQuerySafety('SET "user:1" "{}"', "redis")).toBe("write");
    expect(classifyAiQuerySafety('DEL "user:1"', "redis")).toBe("destructive");
  });

  it("classifies Elasticsearch HTTP-style requests and JSON bodies", () => {
    expect(
      classifyAiQuerySafety(
        'GET /users/_search\n{"query":{"match_all":{}}}',
        "elasticsearch"
      )
    ).toBe("read");
    expect(
      classifyAiQuerySafety('POST /users/_doc\n{"name":"Ada"}', "elasticsearch")
    ).toBe("write");
    expect(classifyAiQuerySafety("PUT /users\n{}", "elasticsearch")).toBe("write");
    expect(
      classifyAiQuerySafety("DELETE /users", "elasticsearch")
    ).toBe("destructive");
    expect(
      classifyAiQuerySafety('{"delete":{"_index":"users","_id":"1"}}', "elasticsearch")
    ).toBe("destructive");
  });
});
