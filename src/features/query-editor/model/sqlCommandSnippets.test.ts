import { describe, expect, it } from "vitest";
import { sqlCommandSnippetCompletions } from "./sqlCommandSnippets";

describe("sqlCommandSnippetCompletions", () => {
  it("ranks an exact snippet trigger before ordinary fallback keywords", () => {
    const [item] = sqlCommandSnippetCompletions("sel", { driver: "postgres" });

    expect(item).toMatchObject({
      label: "select rows",
      insertTextFormat: 2,
    });
    expect(item?.sortText).toMatch(/^0:/);
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
});
