import { describe, expect, it } from "vitest";
import {
  appendSqlCompletionSpace,
  sqlCompletionItemType,
} from "@/features/query-editor";
import { CompletionItemKind } from "@/services/lsp/types";

describe("SQL completion insertion", () => {
  it("classifies protocol completion items for insertion behavior", () => {
    expect(
      sqlCompletionItemType({ label: "SELECT", kind: CompletionItemKind.Keyword }),
    ).toBe("keyword");
    expect(
      sqlCompletionItemType({ label: "users", kind: CompletionItemKind.Class }),
    ).toBe("table");
    expect(
      sqlCompletionItemType({ label: "email", kind: CompletionItemKind.Field }),
    ).toBe("column");
    expect(
      sqlCompletionItemType({ label: "count", kind: CompletionItemKind.Function }),
    ).toBe("function");
    expect(
      sqlCompletionItemType({ label: "public", kind: CompletionItemKind.Module }),
    ).toBe("schema");
  });

  it("adds one space after keywords, tables and columns", () => {
    expect(
      appendSqlCompletionSpace("SELECT", {
        enabled: true,
        itemType: "keyword",
      }),
    ).toBe("SELECT ");
    expect(
      appendSqlCompletionSpace("users", {
        enabled: true,
        itemType: "table",
      }),
    ).toBe("users ");
    expect(
      appendSqlCompletionSpace("customer_id", {
        enabled: true,
        itemType: "column",
      }),
    ).toBe("customer_id ");
  });

  it("does not insert whitespace before SQL punctuation or existing whitespace", () => {
    for (const nextCharacter of [",", ";", ")", "]", "}", "'", '"', " ", "\n"]) {
      expect(
        appendSqlCompletionSpace("customer_id", {
          enabled: true,
          itemType: "column",
          nextCharacter,
        }),
      ).toBe("customer_id");
    }
  });

  it("leaves functions, snippets, properties, schemas and text unchanged", () => {
    for (const itemType of [
      "function",
      "snippet",
      "property",
      "schema",
      "text",
    ] as const) {
      expect(
        appendSqlCompletionSpace("value", {
          enabled: true,
          itemType,
        }),
      ).toBe("value");
    }
  });

  it("respects the disabled setting and already complete insert text", () => {
    expect(
      appendSqlCompletionSpace("WHERE", {
        enabled: false,
        itemType: "keyword",
      }),
    ).toBe("WHERE");
    expect(
      appendSqlCompletionSpace("WHERE ", {
        enabled: true,
        itemType: "keyword",
      }),
    ).toBe("WHERE ");
    expect(
      appendSqlCompletionSpace("public.", {
        enabled: true,
        itemType: "table",
      }),
    ).toBe("public.");
  });
});
