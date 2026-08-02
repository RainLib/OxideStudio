import { beforeEach, describe, expect, it } from "vitest";
import { lspCompletionItemsToMonacoSuggestions } from "@/features/query-editor";
import {
  recordCompletionUsage,
  resetCompletionUsageCacheForTests,
} from "@/lib/completionUsage";
import { CompletionItemKind } from "@/services/lsp/types";

class TestRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

const monaco = {
  Range: TestRange,
  languages: {
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    CompletionItemKind: {
      Text: 0,
      Method: 1,
      Function: 2,
      Constructor: 3,
      Field: 4,
      Variable: 5,
      Class: 6,
      Interface: 7,
      Module: 8,
      Property: 9,
      Unit: 10,
      Value: 11,
      Enum: 12,
      Keyword: 13,
      Snippet: 14,
      Color: 15,
      File: 16,
      Reference: 17,
      Folder: 18,
      EnumMember: 19,
      Constant: 20,
      Struct: 21,
      Event: 22,
      Operator: 23,
      TypeParameter: 24,
    },
  },
};

describe("query editor LSP completion presentation", () => {
  beforeEach(() => resetCompletionUsageCacheForTests());

  it("preserves snippet, documentation and server text edit semantics", () => {
    const fallbackRange = new TestRange(2, 1, 2, 5);
    const [suggestion] = lspCompletionItemsToMonacoSuggestions({
      monaco,
      items: [
        {
          label: "coalesce",
          kind: CompletionItemKind.Function,
          detail: "SQL function",
          documentation: "Return the first non-null value.",
          insertTextFormat: 2,
          textEdit: {
            range: {
              start: { line: 4, character: 3 },
              end: { line: 4, character: 6 },
            },
            newText: "coalesce(${1:value}, ${2:fallback})",
          },
          preselect: true,
        },
      ],
      typedWord: "coa",
      completedContextKeyword: false,
      defaultRange: fallbackRange,
      rankByUsage: false,
      usageScope: "project:connection:schema",
      recordUsageCommand: "record-completion",
      appendSpace: true,
      nextCharacter: "",
    });

    expect(suggestion).toMatchObject({
      label: "coalesce",
      kind: 2,
      detail: "SQL function",
      documentation: "Return the first non-null value.",
      insertText: "coalesce(${1:value}, ${2:fallback})",
      insertTextRules: 4,
      preselect: true,
      range: new TestRange(5, 4, 5, 7),
    });
    expect(suggestion.command).toBeUndefined();
  });

  it("uses the caller range and records a scoped usage command", () => {
    const scope = "project:connection:schema";
    recordCompletionUsage(scope, "customer_id", 1_000);
    const fallbackRange = new TestRange(3, 8, 3, 11);
    const [suggestion] = lspCompletionItemsToMonacoSuggestions({
      monaco,
      items: [
        {
          label: "customer_id",
          kind: CompletionItemKind.Field,
          sortText: "0:customer_id",
        },
      ],
      typedWord: "where",
      completedContextKeyword: true,
      defaultRange: fallbackRange,
      rankByUsage: true,
      usageScope: scope,
      recordUsageCommand: "record-completion",
      appendSpace: true,
      nextCharacter: "",
    });

    expect(suggestion.range).toBe(fallbackRange);
    expect(suggestion.insertText).toBe(" customer_id ");
    expect(suggestion.filterText).toBe("where");
    expect(suggestion.sortText).toMatch(/^0:\d{3}:customer_id$/);
    expect(suggestion.command).toEqual({
      id: "record-completion",
      title: "Record SQL completion usage",
      arguments: [scope, "customer_id"],
    });
  });
});
