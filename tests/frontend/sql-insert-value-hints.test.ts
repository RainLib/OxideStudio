import { describe, expect, it } from "vitest";
import {
  findEnclosingDollarQuoteBodyStart,
  sqlInsertValueHints,
} from "@/lib/sqlInsertValueHints";

describe("sqlInsertValueHints", () => {
  it("labels each explicit INSERT VALUES expression, including repeated rows", () => {
    const sql = "INSERT INTO public.users (id, name, enabled) VALUES (1, 'Ada', TRUE), (2, 'Lin', FALSE);";
    const hints = sqlInsertValueHints(sql);

    expect(hints.map((hint) => hint.column)).toEqual([
      "id",
      "name",
      "enabled",
      "id",
      "name",
      "enabled",
    ]);
    expect(hints.map((hint) => sql.slice(hint.offset, hint.offset + 1))).toEqual([
      "1",
      "'",
      "T",
      "2",
      "'",
      "F",
    ]);
  });

  it("does not inspect implicit columns, strings, or comments", () => {
    expect(sqlInsertValueHints("INSERT INTO users VALUES (1, 'Ada')")).toEqual([]);
    expect(
      sqlInsertValueHints("-- INSERT INTO hidden (a) VALUES (1)\nSELECT 'INSERT INTO hidden (a) VALUES (2)';"),
    ).toEqual([]);
  });

  it("keeps commas in nested expressions and quoted identifiers positional", () => {
    const sql = 'INSERT INTO "users" ("id", "payload") VALUES (coalesce(1, 2), json_object(\'name\', \'Ada\'));';
    const hints = sqlInsertValueHints(sql);

    expect(hints.map((hint) => hint.column)).toEqual(["id", "payload"]);
    expect(sql.slice(hints[1]?.offset || 0, (hints[1]?.offset || 0) + 4)).toBe("json");
  });

  it("labels INSERT SELECT projections and skips modifiers", () => {
    const sql =
      "INSERT INTO users (name, row_count) SELECT DISTINCT TOP (10) coalesce(first_name, last_name), count(*) FROM staging";
    const hints = sqlInsertValueHints(sql);

    expect(hints.map((hint) => hint.column)).toEqual(["name", "row_count"]);
    expect(sql.slice(hints[0]?.offset || 0)).toMatch(/^coalesce/);
    expect(sql.slice(hints[1]?.offset || 0)).toMatch(/^count/);
  });

  it("supports DISTINCT ON, parenthesized SELECT, and CTE sources", () => {
    const sql = [
      "INSERT INTO users (id, name) SELECT DISTINCT ON (tenant_id) source_id, source_name FROM staging;",
      "INSERT INTO users (id, name) (SELECT source_id, source_name FROM staging);",
      "INSERT INTO users (id, name) WITH staged AS (SELECT 1) SELECT source_id, source_name FROM staged;",
    ].join("\n");

    expect(sqlInsertValueHints(sql).map((hint) => hint.column)).toEqual([
      "id",
      "name",
      "id",
      "name",
      "id",
      "name",
    ]);
  });

  it("fails closed for SELECT wildcards and target/source arity mismatches", () => {
    for (const sql of [
      "INSERT INTO users (id, name) SELECT * FROM staging",
      "INSERT INTO users (id, name) SELECT source.* FROM staging source",
      "INSERT INTO users (id, name) SELECT source_id FROM staging",
      "INSERT INTO users (id, name) SELECT source_id, source_name, extra FROM staging",
    ]) {
      expect(sqlInsertValueHints(sql), sql).toEqual([]);
    }
  });

  it("locates an enclosing dollar-quoted routine body without trusting noise", () => {
    const sql = [
      "SELECT '$fake$'; -- $comment$",
      "CREATE FUNCTION copy_rows() RETURNS void AS $oxide$",
      "BEGIN",
      "INSERT INTO users (id, name) SELECT source_id, source_name FROM staging;",
      "END",
      "$oxide$ LANGUAGE plpgsql;",
    ].join("\n");
    const insert = sql.indexOf("INSERT INTO");
    const bodyStart = findEnclosingDollarQuoteBodyStart(sql, insert);

    expect(bodyStart).toBe(sql.indexOf("$oxide$") + "$oxide$".length);
    expect(findEnclosingDollarQuoteBodyStart(sql, sql.length)).toBeNull();
  });
});
