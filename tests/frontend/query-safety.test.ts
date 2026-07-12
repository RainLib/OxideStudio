import { describe, expect, it } from "vitest";
import {
  classifyAiQuerySafety,
  redisSelectedDatabase,
  looksAiQueryDestructive,
  looksAiQueryReadOnly,
} from "@/lib/querySafety";
import {
  editorExecutionConfirmation,
  evaluateSqlExecutionIntent,
} from "@/lib/sqlExecutionGate";

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
    expect(
      classifyAiQuerySafety(
        "select pg_write_file('/tmp/x', 'data')",
        "postgres"
      )
    ).toBe("write");
    expect(
      classifyAiQuerySafety("select pg_terminate_backend(42)", "postgres")
    ).toBe("destructive");
    expect(
      looksAiQueryReadOnly("select * into backup_users from users", "postgres")
    ).toBe(false);
    expect(
      looksAiQueryReadOnly(
        "select email into outfile '/tmp/users.csv' from users",
        "mysql"
      )
    ).toBe(false);
    expect(
      looksAiQueryReadOnly(
        "WITH active AS (SELECT * FROM users) SELECT * INTO backup_users FROM active",
        "postgres"
      )
    ).toBe(false);
    expect(
      looksAiQueryReadOnly(
        "SELECT '{}'::jsonb #> '{}'; COMMIT; DELETE FROM users",
        "postgres"
      )
    ).toBe(false);
    expect(
      looksAiQueryReadOnly(
        "SELECT 1--1; COMMIT; DELETE FROM users",
        "mysql"
      )
    ).toBe(false);
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
    expect(
      classifyAiQuerySafety(
        JSON.stringify({
          collection: "users",
          aggregate: [{ $match: { active: true } }, { $limit: 10 }],
        }),
        "mongodb"
      )
    ).toBe("read");
    expect(
      classifyAiQuerySafety(
        JSON.stringify({
          collection: "users",
          aggregate: [{ $match: {} }, { $out: "users_archive" }],
        }),
        "mongodb"
      )
    ).toBe("destructive");
    expect(
      classifyAiQuerySafety(
        JSON.stringify({
          command: {
            aggregate: "users",
            pipeline: [{ $match: {} }, { $merge: "users_rollup" }],
            cursor: {},
          },
        }),
        "mongodb"
      )
    ).toBe("destructive");
  });

  it("classifies Redis command batches by command family", () => {
    expect(classifyAiQuerySafety('TYPE "user:1"\nHGETALL "user:1"', "redis")).toBe(
      "read"
    );
    expect(classifyAiQuerySafety('GET "user;1"; TYPE "user;1"', "redis")).toBe(
      "read"
    );
    expect(classifyAiQuerySafety('SET "user:1" "{}"', "redis")).toBe("write");
    expect(classifyAiQuerySafety('GET "user:1"; DEL "user:1"', "redis")).toBe(
      "destructive"
    );
    expect(classifyAiQuerySafety('DEL "user:1"', "redis")).toBe("destructive");
    expect(classifyAiQuerySafety("INFO\nCONFIG GET maxmemory", "redis")).toBe(
      "read"
    );
    expect(classifyAiQuerySafety("CLIENT LIST", "redis")).toBe("read");
    expect(classifyAiQuerySafety("CONFIG SET maxmemory 0", "redis")).toBe(
      "destructive"
    );
    expect(classifyAiQuerySafety("ACL SETUSER app on", "redis")).toBe(
      "destructive"
    );
    expect(classifyAiQuerySafety("CLIENT KILL 127.0.0.1:6379", "redis")).toBe(
      "destructive"
    );
    expect(classifyAiQuerySafety("SCRIPT FLUSH", "redis")).toBe("destructive");
  });

  it("tracks the final Redis SELECT database in a command batch", () => {
    expect(redisSelectedDatabase("SELECT 2\nSET user:1 Ada")).toBe("2");
    expect(redisSelectedDatabase("SELECT 2; SELECT '7'; GET user:1")).toBe("7");
    expect(redisSelectedDatabase("# SELECT 9\nGET user:1")).toBeNull();
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
      classifyAiQuerySafety(
        'POST /_bulk\n{"delete":{"_index":"users","_id":"1"}}',
        "elasticsearch"
      )
    ).toBe("destructive");
    expect(
      classifyAiQuerySafety(
        'POST /_aliases\n{"actions":[{"remove_index":{"index":"users"}}]}',
        "elasticsearch"
      )
    ).toBe("destructive");
    expect(
      classifyAiQuerySafety('{"delete":{"_index":"users","_id":"1"}}', "elasticsearch")
    ).toBe("destructive");
  });
});

describe("SQL execution gate", () => {
  it("blocks mutating SQL from read-only execution", () => {
    const decision = evaluateSqlExecutionIntent({
      sql: "delete from users where id = 1",
      driver: "postgres",
      intent: "read",
      approved: true,
    });

    expect(decision).toMatchObject({
      safety: "destructive",
      allowed: false,
      requiresApproval: false,
    });
  });

  it("keeps destructive SQL out of write execution", () => {
    const decision = evaluateSqlExecutionIntent({
      sql: "drop table users",
      driver: "postgres",
      intent: "write",
      approved: true,
    });

    expect(decision).toMatchObject({
      safety: "destructive",
      allowed: false,
    });
  });

  it("requires approval for destructive execution", () => {
    expect(
      evaluateSqlExecutionIntent({
        sql: "truncate table users",
        driver: "postgres",
        intent: "destructive",
      })
    ).toMatchObject({
      safety: "destructive",
      allowed: false,
      requiresApproval: true,
    });

    expect(
      evaluateSqlExecutionIntent({
        sql: "truncate table users",
        driver: "postgres",
        intent: "destructive",
        approved: true,
      })
    ).toMatchObject({
      safety: "destructive",
      allowed: true,
      requiresApproval: false,
    });
  });

  it("only prompts editor execution for destructive SQL", () => {
    expect(
      editorExecutionConfirmation("select * from users", "postgres")
    ).toMatchObject({
      required: false,
    });
    expect(
      editorExecutionConfirmation("delete from users", "postgres")
    ).toMatchObject({
      required: true,
    });
  });
});
