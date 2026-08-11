import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "@/services/lsp/types";
import {
  applyResolvedLspCompletionItem,
  completionResolveRequestContext,
  lspCompletionItemsToMonacoSuggestions,
  markResolvableLspCompletionItems,
  sourceLspCompletionItem,
} from "./lspCompletionPresentation";
import { lspDocumentationForMonaco } from "./lspMonacoAdapter";

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
      Keyword: 17,
      Module: 9,
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
      ownerKey: "owner-1",
      items: [
        {
          label: "customer_id",
          labelDetails: {
            detail: " uuid",
            description: "orders",
          },
          kind: CompletionItemKind.Field,
          documentation: {
            kind: "markdown",
            value: "Customer **identifier**.",
          },
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
    });

    expect(suggestion?.label).toEqual({
      label: "customer_id",
      detail: " uuid",
      description: "orders",
    });
    expect(suggestion?.insertTextRules).toBe(5);
    expect(suggestion?.documentation).toEqual({
      value: "Customer **identifier**.",
      isTrusted: false,
      supportHtml: false,
    });
    expect(suggestion?.range).toEqual({
      insert: new MockRange(3, 5, 3, 8),
      replace: new MockRange(3, 5, 3, 12),
    });
  });

  it("requests the next completion level after inserting a schema qualifier", () => {
    const [suggestion] = lspCompletionItemsToMonacoSuggestions({
      monaco,
      ownerKey: "owner-1",
      items: [
        {
          label: "public",
          kind: CompletionItemKind.Module,
          insertText: "public.",
        },
      ],
      typedWord: "pub",
      completedContextKeyword: false,
      defaultRange: new MockRange(1, 1, 1, 4),
      rankByUsage: false,
      usageScope: "postgres-scope",
      recordUsageCommand: "record",
      driver: "postgres",
    });

    expect(suggestion?.command).toEqual({
      id: "record",
      title: "Continue SQL completion",
      arguments: ["postgres-scope", "public", true, "owner-1"],
    });
  });

  it("never appends client whitespace to any language-server insertion", () => {
    const suggestions = lspCompletionItemsToMonacoSuggestions({
      monaco,
      ownerKey: "owner-1",
      items: [
        {
          label: "SELECT",
          kind: CompletionItemKind.Keyword,
          textEdit: {
            newText: "SELECT",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 3 },
            },
          },
        },
        {
          label: "FROM",
          kind: CompletionItemKind.Keyword,
          insertText: "FROM",
        },
      ],
      typedWord: "",
      completedContextKeyword: false,
      defaultRange: new MockRange(1, 1, 1, 1),
      rankByUsage: false,
      usageScope: "postgres-scope",
      recordUsageCommand: "record",
      driver: "postgres",
    });

    expect(suggestions[0]?.insertText).toBe("SELECT");
    expect(suggestions[1]?.insertText).toBe("FROM");
  });

  it("attaches only server items and applies lazy resolve fields", () => {
    const serverItem = {
      label: "customer_id",
      kind: CompletionItemKind.Field,
      data: { symbol: 42 },
    };
    const fallbackItem = {
      label: "WHERE",
      kind: CompletionItemKind.Keyword,
    };
    const suggestions = lspCompletionItemsToMonacoSuggestions({
      monaco,
      ownerKey: "owner-1",
      items: [
        {
          ...markResolvableLspCompletionItems([serverItem], true)[0]!,
          sortText: "adapted-by-context-filter",
        },
        fallbackItem,
      ],
      typedWord: "",
      completedContextKeyword: false,
      defaultRange: new MockRange(1, 1, 1, 1),
      rankByUsage: false,
      usageScope: "postgres-scope",
      recordUsageCommand: "record",
      requestUri: "oxide://postgres/editor.sql",
      requestModelVersion: 7,
    });

    expect(sourceLspCompletionItem(suggestions[0]!)).toBe(serverItem);
    expect(sourceLspCompletionItem(suggestions[1]!)).toBeUndefined();
    expect(completionResolveRequestContext(suggestions[0]!)).toEqual({
      uri: "oxide://postgres/editor.sql",
      modelVersion: 7,
    });
    expect(completionResolveRequestContext(suggestions[1]!)).toBeUndefined();

    const resolved = applyResolvedLspCompletionItem(monaco, suggestions[0]!, {
      ...serverItem,
      detail: "customers.customer_id bigint",
      documentation: { kind: "markdown", value: "Primary **key**" },
      additionalTextEdits: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: "-- resolved\n",
        },
      ],
    });

    expect(resolved.detail).toBe("customers.customer_id bigint");
    expect(resolved.documentation).toEqual({
      value: "Primary **key**",
      isTrusted: false,
      supportHtml: false,
    });
    expect(resolved.additionalTextEdits).toEqual([
      {
        range: new MockRange(1, 1, 1, 1),
        text: "-- resolved\n",
      },
    ]);
    expect(sourceLspCompletionItem(resolved)).toMatchObject({
      data: { symbol: 42 },
      detail: "customers.customer_id bigint",
    });
  });
});

describe("lspDocumentationForMonaco", () => {
  it("keeps plaintext literal instead of interpreting Markdown markers", () => {
    expect(
      lspDocumentationForMonaco({
        kind: "plaintext",
        value: "* is a wildcard",
      }),
    ).toBe("* is a wildcard");
  });
});
