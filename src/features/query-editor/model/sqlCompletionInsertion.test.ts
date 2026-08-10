import { describe, expect, it } from "vitest";
import { CompletionItemKind, type CompletionItem } from "@/services/lsp/types";
import {
  appendSqlCompletionSpace,
  shouldChainSqlCompletionAfterAccept,
  sqlCompletionItemType,
  sqlFunctionCompletionInsertion,
} from "./sqlCompletionInsertion";

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

  it("keeps quoted, array-bound, struct and default commas inside parameters", () => {
    const item: CompletionItem = {
      label: "complex_routine",
      kind: CompletionItemKind.Function,
      detail:
        'complex_routine("last,name" text, pattern text = \'a,b\', bounds numeric[10,2], payload struct<left int, right text>, threshold boolean = x < 1)',
    };

    expect(sqlFunctionCompletionInsertion(item, "complex_routine").insertText).toBe(
      "complex_routine(${1:last,name}, ${2:pattern}, ${3:bounds}, ${4:payload}, ${5:threshold})",
    );
  });

  it("supports escaped quoted parameter names and rejects oversized signatures", () => {
    const quoted: CompletionItem = {
      label: "quoted_routine",
      kind: CompletionItemKind.Function,
      detail: 'quoted_routine("display""name" text, `group``name` text, [order]]name] int)',
    };
    expect(sqlFunctionCompletionInsertion(quoted, "quoted_routine").insertText).toBe(
      'quoted_routine(${1:display"name}, ${2:group`name}, ${3:order]name})',
    );

    const oversized: CompletionItem = {
      label: "unsafe_routine",
      kind: CompletionItemKind.Function,
      detail: `unsafe_routine(${"x".repeat(16 * 1024)})`,
    };
    expect(sqlFunctionCompletionInsertion(oversized, "unsafe_routine")).toEqual({
      insertText: "unsafe_routine",
      insertAsSnippet: false,
    });
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

describe("relation alias completion insertion", () => {
  it("keeps LSP variable items compact for member access", () => {
    const item: CompletionItem = {
      label: "u",
      kind: CompletionItemKind.Variable,
      insertText: "u",
    };

    const itemType = sqlCompletionItemType(item);
    expect(itemType).toBe("variable");
    expect(
      appendSqlCompletionSpace(item.insertText!, {
        enabled: true,
        itemType,
        nextCharacter: ".",
      }),
    ).toBe("u");
  });
});

describe("chained SQL completion", () => {
  it("continues after an accepted schema qualifier", () => {
    expect(
      shouldChainSqlCompletionAfterAccept(
        {
          label: "public",
          kind: CompletionItemKind.Module,
        },
        "public.",
        "postgres",
      ),
    ).toBe(true);
  });

  it("continues after SQL Server USE but not ordinary keywords", () => {
    expect(
      shouldChainSqlCompletionAfterAccept(
        { label: "USE", kind: CompletionItemKind.Keyword },
        "USE ",
        "sqlserver",
      ),
    ).toBe(true);
    expect(
      shouldChainSqlCompletionAfterAccept(
        { label: "SELECT", kind: CompletionItemKind.Keyword },
        "SELECT ",
        "sqlserver",
      ),
    ).toBe(false);
  });
});
