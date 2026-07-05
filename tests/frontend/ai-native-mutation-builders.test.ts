import { describe, expect, it } from "vitest";
import {
  buildElasticsearchMutationRequest,
  buildMongoMutationCommand,
  buildRedisMutationCommand,
} from "@/ai/tools/nativeMutationBuilders";

describe("AI native mutation builders", () => {
  it("builds MongoDB insert, update, and delete command JSON", () => {
    expect(
      buildMongoMutationCommand(
        {
          operation: "insert",
          collection: "users",
          documents: [{ email: "ada@example.com" }],
        },
        "app"
      )
    ).toEqual({
      database: "app",
      collection: "users",
      insertMany: [{ email: "ada@example.com" }],
    });

    expect(
      buildMongoMutationCommand(
        {
          operation: "update",
          collection: "users",
          filter: { email: "ada@example.com" },
          update: { $set: { active: true } },
          many: true,
          upsert: true,
        },
        "app"
      )
    ).toEqual({
      database: "app",
      collection: "users",
      updateMany: {
        filter: { email: "ada@example.com" },
        update: { $set: { active: true } },
        upsert: true,
      },
    });

    expect(
      buildMongoMutationCommand(
        {
          operation: "delete",
          collection: "users",
          filter: { active: false },
        },
        ""
      )
    ).toEqual({
      collection: "users",
      deleteOne: { active: false },
    });
  });

  it("builds Redis SET and DEL commands with safe quoting", () => {
    expect(
      buildRedisMutationCommand({
        operation: "set",
        key: "user:1",
        value: { email: "ada@example.com" },
        ttlSeconds: 60,
      })
    ).toBe('SET user:1 "{\\"email\\":\\"ada@example.com\\"}" EX 60');

    expect(
      buildRedisMutationCommand({
        operation: "delete",
        keys: ["user:1", "session token"],
      })
    ).toBe('DEL user:1 "session token"');
  });

  it("builds Elasticsearch index, update, and delete requests", () => {
    expect(
      buildElasticsearchMutationRequest({
        operation: "index",
        index: "users",
        id: "user 1",
        document: { email: "ada@example.com" },
      })
    ).toBe('PUT /users/_doc/user%201\n{"email":"ada@example.com"}');

    expect(
      buildElasticsearchMutationRequest({
        operation: "update",
        index: "users",
        id: "1",
        document: { active: true },
        upsert: true,
      })
    ).toBe('POST /users/_update/1\n{"doc":{"active":true},"doc_as_upsert":true}');

    expect(
      buildElasticsearchMutationRequest({
        operation: "delete",
        index: "users",
        id: "1",
      })
    ).toBe("DELETE /users/_doc/1");
  });

  it("rejects incomplete native mutation requests before execution", () => {
    expect(() =>
      buildMongoMutationCommand({ operation: "insert", collection: "users" }, "app")
    ).toThrow("documents is required");
    expect(() =>
      buildRedisMutationCommand({ operation: "delete", keys: [] })
    ).toThrow("keys is required");
    expect(() =>
      buildElasticsearchMutationRequest({
        operation: "update",
        index: "users",
        id: "1",
      })
    ).toThrow("document is required");
  });
});
