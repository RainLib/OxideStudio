import { describe, expect, it } from "vitest";
import {
  completionFilterText,
  completionInsertText,
  completionSortText,
  filterCompletionsForSqlContext,
  isCompletedSqlContextKeyword,
  sqlContextKeywordBeforeCursor,
  toLspCompletionContext,
} from "@/lib/lspCompletion";
import { CompletionItemKind, type CompletionItem } from "@/services/lsp/types";

function item(overrides: Partial<CompletionItem>): CompletionItem {
  return {
    label: "id",
    kind: CompletionItemKind.Field,
    ...overrides,
  };
}

describe("LSP completion adapter helpers", () => {
  it("detects completed SQL context keywords", () => {
    expect(isCompletedSqlContextKeyword("from")).toBe(true);
    expect(isCompletedSqlContextKeyword(" WHERE ")).toBe(true);
    expect(isCompletedSqlContextKeyword("fro")).toBe(false);
    expect(isCompletedSqlContextKeyword("order")).toBe(false);
    expect(isCompletedSqlContextKeyword("customer")).toBe(false);
  });

  it("finds the active SQL context keyword before the cursor", () => {
    expect(sqlContextKeywordBeforeCursor("SELECT * from")).toBe("from");
    expect(sqlContextKeywordBeforeCursor("SELECT * from ")).toBe("from");
    expect(sqlContextKeywordBeforeCursor("SELECT * FROM users where ")).toBe(
      "where"
    );
    expect(
      sqlContextKeywordBeforeCursor("SELECT * FROM users where owner ")
    ).toBeNull();
    expect(sqlContextKeywordBeforeCursor("SELECT owner ")).toBeNull();
  });

  it("filters mixed completions after relation context keywords", () => {
    const items = [
      item({ label: "public.webhook", kind: CompletionItemKind.Class }),
      item({ label: "form_background_url", kind: CompletionItemKind.Field }),
      item({ label: "FROM", kind: CompletionItemKind.Keyword }),
    ];

    expect(filterCompletionsForSqlContext(items, "from")).toEqual([
      items[0],
    ]);
  });

  it("filters operators and relation targets at the start of predicates", () => {
    const items = [
      item({ label: "id", kind: CompletionItemKind.Field }),
      item({ label: "!=", kind: CompletionItemKind.Operator }),
      item({ label: "public.form", kind: CompletionItemKind.Class }),
      item({ label: "TRUE", kind: CompletionItemKind.Keyword }),
    ];

    expect(filterCompletionsForSqlContext(items, "where")).toEqual([
      items[0],
      items[3],
    ]);
    expect(filterCompletionsForSqlContext(items, null)).toEqual(items);
  });

  it("inserts after completed clause keywords instead of replacing them", () => {
    expect(completionInsertText(item({ label: "users" }), true)).toBe(" users");
    expect(completionInsertText(item({ label: "users" }), false)).toBe("users");
    expect(
      completionInsertText(
        item({ label: "calculate_score", insertText: "calculate_score()" }),
        true
      )
    ).toBe(" calculate_score()");
  });

  it("prefers server text edits and keeps completed keyword filtering stable", () => {
    const withTextEdit = item({
      label: "users",
      insertText: "users",
      textEdit: {
        range: {
          start: { line: 0, character: 14 },
          end: { line: 0, character: 14 },
        },
        newText: " users",
      },
      filterText: "from",
    });

    expect(completionInsertText(withTextEdit, true)).toBe(" users");
    expect(completionFilterText(withTextEdit, "from", true)).toBe("from");
    expect(completionFilterText(item({ label: "users" }), "from", true)).toBe(
      "from"
    );
    expect(
      completionFilterText(item({ label: "users" }), "users", false)
    ).toBeUndefined();
  });

  it("preserves server sortText and falls back to SQL-aware groups", () => {
    expect(
      completionSortText(item({ label: "name", sortText: "0:name" }))
    ).toBe("0:name");
    expect(completionSortText(item({ label: "id" }))).toBe("0:id");
    expect(
      completionSortText(
        item({ label: "!=", kind: CompletionItemKind.Operator })
      )
    ).toBe("2:!=");
    expect(
      completionSortText(
        item({ label: "WHERE", kind: CompletionItemKind.Keyword })
      )
    ).toBe("3:where");
  });

  it("maps Monaco completion trigger context to LSP trigger context", () => {
    expect(toLspCompletionContext()).toEqual({ triggerKind: 1 });
    expect(toLspCompletionContext({ triggerKind: 0 })).toEqual({
      triggerKind: 1,
    });
    expect(
      toLspCompletionContext({ triggerKind: 1, triggerCharacter: "." })
    ).toEqual({ triggerKind: 2, triggerCharacter: "." });
    expect(toLspCompletionContext({ triggerKind: 2 })).toEqual({
      triggerKind: 3,
    });
  });
});
