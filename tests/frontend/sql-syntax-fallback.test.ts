import { describe, expect, it } from "vitest";
import {
  sqlCommandSnippetCompletions,
  sqlSyntaxFallbackCompletions,
} from "@/features/query-editor";

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

  it("recommends cursor-navigable common commands at a statement boundary", () => {
    const snippet = sqlCommandSnippetCompletions("sel", {
      driver: "postgres",
    })[0];

    expect(snippet).toMatchObject({
      label: "sel · select rows",
      insertTextFormat: 2,
      filterText: expect.stringContaining("sel"),
    });
    expect(snippet?.insertText).toContain("LIMIT ${3:100}");
    expect(labels("sel")).toContain("sel · select rows");
  });

  it("adapts bounded SELECT and ALTER templates to the product dialect", () => {
    const body = (driver: string, prefix = "sel") =>
      sqlCommandSnippetCompletions(prefix, { driver })[0]?.insertText;

    expect(body("sqlserver")).toContain("SELECT TOP ${1:100}");
    expect(body("oracle")).toContain("ROWNUM <= ${3:100}");
    expect(body("db2")).toContain("FETCH FIRST ${3:100} ROWS ONLY");
    expect(body("firebird")).toContain("ROWS ${3:100}");
    expect(body("jdbc")).not.toContain("LIMIT");
    expect(body("clickhouse", "upd")).toContain("ALTER TABLE ${1:table}");
    expect(body("dameng", "at")).toContain("ADD (${2:column} ${3:type})");
  });

  it("does not inject SQL commands into native non-SQL editors", () => {
    expect(
      sqlSyntaxFallbackCompletions("", {
        driver: "redis",
        supportsSqlQuery: false,
      }),
    ).toEqual([]);
  });
});
