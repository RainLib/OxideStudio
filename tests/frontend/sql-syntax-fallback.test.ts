import { describe, expect, it } from "vitest";
import { sqlSyntaxFallbackCompletions } from "@/features/query-editor";

function labels(source: string) {
  return sqlSyntaxFallbackCompletions(source).map((item) => item.label);
}

describe("SQL syntax fallback completions", () => {
  it("offers a fresh statement after a completed prior query", () => {
    expect(labels("SELECT id FROM audit.events;\nSEL")).toContain("SELECT");
    expect(labels("SELECT id FROM audit.events;\nSELECT ")).toEqual(
      expect.arrayContaining(["DISTINCT", "*", "FROM"]),
    );
  });

  it("recovers a blank-line-separated second statement even when the first query has no semicolon", () => {
    const secondStatement = `SELECT *
FROM ai_message_feedback AS amf
LIMIT 100


SELECT`;

    expect(labels(secondStatement)).toEqual(
      expect.arrayContaining(["DISTINCT", "*", "FROM"]),
    );
  });

  it("keeps condition operators available after WHERE and a field", () => {
    expect(labels("SELECT * FROM events WHERE ")).toEqual(
      expect.arrayContaining(["=", "IN", "IS NULL", "AND"]),
    );
    expect(labels("SELECT * FROM events WHERE status ")).toEqual(
      expect.arrayContaining(["=", "LIKE", "BETWEEN", "OR"]),
    );
  });

  it("offers ordering directions after the selected sort field", () => {
    expect(labels("SELECT * FROM events ORDER BY created_at ")).toEqual(
      expect.arrayContaining(["ASC", "DESC", "NULLS LAST"]),
    );
  });

  it("keeps predicate and sorting continuations after quoted identifiers", () => {
    expect(labels('SELECT * FROM events WHERE "order" ')).toEqual(
      expect.arrayContaining(["=", "IN", "IS NOT NULL"]),
    );
    expect(labels("SELECT * FROM events WHERE `status-code` ")).toEqual(
      expect.arrayContaining(["=", "LIKE", "BETWEEN"]),
    );
    expect(labels("SELECT * FROM events WHERE [status code] ")).toEqual(
      expect.arrayContaining(["=", "NOT IN"]),
    );
    expect(labels('SELECT * FROM events ORDER BY public."created at" ')).toEqual(
      expect.arrayContaining(["ASC", "DESC"]),
    );
  });

  it("does not restart syntax context for a delimiter inside a literal", () => {
    expect(labels("SELECT ';' AS marker WHERE ")).toEqual(
      expect.arrayContaining(["=", "IN", "IS NULL"]),
    );
  });
});
