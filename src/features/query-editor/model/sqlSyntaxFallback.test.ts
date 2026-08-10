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

  it("keeps standard SELECT clause transitions available during LSP recovery", () => {
    expect(
      sqlSyntaxFallbackCompletions("SELECT * FROM orders"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "JOIN", detail: "SELECT continuation" }),
        expect.objectContaining({ label: "WHERE", detail: "SELECT continuation" }),
      ]),
    );
    expect(
      sqlSyntaxFallbackCompletions("SELECT * FROM orders JOIN customers"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "ON", detail: "JOIN condition" }),
        expect.objectContaining({ label: "USING", detail: "JOIN condition" }),
      ]),
    );
    expect(
      sqlSyntaxFallbackCompletions("SELECT customer_id FROM orders GROUP BY customer_id"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "HAVING", detail: "GROUP BY continuation" }),
        expect.objectContaining({ label: "ORDER BY", detail: "GROUP BY continuation" }),
      ]),
    );
  });

  it("does not treat DELETE FROM as a SELECT continuation", () => {
    expect(sqlSyntaxFallbackCompletions("DELETE FROM orders")).toEqual([]);
  });
});
