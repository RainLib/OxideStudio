import { describe, expect, it } from "vitest";
import {
  buildWhereCompletionDocument,
  localWhereCompletionCandidates,
  mergeWhereCompletionCandidates,
  whereReplacementRange,
} from "@/lib/whereCompletion";
import { CompletionItemKind } from "@/services/lsp/types";

describe("table WHERE completion", () => {
  it.each([
    ["postgres", 'SELECT * FROM "public"."users" WHERE status = 1;'],
    ["mysql", "SELECT * FROM `app`.`users` WHERE status = 1;"],
  ] as const)("builds a dialect-aware virtual %s document", (driver, text) => {
    const document = buildWhereCompletionDocument({
      condition: "status = 1",
      cursorOffset: 6,
      driver,
      schema: driver === "postgres" ? "public" : "app",
      table: "users",
    });
    expect(document.text).toBe(text);
    expect(document.text.slice(document.conditionStart)).toBe("status = 1;");
    expect(document.character).toBe(document.conditionStart + 6);
  });

  it.each([
    ['"status code"', "postgres"],
    ["`status code`", "mysql"],
    ["[status code]", "sqlserver"],
    ['public."status code"', "postgres"],
  ])("continues a quoted or qualified %s field with predicate operators", (reference, driver) => {
    const candidates = localWhereCompletionCandidates({
      condition: `${reference} `,
      cursorOffset: reference.length + 1,
      driver,
      columns: [{ name: "status code", type: "text" }],
    });

    expect(candidates.map((candidate) => candidate.label)).toEqual(
      expect.arrayContaining(["=", "IN", "BETWEEN", "IS NULL"]),
    );
    expect(candidates.map((candidate) => candidate.label)).not.toContain("status code");
  });

  it("replaces the full identifier under the caret", () => {
    expect(whereReplacementRange("status = 1", 3)).toEqual({
      start: 0,
      end: 6,
    });
    expect(whereReplacementRange("user.email = 1", 7)).toEqual({
      start: 0,
      end: 10,
    });
    expect(whereReplacementRange('"status code" = 1', 7)).toEqual({
      start: 0,
      end: 13,
    });
    expect(whereReplacementRange('"sta', 4)).toEqual({ start: 0, end: 4 });
  });

  it("supports prefix, middle, and abbreviation matching like an IDE popup", () => {
    const columns = [
      { name: "created_at", type: "timestamp" },
      { name: "customerAccountId", type: "uuid" },
      { name: "status", type: "text" },
    ];
    const labels = (condition: string) =>
      localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver: "postgres",
        columns,
      }).map((item) => item.label);

    expect(labels("sta")[0]).toBe("status");
    expect(labels("count")).toContain("customerAccountId");
    expect(labels("cai")).toContain("customerAccountId");
  });

  it("switches from columns to values and boolean continuations by predicate phase", () => {
    const complete = (condition: string) =>
      localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver: "postgres",
        columns: [{ name: "status", type: "text" }],
      }).map((item) => item.label);

    expect(complete("status = ")).toEqual(expect.arrayContaining(["''", "'%…%'", "NULL"]));
    expect(complete("status = ")).not.toContain("status");
    expect(complete("status = 'active' ")).toEqual(
      expect.arrayContaining(["AND", "OR"]),
    );
    expect(complete("status = 'active' ")).not.toContain("status");
    expect(complete("status ")).toEqual(
      expect.arrayContaining(["=", "IN", "BETWEEN", "IS NULL"]),
    );
    expect(complete("status BETWEEN 1 ")).toEqual(["AND"]);
    expect(complete("status BETWEEN 1 AND ")).toEqual(
      expect.arrayContaining(["''", "'%…%'", "NULL"]),
    );
    expect(complete("status IS NULL ")).toEqual(
      expect.arrayContaining(["AND", "OR"]),
    );
    expect(complete("status IN (")).toEqual(expect.arrayContaining(["''", "'%…%'", "NULL"]));
    expect(complete("status IN ('active' ")).toEqual(
      expect.arrayContaining([",", ")"]),
    );
    expect(complete("status IN ('active', ")).toEqual(
      expect.arrayContaining(["''", "'%…%'", "NULL"]),
    );
    expect(complete("status NOT IN (1 ")).toEqual(
      expect.arrayContaining([",", ")"]),
    );
  });

  it("completes IS and NOT predicate branches instead of falling back to columns", () => {
    const complete = (condition: string) =>
      localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver: "postgres",
        columns: [{ name: "status", type: "text" }],
      }).map((item) => item.label);

    expect(complete("status IS ")).toEqual(
      expect.arrayContaining(["NULL", "NOT NULL", "TRUE", "FALSE"]),
    );
    expect(complete("status NOT ")).toEqual(
      expect.arrayContaining(["IN", "LIKE", "BETWEEN"]),
    );
    expect(complete("status IS ")).not.toContain("status");
    expect(complete("status NOT ")).not.toContain("status");
  });

  it("uses the predicate column type for useful value snippets", () => {
    const complete = (condition: string, columns: Array<{ name: string; type: string }>) =>
      localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver: "postgres",
        columns,
      }).map((item) => item.label);

    expect(complete("enabled = ", [{ name: "enabled", type: "boolean" }])).toEqual(
      expect.arrayContaining(["TRUE", "FALSE", "NULL"]),
    );
    expect(complete("enabled = ", [{ name: "enabled", type: "boolean" }])).not.toContain(
      "CURRENT_TIMESTAMP",
    );
    expect(
      complete("created_at >= ", [{ name: "created_at", type: "timestamp with time zone" }]),
    ).toEqual(expect.arrayContaining(["CURRENT_DATE", "CURRENT_TIMESTAMP", "NULL"]));
    expect(complete("amount > ", [{ name: "amount", type: "numeric(12,2)" }])).toEqual(
      expect.arrayContaining(["0", "1", "NULL"]),
    );
    expect(complete("name LIKE ", [{ name: "name", type: "varchar" }])).toEqual(
      expect.arrayContaining(["''", "'%…%'", "NULL"]),
    );
    const likePattern = localWhereCompletionCandidates({
      condition: "name LIKE ",
      cursorOffset: "name LIKE ".length,
      driver: "postgres",
      columns: [{ name: "name", type: "varchar" }],
    }).find((candidate) => candidate.label === "'%…%'");
    expect(likePattern).toMatchObject({
      insertText: "'%%' ",
      cursorOffsetFromEnd: 3,
    });
  });

  it.each([
    ["postgres", '"order"'],
    ["mysql", "`order`"],
  ] as const)("quotes reserved %s column names", (driver, identifier) => {
    expect(
      localWhereCompletionCandidates({
        condition: "ord",
        cursorOffset: 3,
        driver,
        columns: [{ name: "order" }],
      })[0]?.insertText,
    ).toBe(`${identifier} = `);
  });

  it.each([
    ['"sta', "postgres", '"status code" = '],
    ["`sta", "mysql", "`status code` = "],
    ["[sta", "sqlserver", "[status code] = ", "["],
  ])("matches an unfinished quoted %s identifier without leaving duplicate quotes", (condition, driver, expectedInsert, identifierQuote) => {
    const candidate = localWhereCompletionCandidates({
      condition,
      cursorOffset: condition.length,
      driver,
      identifierQuote,
      columns: [{ name: "status code", type: "text" }],
    })[0];
    expect(candidate?.label).toBe("status code");

    const range = whereReplacementRange(condition, condition.length);
    const next =
      condition.slice(0, range.start) +
      candidate!.insertText +
      condition.slice(range.end);
    expect(next).toBe(expectedInsert);
  });

  it("keeps the local predicate workflow while using authoritative LSP metadata", () => {
    const merged = mergeWhereCompletionCandidates(
      [
        {
          label: "status",
          insertText: "status = ",
          detail: "Current table column",
          kind: CompletionItemKind.Field,
          sortText: "0:0000",
          source: "local",
        },
      ],
      [
        {
          label: "status",
          insertText: '"status"',
          detail: "public.users.status (text)",
          kind: CompletionItemKind.Field,
          sortText: "0001",
        },
      ],
    );
    expect(merged).toEqual([
      expect.objectContaining({
        label: "status",
        insertText: "status = ",
        detail: "public.users.status (text)",
        source: "lsp",
      }),
    ]);
  });
});
