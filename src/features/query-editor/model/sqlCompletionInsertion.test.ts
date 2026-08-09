import { describe, expect, it } from "vitest";
import { CompletionItemKind, type CompletionItem } from "@/services/lsp/types";
import { sqlFunctionCompletionInsertion } from "./sqlCompletionInsertion";

describe("sqlFunctionCompletionInsertion", () => {
  it("creates linked Monaco fields from an LSP function signature", () => {
    const item: CompletionItem = {
      label: "date_trunc",
      kind: CompletionItemKind.Function,
      detail: "date_trunc(field: text, source: timestamp)",
    };

    expect(sqlFunctionCompletionInsertion(item, "date_trunc")).toEqual({
      insertText: "date_trunc(${1:field}, ${2:source})",
      insertAsSnippet: true,
    });
  });

  it("keeps nested type commas inside one parameter", () => {
    const item: CompletionItem = {
      label: "round_decimal",
      kind: CompletionItemKind.Function,
      detail: "round_decimal(value decimal(18, 4), scale integer)",
    };

    expect(sqlFunctionCompletionInsertion(item, "round_decimal").insertText).toBe(
      "round_decimal(${1:value}, ${2:scale})",
    );
  });

  it("does not override authoritative server edits or an existing parenthesis", () => {
    const item: CompletionItem = {
      label: "count",
      kind: CompletionItemKind.Function,
      detail: "count(value)",
      textEdit: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        newText: "COUNT()",
      },
    };

    expect(sqlFunctionCompletionInsertion(item, "COUNT()"))
      .toEqual({ insertText: "COUNT()", insertAsSnippet: false });
    expect(sqlFunctionCompletionInsertion({ ...item, textEdit: undefined }, "count", "("))
      .toEqual({ insertText: "count", insertAsSnippet: false });
  });
});
