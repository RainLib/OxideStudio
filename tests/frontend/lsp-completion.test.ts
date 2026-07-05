import { describe, expect, it } from "vitest";
import {
  completionInsertText,
  completionSortText,
  isCompletedSqlContextKeyword,
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
