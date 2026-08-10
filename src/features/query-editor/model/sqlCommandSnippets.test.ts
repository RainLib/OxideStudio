import { describe, expect, it } from "vitest";
import { sqlCommandSnippetCompletions } from "./sqlCommandSnippets";

describe("sqlCommandSnippetCompletions", () => {
  it("ranks an exact snippet trigger before ordinary fallback keywords", () => {
    const [item] = sqlCommandSnippetCompletions("sel", { driver: "postgres" });

    expect(item).toMatchObject({
      label: "select rows",
      labelDetails: {
        detail: "  sel",
        description: "SQL snippet",
      },
      insertTextFormat: 2,
    });
    expect(item?.sortText).toMatch(/^0:/);
  });

  it("finds common commands from their descriptive initials", () => {
    const [item] = sqlCommandSnippetCompletions("sr", {
      driver: "postgres",
    });

    expect(item?.label).toBe("select rows");
    expect(item?.filterText).toBe("sr");
  });

  it("keeps matching by descriptive label after typing past a short trigger", () => {
    const [item] = sqlCommandSnippetCompletions("sele", {
      driver: "postgres",
    });

    expect(item?.label).toBe("select rows");
  });

  it.each([
    ["sqlserver", "SELECT TOP ${1:100} ${2:*}\nFROM ${3:table};"],
    ["oracle", "SELECT ${1:*}\nFROM ${2:table}\nWHERE ROWNUM <= ${3:100};"],
    ["db2", "SELECT ${1:*}\nFROM ${2:table}\nFETCH FIRST ${3:100} ROWS ONLY;"],
  ])("uses the %s row-limit syntax", (driver, expected) => {
    const [item] = sqlCommandSnippetCompletions("sel", { driver });
    expect(item?.insertText).toBe(expected);
  });

  it("offers cursor-navigable code blocks aligned with DBX", () => {
    expect(sqlCommandSnippetCompletions("join")[0]?.insertText).toBe(
      "JOIN ${1:table} ON ${2:left_column} = ${3:right_column}",
    );
    expect(sqlCommandSnippetCompletions("case")[0]?.insertText).toContain(
      "WHEN ${1:condition} THEN ${2:value}",
    );
    expect(sqlCommandSnippetCompletions("nex")[0]?.insertText).toContain(
      "NOT EXISTS",
    );
  });

  it("applies the editor keyword case without changing placeholders", () => {
    const [item] = sqlCommandSnippetCompletions("cte", {
      keywordCase: "lower",
    });

    expect(item?.insertText).toBe(
      "with ${1:name} as (\n  select ${2:*}\n  from ${3:table}\n)\nselect *\nfrom ${1:name};",
    );
  });

  it("cases generated product functions independently from SQL keywords", () => {
    expect(
      sqlCommandSnippetCompletions("dmdt", {
        driver: "dameng",
        keywordCase: "upper",
        functionCase: "lower",
      })[0]?.insertText,
    ).toBe("SELECT sysdate(), current_date(), current_timestamp();");
    expect(
      sqlCommandSnippetCompletions("match", {
        driver: "manticoresearch",
        keywordCase: "lower",
        functionCase: "upper",
      })[0]?.insertText,
    ).toBe("MATCH('${1:query}')");
  });

  it("does not expose SQL templates for non-SQL capabilities", () => {
    expect(
      sqlCommandSnippetCompletions("sel", { supportsSqlQuery: false }),
    ).toEqual([]);
  });

  it("adds Manticore-only full-text and inspection commands", () => {
    expect(
      sqlCommandSnippetCompletions("match", {
        driver: "manticoresearch",
      })[0],
    ).toMatchObject({
      label: "match query",
      insertText: "MATCH('${1:query}')",
    });
    expect(
      sqlCommandSnippetCompletions("meta", { driver: "postgres" }),
    ).toEqual([]);
  });

  it("adds Oracle-family MERGE and PL/SQL blocks without leaking them", () => {
    expect(
      sqlCommandSnippetCompletions("merge", { driver: "oracle" })[0],
    ).toMatchObject({
      label: "merge rows",
      insertText:
        "MERGE INTO ${1:target_table} ${2:t}\nUSING ${3:source_table} ${4:s}\nON (${5:t.id = s.id})\nWHEN MATCHED THEN\n  UPDATE SET ${6:t.value = s.value}\nWHEN NOT MATCHED THEN\n  INSERT (${7:id, value})\n  VALUES (${8:s.id, s.value});",
    });
    expect(
      sqlCommandSnippetCompletions("plsql", {
        driver: "oceanbase-oracle",
        keywordCase: "lower",
      })[0]?.insertText,
    ).toContain("declare\n  ${1:variable_name} ${2:VARCHAR2(100)};");
    expect(
      sqlCommandSnippetCompletions("merge", { driver: "postgres" }),
    ).toEqual([]);
  });

  it("keeps conflict-aware INSERT blocks scoped to their product syntax", () => {
    expect(
      sqlCommandSnippetCompletions("upsert", { driver: "postgres" })[0],
    ).toMatchObject({
      label: "upsert row",
      insertText:
        "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})\nON CONFLICT (${4:conflict_column}) DO UPDATE\nSET ${5:column} = EXCLUDED.${5:column};",
    });
    expect(
      sqlCommandSnippetCompletions("upsert", { driver: "mysql" })[0],
    ).toMatchObject({
      label: "upsert row",
      insertText:
        "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})\nON DUPLICATE KEY UPDATE\n${4:column} = VALUES(${4:column});",
    });
    expect(
      sqlCommandSnippetCompletions("upsert", { driver: "sqlserver" }),
    ).toEqual([]);
  });

  it("offers SQL Server MERGE without exposing it to PostgreSQL", () => {
    expect(
      sqlCommandSnippetCompletions("merge", { driver: "sqlserver" })[0],
    ).toMatchObject({
      label: "merge rows",
      insertText: expect.stringContaining("MERGE INTO ${1:target_table} AS ${2:t}"),
    });
    expect(
      sqlCommandSnippetCompletions("merge", { driver: "postgres" }),
    ).toEqual([]);
  });

  it("allows an explicit Oracle product snippet override", () => {
    const [item] = sqlCommandSnippetCompletions("merge", {
      driver: "oracle",
      snippets: [
        {
          id: "builtin-oracle-merge",
          prefix: "merge",
          label: "custom merge",
          detail: "Custom Oracle merge",
          body: "MERGE CUSTOM ${1:body}",
          enabled: true,
        },
      ],
    });
    expect(item?.label).toBe("custom merge");
    expect(item?.insertText).toBe("MERGE CUSTOM ${1:body}");
  });

  it("keeps Db2 registers bare and Dameng date functions parenthesized", () => {
    expect(
      sqlCommandSnippetCompletions("regs", { driver: "db2" })[0],
    ).toMatchObject({
      label: "current special registers",
      insertText:
        "VALUES (CURRENT DATE, CURRENT TIME, CURRENT TIMESTAMP, CURRENT USER);",
    });
    expect(
      sqlCommandSnippetCompletions("dmdt", { driver: "dameng" })[0],
    ).toMatchObject({
      label: "Dameng current date/time",
      insertText: "SELECT SYSDATE(), CURRENT_DATE(), CURRENT_TIMESTAMP();",
    });
    expect(
      sqlCommandSnippetCompletions("regs", { driver: "dameng" }),
    ).toEqual([]);
    expect(
      sqlCommandSnippetCompletions("dmdt", { driver: "db2" }),
    ).toEqual([]);
  });

  it("keeps ClickHouse maintenance and mutation blocks product-scoped", () => {
    expect(
      sqlCommandSnippetCompletions("chdel", { driver: "clickhouse" })[0],
    ).toMatchObject({
      label: "delete rows (ClickHouse mutation)",
      insertText: "ALTER TABLE ${1:table}\nDELETE WHERE ${2:condition};",
    });
    expect(
      sqlCommandSnippetCompletions("optimize", { driver: "clickhouse" })[0],
    ).toMatchObject({
      label: "optimize table",
      insertText: "OPTIMIZE TABLE ${1:table} FINAL;",
    });
    expect(
      sqlCommandSnippetCompletions("chdel", { driver: "postgres" }),
    ).toEqual([]);
  });
});
