import { describe, expect, it } from "vitest";
import { sqlSyntaxFallbackCompletions } from "./sqlSyntaxFallback";

function labels(driver: string) {
  return sqlSyntaxFallbackCompletions("", { driver }).map((item) => item.label);
}

describe("SQL syntax fallback statement starters", () => {
  it("keeps PostgreSQL-only statement starters out of MySQL", () => {
    expect(labels("postgres")).toContain("DO");
    expect(labels("mysql")).not.toContain("DO");
  });

  it("keeps SQL Server execution starters product-scoped", () => {
    expect(labels("sqlserver")).toEqual(
      expect.arrayContaining(["EXEC", "EXECUTE", "BEGIN TRANSACTION"]),
    );
    expect(labels("postgres")).not.toContain("EXEC");
  });

  it("recommends Manticore statements only for its SQL surface", () => {
    expect(labels("manticoresearch")).toEqual(
      expect.arrayContaining(["FACET", "SHOW META"]),
    );
    expect(labels("postgres")).not.toContain("FACET");
  });

  it("recommends ClickHouse operational starters only for ClickHouse", () => {
    expect(labels("clickhouse")).toEqual(
      expect.arrayContaining(["OPTIMIZE TABLE", "SYSTEM", "KILL QUERY"]),
    );
    expect(labels("postgres")).not.toContain("OPTIMIZE TABLE");
  });
});
