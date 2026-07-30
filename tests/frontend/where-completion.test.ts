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

  it("replaces the full identifier under the caret", () => {
    expect(whereReplacementRange("status = 1", 3)).toEqual({
      start: 0,
      end: 6,
    });
    expect(whereReplacementRange("user.email = 1", 7)).toEqual({
      start: 0,
      end: 10,
    });
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

    expect(complete("status = ")).toEqual(
      expect.arrayContaining(["NULL", "TRUE", "FALSE"]),
    );
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
      expect.arrayContaining(["NULL", "TRUE", "FALSE"]),
    );
    expect(complete("status IS NULL ")).toEqual(
      expect.arrayContaining(["AND", "OR"]),
    );
    expect(complete("status IN (")).toEqual(
      expect.arrayContaining(["NULL", "TRUE", "FALSE"]),
    );
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
