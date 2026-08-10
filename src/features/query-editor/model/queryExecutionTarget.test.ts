import { describe, expect, it, vi } from "vitest";
import { resolveQueryExecutionTarget } from "./queryExecutionTarget";

function snapshot(
  fullText: string,
  overrides: Partial<{
    selectedText: string;
    selectionStart: number;
    selectionEnd: number;
    cursorOffset: number;
  }> = {},
) {
  return {
    fullText,
    selectedText: "",
    selectionStart: 0,
    selectionEnd: 0,
    cursorOffset: 0,
    ...overrides,
  };
}

describe("resolveQueryExecutionTarget", () => {
  it("keeps all-mode execution on the complete document", async () => {
    await expect(
      resolveQueryExecutionTarget({
        kind: "sql",
        mode: "all",
        snapshot: snapshot("SELECT 1;\nSELECT 2;"),
      }),
    ).resolves.toEqual({
      sql: "SELECT 1;\nSELECT 2;",
      scope: "document",
    });
  });

  it("gives a SQL selection priority without invoking the parser", async () => {
    const resolveStatement = vi.fn();
    await expect(
      resolveQueryExecutionTarget({
        kind: "sql",
        mode: "current",
        snapshot: snapshot("SELECT 1; SELECT 2;", {
          selectedText: "SELECT 2",
          selectionStart: 10,
          selectionEnd: 18,
          cursorOffset: 12,
        }),
        resolveSqlStatementAtCursor: resolveStatement,
      }),
    ).resolves.toEqual({
      sql: "SELECT 2",
      sourceStartOffset: 10,
      sourceEndOffset: 18,
      scope: "selection",
    });
    expect(resolveStatement).not.toHaveBeenCalled();
  });

  it("expands a partial Elasticsearch selection to whole requests", async () => {
    const source = "GET /one/_search\n{}\n\nGET /two/_search\n{}";
    const selectionStart = source.indexOf("one");
    const selectionEnd = source.indexOf("two") + 3;
    const target = await resolveQueryExecutionTarget({
      kind: "elasticsearch",
      mode: "current",
      snapshot: snapshot(source, {
        selectedText: source.slice(selectionStart, selectionEnd),
        selectionStart,
        selectionEnd,
      }),
    });
    expect(target?.sql).toBe(
      "GET /one/_search\n{}\n\nGET /two/_search\n{}",
    );
    expect(target?.sourceStartOffset).toBe(0);
    expect(target?.sourceEndOffset).toBe(source.length);
  });

  it("selects the Elasticsearch request under the cursor", async () => {
    const source = "GET /one/_search\n{}\n\nGET /two/_search\n{}";
    const target = await resolveQueryExecutionTarget({
      kind: "elasticsearch",
      mode: "current",
      snapshot: snapshot(source, { cursorOffset: source.indexOf("two") }),
    });
    expect(target?.sql).toBe("GET /two/_search\n{}");
    expect(target?.scope).toBe("current");
  });

  it("selects the MongoDB command under the cursor", async () => {
    const source = '{"find":"users"}\n{"count":"users"}';
    const target = await resolveQueryExecutionTarget({
      kind: "mongodb",
      mode: "current",
      snapshot: snapshot(source, { cursorOffset: source.indexOf("count") }),
    });
    expect(target?.sql).toBe('{"count":"users"}');
    expect(target?.sourceStartOffset).toBe(source.indexOf('{"count"'));
  });

  it("uses backend SQL ranges for the active dialect", async () => {
    const resolveStatement = vi.fn().mockResolvedValue({
      sql: "SELECT 2",
      startOffset: 10,
      endOffset: 18,
      statementIndex: 1,
      statementCount: 2,
    });
    await expect(
      resolveQueryExecutionTarget({
        kind: "sql",
        mode: "current",
        snapshot: snapshot("SELECT 1; SELECT 2;", { cursorOffset: 14 }),
        resolveSqlStatementAtCursor: resolveStatement,
      }),
    ).resolves.toEqual({
      sql: "SELECT 2",
      sourceStartOffset: 10,
      sourceEndOffset: 18,
      scope: "current",
    });
    expect(resolveStatement).toHaveBeenCalledWith(
      "SELECT 1; SELECT 2;",
      14,
    );
  });

  it("falls back to the document from a blank line only when opted in", async () => {
    const source = "SELECT 1;\n\nSELECT 2;";
    const resolveStatement = vi.fn().mockResolvedValue(null);

    await expect(
      resolveQueryExecutionTarget({
        kind: "sql",
        mode: "current",
        snapshot: snapshot(source, { cursorOffset: 10 }),
        executeAllOnBlankLine: false,
        resolveSqlStatementAtCursor: resolveStatement,
      }),
    ).resolves.toBeNull();
    await expect(
      resolveQueryExecutionTarget({
        kind: "sql",
        mode: "current",
        snapshot: snapshot(source, { cursorOffset: 10 }),
        executeAllOnBlankLine: true,
        resolveSqlStatementAtCursor: resolveStatement,
      }),
    ).resolves.toEqual({ sql: source, scope: "document" });
  });
});
