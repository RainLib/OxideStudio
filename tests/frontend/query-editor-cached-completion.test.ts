import { describe, expect, it } from "vitest";
import { cachedRelationCompletionSuggestions } from "@/components/workspace/QueryEditor";
import {
  completionSuggestionsOrCached,
  mergeCompletionFallbackSuggestions,
} from "@/features/query-editor";

const monaco = {
  Range: class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  languages: { CompletionItemKind: { Struct: 22 } },
};

function model(sql: string) {
  return {
    getValueInRange: () => sql,
    getWordUntilPosition: () => ({ startColumn: 15, endColumn: 15 }),
  };
}

describe("cached relation completion", () => {
  it("uses the conservative cache only when the language service has no proposals", async () => {
    const cached = async () => ["cached"];
    await expect(completionSuggestionsOrCached(["live"], cached)).resolves.toEqual([
      "live",
    ]);
    await expect(completionSuggestionsOrCached([], cached)).resolves.toEqual([
      "cached",
    ]);
  });

  it("offers cached relations only where SQL expects a relation", () => {
    const suggestions = cachedRelationCompletionSuggestions(
      monaco,
      model("SELECT * FROM "),
      { lineNumber: 1, column: 15 },
      [{ name: "orders", comment: "Customer orders" }],
    );

    expect(suggestions).toMatchObject([
      {
        label: "orders",
        detail: "Cached database object",
        documentation: { value: "Customer orders" },
      },
    ]);
  });

  it("does not substitute cached relations for field or value completion", () => {
    expect(
      cachedRelationCompletionSuggestions(
        monaco,
        model("SELECT "),
        { lineNumber: 1, column: 8 },
        [{ name: "orders" }],
      ),
    ).toEqual([]);
  });

  it("keeps scoped fields and SQL operators together without duplicates", () => {
    expect(
      mergeCompletionFallbackSuggestions(
        [{ label: "status" }, { label: "created_at" }],
        [{ label: "=" }, { label: "IN" }, { label: "status" }],
      ),
    ).toEqual([
      { label: "status" },
      { label: "created_at" },
      { label: "=" },
      { label: "IN" },
    ]);
  });

  it("keeps grammar completions when a live provider already returned fields", () => {
    expect(
      mergeCompletionFallbackSuggestions(
        [{ label: "status", detail: "column" }],
        [{ label: "=", detail: "operator" }, { label: "IN", detail: "operator" }],
      ),
    ).toEqual([
      { label: "status", detail: "column" },
      { label: "=", detail: "operator" },
      { label: "IN", detail: "operator" },
    ]);
  });
});
