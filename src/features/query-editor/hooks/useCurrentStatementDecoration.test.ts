import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachCurrentStatementDecoration } from "./useCurrentStatementDecoration";

class TestRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

describe("current statement decoration lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reuses authoritative statement ranges within one model version", async () => {
    const text = "select 1;\nselect 2";
    let offset = 2;
    let cursorListener: (() => void) | undefined;
    const decorations: any[][] = [];
    const selection = {
      isEmpty: () => true,
      getStartPosition: () => ({ lineNumber: 1, column: offset + 1 }),
      getEndPosition: () => ({ lineNumber: 1, column: offset + 1 }),
    };
    const model = {
      getVersionId: () => 7,
      getValue: () => text,
      getOffsetAt: () => offset,
      getLineContent: (lineNumber: number) => text.split("\n")[lineNumber - 1] ?? "",
      getPositionAt: (value: number) => ({
        lineNumber: value < 10 ? 1 : 2,
        column: value < 10 ? value + 1 : value - 9,
      }),
    };
    const disposable = { dispose: vi.fn() };
    const editor = {
      getModel: () => model,
      getSelection: () => selection,
      getPosition: () => model.getPositionAt(offset),
      deltaDecorations: (_previous: string[], next: any[]) => {
        decorations.push(next);
        return next.length ? [`decoration-${decorations.length}`] : [];
      },
      onDidChangeCursorSelection: (listener: () => void) => {
        cursorListener = listener;
        return disposable;
      },
      onDidChangeModelContent: () => disposable,
      onDidChangeModel: () => disposable,
    };
    const resolve = vi.fn(async () => ({
      startOffset: 0,
      endOffset: 9,
      statementRanges: [
        { startOffset: 0, endOffset: 9 },
        { startOffset: 10, endOffset: 18 },
      ],
    }));
    const onCurrentStatementChange = vi.fn();
    const attachment = attachCurrentStatementDecoration({
      connectionId: "connection-1",
      editor,
      enabled: true,
      isMongoDbConsole: false,
      monaco: { Range: TestRange },
      resolveSqlStatementAtCursor: resolve,
      onCurrentStatementChange,
    });

    await vi.advanceTimersByTimeAsync(80);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(decorations[0]?.[0]?.options.className)
      .toContain("oxide-current-statement-line");
    expect(onCurrentStatementChange).toHaveBeenLastCalledWith("select 1;");

    offset = 12;
    cursorListener?.();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(decorations[1]?.[0]?.range.startLineNumber).toBe(2);
    expect(onCurrentStatementChange).toHaveBeenLastCalledWith("select 2");

    attachment.dispose();
  });

  it("clears the frame on a blank line without another backend request", async () => {
    const text = "select 1;\n\nselect 2";
    let offset = 2;
    let cursorListener: (() => void) | undefined;
    const decorations: any[][] = [];
    const model = {
      getVersionId: () => 7,
      getValue: () => text,
      getOffsetAt: () => offset,
      getLineContent: (lineNumber: number) => text.split("\n")[lineNumber - 1] ?? "",
      getPositionAt: (value: number) =>
        value === 10
          ? { lineNumber: 2, column: 1 }
          : { lineNumber: value < 10 ? 1 : 3, column: 1 },
    };
    const selection = {
      isEmpty: () => true,
      getStartPosition: () => model.getPositionAt(offset),
      getEndPosition: () => model.getPositionAt(offset),
    };
    const disposable = { dispose: vi.fn() };
    const editor = {
      getModel: () => model,
      getSelection: () => selection,
      getPosition: () => model.getPositionAt(offset),
      deltaDecorations: (_previous: string[], next: any[]) => {
        decorations.push(next);
        return next.length ? ["decoration"] : [];
      },
      onDidChangeCursorSelection: (listener: () => void) => {
        cursorListener = listener;
        return disposable;
      },
      onDidChangeModelContent: () => disposable,
      onDidChangeModel: () => disposable,
    };
    const resolve = vi.fn(async () => ({
      startOffset: 0,
      endOffset: 9,
      statementRanges: [
        { startOffset: 0, endOffset: 9 },
        { startOffset: 11, endOffset: 19 },
      ],
    }));
    const attachment = attachCurrentStatementDecoration({
      connectionId: "connection-1",
      editor,
      enabled: true,
      isMongoDbConsole: false,
      monaco: { Range: TestRange },
      resolveSqlStatementAtCursor: resolve,
    });

    await vi.advanceTimersByTimeAsync(80);
    offset = 10;
    cursorListener?.();

    expect(resolve).toHaveBeenCalledOnce();
    expect(decorations[decorations.length - 1]).toEqual([]);
    attachment.dispose();
  });
});
