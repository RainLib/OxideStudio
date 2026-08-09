import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "@/services/lsp/types";
import { lspCompletionItemsToMonacoSuggestions } from "./lspCompletionPresentation";

class MockRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

const monaco = {
  Range: MockRange,
  languages: {
    CompletionItemInsertTextRule: {
      None: 0,
      KeepWhitespace: 1,
      InsertAsSnippet: 4,
    },
    CompletionItemKind: {
      Field: 4,
      Text: 18,
    },
    CompletionItemTag: {
      Deprecated: 1,
    },
  },
};

describe("lspCompletionItemsToMonacoSuggestions", () => {
  it("preserves label details, insert/replace boundaries, and whitespace mode", () => {
    const [suggestion] = lspCompletionItemsToMonacoSuggestions({
      monaco,
      items: [
        {
          label: "customer_id",
          labelDetails: {
            detail: " uuid",
            description: "orders",
          },
          kind: CompletionItemKind.Field,
          insertTextFormat: 2,
          insertTextMode: 1,
          textEdit: {
            newText: "${1:customer_id}",
            insert: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 7 },
            },
            replace: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 11 },
            },
          },
        },
      ],
      typedWord: "cus",
      completedContextKeyword: false,
      defaultRange: new MockRange(1, 1, 1, 1),
      rankByUsage: false,
      usageScope: "postgres",
      recordUsageCommand: "record",
      appendSpace: false,
    });

    expect(suggestion?.label).toEqual({
      label: "customer_id",
      detail: " uuid",
      description: "orders",
    });
    expect(suggestion?.insertTextRules).toBe(5);
    expect(suggestion?.range).toEqual({
      insert: new MockRange(3, 5, 3, 8),
      replace: new MockRange(3, 5, 3, 12),
    });
  });
});
