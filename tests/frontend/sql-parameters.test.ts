import { describe, expect, it } from "vitest";
import {
  compileSqlParameters,
  extractSqlParameters,
  quoteSqlText,
} from "@/lib/sqlParameters";

describe("SQL parameter compilation", () => {
  it("groups numbered and named placeholders but keeps anonymous positions distinct", () => {
    const parameters = extractSqlParameters(
      "SELECT $1, $1, ?, ?, ?2, ?2, :id, :id, @id, {{id}}, ${id}, %(id)s"
    );

    expect(parameters.map(({ label, occurrences }) => [label, occurrences])).toEqual([
      ["$1", 2],
      ["? #1", 1],
      ["? #2", 1],
      ["?2", 2],
      [":id", 2],
      ["@id", 1],
      ["{{id}}", 1],
      ["${id}", 1],
      ["%(id)s", 1],
    ]);
  });

  it("quotes text safely and supports explicit raw SQL and NULL values", () => {
    const sql = "SELECT * FROM users WHERE name = :name AND age > :age AND deleted_at IS :deleted";
    const [name, age, deleted] = extractSqlParameters(sql);
    const result = compileSqlParameters(sql, {
      [name.key]: { mode: "quoted", value: "O'Reilly'; DROP TABLE users; --" },
      [age.key]: { mode: "raw", value: "  21  " },
      [deleted.key]: { mode: "null" },
    });

    expect(result.issues).toEqual([]);
    expect(result.sql).toBe(
      "SELECT * FROM users WHERE name = 'O''Reilly''; DROP TABLE users; --' AND age > 21 AND deleted_at IS NULL"
    );
    expect(quoteSqlText("")).toBe("''");
  });

  it("uses injection-safe text representations for PostgreSQL and MySQL", () => {
    const hostile = "x\\'; DROP TABLE users; -- $oxide$ 馃榾";

    expect(quoteSqlText(hostile, "postgres")).toBe(
      "$oxide_1$x\\'; DROP TABLE users; -- $oxide$ 馃榾$oxide_1$"
    );
    expect(quoteSqlText(hostile, "mysql")).toMatch(
      /^CONVERT\(0x[0-9a-f]+ USING utf8mb4\)$/
    );
    expect(quoteSqlText(hostile, "mysql")).not.toContain("DROP TABLE");
  });

  it("leaves unresolved tokens visible and reports every missing or invalid value", () => {
    const sql = "SELECT :missing, :raw_value";
    const [, raw] = extractSqlParameters(sql);
    const result = compileSqlParameters(sql, {
      [raw.key]: { mode: "raw", value: "   " },
    });

    expect(result.sql).toBe(sql);
    expect(result.issues.map((issue) => issue.label)).toEqual([
      ":missing",
      ":raw_value",
    ]);
  });

  it("never replaces placeholder-like text in quoted, commented, or dollar-quoted regions", () => {
    const sql = `
      SELECT ':inside', "@inside", \`{{inside}}\`;
      -- :comment
      /* ${"${block}"} */
      DO $body$ BEGIN RAISE NOTICE '%(inside)s'; END $body$;
      SELECT :outside;
    `;
    const [outside] = extractSqlParameters(sql);
    const result = compileSqlParameters(sql, {
      [outside.key]: { mode: "quoted", value: "safe" },
    });

    expect(result.issues).toEqual([]);
    expect(result.sql).toContain("SELECT ':inside', \"@inside\", `{{inside}}`");
    expect(result.sql).toContain("-- :comment");
    expect(result.sql).toContain("/* ${block} */");
    expect(result.sql).toContain("$body$ BEGIN RAISE NOTICE '%(inside)s'; END $body$");
    expect(result.sql).toContain("SELECT 'safe'");
  });

  it("does not prompt for PostgreSQL JSON existence operators", () => {
    const parameters = extractSqlParameters(
      "SELECT payload ? 'enabled' FROM events WHERE id = ?",
      "postgres"
    );

    expect(parameters.map((parameter) => parameter.token)).toEqual(["?"]);
  });

  it("keeps parameters after PostgreSQL JSON hash operators", () => {
    const parameters = extractSqlParameters(
      "SELECT payload #> :path, payload #>> :text_path, payload #- :remove_path FROM events",
      "postgres"
    );

    expect(parameters.map((parameter) => parameter.token)).toEqual([
      ":path",
      ":text_path",
      ":remove_path",
    ]);
  });
});
