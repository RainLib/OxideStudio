import { describe, expect, it } from "vitest";
// Monaco does not publish declarations for its internal scoring implementation.
// @ts-expect-error internal Monaco module has no public declaration
import { fuzzyScore } from "monaco-editor/esm/vs/base/common/filters.js";
// @ts-expect-error internal Monaco module has no public declaration
import { CompletionModel, LineContext } from "monaco-editor/esm/vs/editor/contrib/suggest/browser/completionModel.js";
import { CompletionItemKind } from "@/services/lsp/types";
import {
  recordCompletionUsage,
  resetCompletionUsageCacheForTests,
} from "@/lib/completionUsage";
import {
  applyResolvedLspCompletionItem,
  completionLabelForMonaco,
  completionResolveRequestContext,
  limitLspCompletionPresentationItems,
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
  it.each(["validation.sh", "validation."])("aligns Monaco filtering with a qualified server edit: %s", (fragment) => {
    const line = `SELECT * FROM ${fragment}`;
    const typedWord = fragment.endsWith(".") ? "" : "sh";
    const [suggestion] = lspCompletionItemsToMonacoSuggestions({
      monaco, ownerKey: "owner", typedWord, completedContextKeyword: false,
      lineBeforeCursor: line, cursorLine: 1,
      defaultRange: new MockRange(1, line.length - typedWord.length + 1, 1, line.length + 1),
      rankByUsage: false, usageScope: "postgres", recordUsageCommand: "record",
      items: [{ label: "validation.sharing_share_demo", filterText: "sharing_share_demo", kind: CompletionItemKind.Class,
        textEdit: { newText: "validation.sharing_share_demo", range: { start: { line: 0, character: 14 }, end: { line: 0, character: line.length } } } }],
    });
    expect(suggestion?.filterText).toBe("validation.sharing_share_demo");
    const filterText = suggestion!.filterText!;
    expect(fuzzyScore(fragment, fragment.toLowerCase(), 0, filterText, filterText.toLowerCase(), 0, { firstMatchCanBeWeak: true, boostFullMatch: true })).toBeDefined();
    const itemForMonaco = (filter: string) => ({
      isInvalid: false, provider: {}, container: { incomplete: false },
      position: { lineNumber: 1, column: line.length + 1 }, editStart: { lineNumber: 1, column: 15 },
      completion: { ...suggestion!, filterText: filter }, filterTextLow: filter.toLowerCase(),
      textLabel: "sharing_share_demo", labelLow: "sharing_share_demo",
    });
    const visible = (filter: string) => new CompletionModel(
      [itemForMonaco(filter)], line.length + 1, new LineContext(line, 0),
      { distance: () => 0 }, { filterGraceful: false }, "inline",
    ).items;
    expect(visible("sharing_share_demo")).toHaveLength(0);
    expect(visible(filterText)).toHaveLength(1);
    expect(suggestion?.insertText).toBe("validation.sharing_share_demo");
    expect(suggestion?.range).toEqual(new MockRange(1, 15, 1, line.length + 1));
  });
  it("preserves an existing qualified filter and an ordinary suffix-only edit", () => {
    const line = "SELECT * FROM validation.sh";
    const range = { start: { line: 0, character: 14 }, end: { line: 0, character: line.length } };
    const suffix = { start: { line: 0, character: 25 }, end: { line: 0, character: line.length } };
    const suggestions = lspCompletionItemsToMonacoSuggestions({
      monaco, ownerKey: "owner", typedWord: "sh", completedContextKeyword: false,
      lineBeforeCursor: line, cursorLine: 1, defaultRange: new MockRange(1, 26, 1, 28),
      rankByUsage: false, usageScope: "postgres", recordUsageCommand: "record",
      items: [
        { label: "validation.sharing_share_demo", filterText: "validation.sharing_share_demo", textEdit: { newText: "validation.sharing_share_demo", range } },
        { label: "sharing_orders", filterText: "sharing_orders", textEdit: { newText: "sharing_orders", range: suffix } },
      ],
    });
    expect(suggestions.map((item) => item.filterText)).toEqual(["validation.sharing_share_demo", "sharing_orders"]);
  });
  it("keeps long table and column prefixes secondary without changing server insertion", () => {
    expect(completionLabelForMonaco({ label: "very_long_catalog.public.adapter", kind: CompletionItemKind.Class }))
      .toEqual({ label: "adapter", description: "very_long_catalog.public" });
    expect(completionLabelForMonaco({ label: "adapter_runs.duration_ms", kind: CompletionItemKind.Field }))
      .toEqual({ label: "duration_ms", description: "adapter_runs" });
    expect(completionLabelForMonaco({ label: '"literal.dot"', kind: CompletionItemKind.Field })).toBe('"literal.dot"');
    expect(completionLabelForMonaco({ label: "schema.fn(text)", kind: CompletionItemKind.Function })).toBe("schema.fn(text)");
  });
  it("bounds a large catalog while preserving server order by default", () => {
    const items = Array.from({ length: 600 }, (_, index) => ({
      label: `table_${String(599 - index).padStart(3, "0")}`,
      kind: CompletionItemKind.Module,
      sortText: String(index).padStart(3, "0"),
    }));

    const limited = limitLspCompletionPresentationItems(items, {
      rankByUsage: false,
      usageScope: "postgres",
    });

    expect(limited).toHaveLength(512);
    expect(limited[0]?.label).toBe("table_599");
    expect(limited[limited.length - 1]?.label).toBe("table_088");
  });

  it("keeps frequently accepted items inside the bounded catalog", () => {
    resetCompletionUsageCacheForTests();
    recordCompletionUsage("postgres", "table_3", 2_000);
    const items = Array.from({ length: 4 }, (_, index) => ({
      label: `table_${index}`,
      kind: CompletionItemKind.Module,
      sortText: `0:${index}`,
    }));

    const limited = limitLspCompletionPresentationItems(items, {
      maxItems: 2,
      rankByUsage: true,
      usageScope: "postgres",
    });

    expect(limited.map((item) => item.label)).toEqual(["table_3", "table_0"]);
  });

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
