import { describe, expect, it } from "vitest";
import {
  boundedSqlCompletionTextBeforeCursor,
  cachedRelationCompletionSuggestions,
  createCachedSqlCompletionRequest,
} from "./useCachedSqlCompletionSource";

class TestRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

const monaco = {
  Range: TestRange,
  languages: {
    CompletionItemKind: {
      Struct: 1,
      Field: 2,
      Reference: 3,
    },
  },
};

function textModel(text: string) {
  return {
    uri: { toString: () => "file:///query.sql" },
    getVersionId: () => 1,
    getWordUntilPosition: () => {
      const word = text.match(/[\p{L}\p{N}_]+$/u)?.[0] || "";
      return {
        startColumn: text.length - word.length + 1,
        endColumn: text.length + 1,
      };
    },
    getValueInRange: () => text,
  };
}

const sqlCompletion = {
  triggerMode: "positional" as const,
  keywordCase: "upper" as const,
  functionCase: "preserve" as const,
  tableAlias: "none" as const,
  rankByUsage: true,
  appendSpace: true,
  snippets: [],
};

const sqlFormatting = {
  keywordCase: "upper" as const,
  functionCase: "preserve" as const,
  logicalOperatorNewline: "before" as const,
  fromClauseLayout: "newLine" as const,
};

describe("cached SQL completion source", () => {
  it("keeps the fallback bounded when offset APIs are unavailable", () => {
    const model = textModel("SELECT * FROM orders");
    const text = boundedSqlCompletionTextBeforeCursor(monaco, model, {
      lineNumber: 1,
      column: 21,
    });

    expect(text).toBe("SELECT * FROM orders");
  });

  it("offers cached relations only in relation positions", () => {
    const tables = [{ name: "orders" }, { name: "customers" }];
    const relationText = "SELECT * FROM ord";
    const relationSuggestions = cachedRelationCompletionSuggestions(
      monaco,
      textModel(relationText),
      { lineNumber: 1, column: relationText.length + 1 },
      tables,
      relationText,
    );
    const expressionText = "SELECT ord";
    const expressionSuggestions = cachedRelationCompletionSuggestions(
      monaco,
      textModel(expressionText),
      { lineNumber: 1, column: expressionText.length + 1 },
      tables,
      expressionText,
    );

    expect(relationSuggestions.map((item) => item.label)).toEqual(["orders"]);
    expect(expressionSuggestions).toEqual([]);
  });

  it("bounds large cached relation catalogs in stable metadata order", () => {
    const tables = Array.from({ length: 600 }, (_, index) => ({
      name: `archive_${String(index).padStart(3, "0")}`,
    }));
    const text = "SELECT * FROM ";

    const suggestions = cachedRelationCompletionSuggestions(
      monaco,
      textModel(text),
      { lineNumber: 1, column: text.length + 1 },
      tables,
      text,
    );

    expect(suggestions).toHaveLength(512);
    expect(suggestions[0]?.label).toBe("archive_000");
    expect(suggestions[511]?.label).toBe("archive_511");
  });

  it("resolves declared CTE fields without loading physical metadata", async () => {
    const text = `WITH recent(id, status) AS (
      SELECT id, status FROM orders
    )
    SELECT * FROM recent r WHERE r.st`;
    const request = createCachedSqlCompletionRequest(
      {
        connectionId: "connection-1",
        driver: "postgres",
        metadataRevision: 1,
        schemaTables: [],
        sqlCompletion,
        sqlFormatting,
      },
      { fields: new Map(), joinConstraints: new Map() },
      {
        completionDriver: "postgres",
        model: textModel(text),
        monaco,
        position: { lineNumber: 4, column: 40 },
        textBeforeCursor: text,
        token: {},
      },
    );

    const suggestions = await request.metadataSuggestions();
    expect(suggestions.map((item) => item.label)).toEqual(["status"]);
  });
});
