import { describe, expect, it } from "vitest";
import { cachedSqlProjectionSources } from "./queryEditorCachedCompletion";

describe("cachedSqlProjectionSources", () => {
  it("maps single-table aliases and direct renamed projections", () => {
    expect(
      cachedSqlProjectionSources(
        "SELECT u.id, u.created_at AS createdAt FROM audit.users u",
        ["id", "createdAt"],
      ),
    ).toEqual([
      { schema: "audit", tableName: "users", sourceColumn: "id" },
      { schema: "audit", tableName: "users", sourceColumn: "created_at" },
    ]);
  });

  it("maps qualified join columns to their exact physical sources", () => {
    expect(
      cachedSqlProjectionSources(
        "SELECT o.id, c.email, o.total * 1 AS computed FROM sales.orders o JOIN crm.customers c ON c.id = o.customer_id",
        ["id", "email", "computed"],
      ),
    ).toEqual([
      { schema: "sales", tableName: "orders", sourceColumn: "id" },
      { schema: "crm", tableName: "customers", sourceColumn: "email" },
      undefined,
    ]);
  });

  it("fails closed for ambiguous unqualified joins and mixed wildcards", () => {
    expect(
      cachedSqlProjectionSources(
        "SELECT id FROM orders o JOIN customers c ON c.id = o.customer_id",
        ["id"],
      ),
    ).toEqual([undefined]);
    expect(
      cachedSqlProjectionSources("SELECT o.*, c.name FROM orders o JOIN customers c ON true", ["id", "name"]),
    ).toEqual([undefined, undefined]);
  });

  it("maps a sole physical wildcard and rejects CTE or multi-statement ambiguity", () => {
    expect(
      cachedSqlProjectionSources("SELECT * FROM public.users", ["id", "name"]),
    ).toEqual([
      { schema: "public", tableName: "users", sourceColumn: "id" },
      { schema: "public", tableName: "users", sourceColumn: "name" },
    ]);
    expect(
      cachedSqlProjectionSources("WITH x AS (SELECT * FROM users) SELECT * FROM x", ["id"]),
    ).toEqual([undefined]);
    expect(
      cachedSqlProjectionSources("SELECT 1; SELECT id FROM users", ["id"]),
    ).toEqual([undefined]);
  });

  it("accepts one trailing terminator and validates wildcard qualifiers", () => {
    expect(
      cachedSqlProjectionSources("SELECT u.* FROM public.users AS u; -- done", [
        "id",
        "name",
      ]),
    ).toEqual([
      { schema: "public", tableName: "users", sourceColumn: "id" },
      { schema: "public", tableName: "users", sourceColumn: "name" },
    ]);
    expect(
      cachedSqlProjectionSources("SELECT other.* FROM public.users AS u", ["id"]),
    ).toEqual([undefined]);
  });

  it("rejects set operations, derived wildcard sources and multipart column guesses", () => {
    expect(
      cachedSqlProjectionSources(
        "SELECT u.id FROM public.users u UNION SELECT a.id FROM audit.users a",
        ["id"],
      ),
    ).toEqual([undefined]);
    expect(
      cachedSqlProjectionSources("SELECT * FROM (SELECT id FROM users) u", ["id"]),
    ).toEqual([undefined]);
    expect(
      cachedSqlProjectionSources("SELECT public.users.id FROM public.users", ["id"]),
    ).toEqual([undefined]);
  });
});
