import { afterEach, describe, expect, it, vi } from "vitest";
import type { IRange, languages } from "monaco-editor";
import { inlineCompletionEdit, optionalInlineLspContext, optionalInlineLspValidation } from "./inlineCompletionRuntime";

describe("optional inline semantic context", () => {
  afterEach(() => vi.useRealTimers());

  it("allows text completion without starting an unavailable language server", async () => {
    const load = vi.fn();
    expect(await optionalInlineLspContext({ available: false, load })).toEqual({
      context: {}, available: false,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("preserves available schema context", async () => {
    const context = { candidates: [{ label: "users" }], errorCount: 0 };
    expect(await optionalInlineLspContext({ available: true, load: async () => context }))
      .toEqual({ context, available: true });
  });

  it("falls back after a failed or stalled LSP request", async () => {
    const fallback = { context: {}, available: false };
    expect(await optionalInlineLspContext({
      available: true, load: async () => { throw new Error("LSP restarting"); },
    })).toEqual(fallback);
    vi.useFakeTimers();
    const pending = optionalInlineLspContext({
      available: true, load: () => new Promise(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toEqual(fallback);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps returned diagnostics but bounds validation after a server restart", async () => {
    const diagnostics = [{ severity: 1, message: "Invalid SQL" }];
    expect(await optionalInlineLspValidation({ available: true, load: async () => diagnostics }))
      .toEqual(diagnostics);
    vi.useFakeTimers();
    const pending = optionalInlineLspValidation({
      available: true, load: () => new Promise(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toEqual([]);
  });
});

describe("inline edits alongside the completion menu", () => {
  function edit(line: string, column: number, text: string, selectedText?: string,
    startColumn = 1, endColumn = column) {
    const range = { startLineNumber: 1, endLineNumber: 1, startColumn, endColumn };
    const selectedSuggestion = selectedText === undefined ? undefined : {
      range, text: selectedText, completionKind: 14, isSnippetText: false,
    } as languages.SelectedSuggestionInfo;
    const result = inlineCompletionEdit({
      text, position: { lineNumber: 1, column }, selectedSuggestion,
      model: {
        getLineMaxColumn: () => line.length + 1,
        getValueInRange: (r: IRange) => line.slice(r.startColumn - 1, r.endColumn - 1),
      },
    });
    return { result, applied: result && line.slice(0, result.range.startColumn - 1) +
      result.insertText + line.slice(result.range.endColumn - 1) };
  }

  it("extends a selected keyword with AI SQL while preserving its replacement range", () => {
    const { result, applied } = edit("SELECT * FR", 12, "OM users", "FROM", 10);
    expect(result?.insertText).toBe("FROM users");
    expect(result?.range.startColumn).toBe(10);
    expect(applied).toBe("SELECT * FROM users");
  });

  it("does not replace an incompatible menu selection", () => {
    expect(edit("SELECT * FR", 12, "OM users", "FROZEN", 10).result).toBeNull();
  });

  it("preserves the suffix of the selected replacement range", () => {
    expect(edit("SELECT nax", 10, "me", "namex", 8, 11).applied).toBe("SELECT namex");
  });

  it("keeps multiline completions at end of line and bounds insertions within a line", () => {
    expect(edit("SELECT ", 8, "*\nFROM users").applied).toBe("SELECT *\nFROM users");
    expect(edit("SELECT ;", 8, "*\nFROM users").applied).toBe("SELECT *;");
  });
});
