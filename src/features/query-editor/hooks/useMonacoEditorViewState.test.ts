import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachMonacoEditorViewState,
  normalizedEditorViewSelection,
} from "./useMonacoEditorViewState";

describe("Monaco editor view state", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("clamps stored offsets to the current document", () => {
    expect(normalizedEditorViewSelection({ anchor: -4, head: 80 }, 12))
      .toEqual({ anchor: 0, head: 12 });
  });

  it("restores and batches selection and viewport updates", () => {
    const text = "select orders";
    let selectionListener: ((event: { selection: any }) => void) | undefined;
    let scrollListener: (() => void) | undefined;
    let scrollTop = 0;
    let scrollLeft = 0;
    let currentSelection: any;
    const model = {
      getValueLength: () => text.length,
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
      getOffsetAt: (position: { column: number }) => position.column - 1,
      getValueInRange: (selection: any) =>
        text.slice(selection.startColumn - 1, selection.endColumn - 1),
    };
    const editor = {
      getModel: () => model,
      getSelection: () => currentSelection,
      setSelection: (selection: any) => {
        const anchor = selection.selectionStartColumn;
        const head = selection.positionColumn;
        currentSelection = {
          ...selection,
          startLineNumber: 1,
          startColumn: Math.min(anchor, head),
          endLineNumber: 1,
          endColumn: Math.max(anchor, head),
        };
      },
      onDidChangeCursorSelection: (listener: typeof selectionListener) => {
        selectionListener = listener;
        return { dispose: vi.fn() };
      },
      onDidScrollChange: (listener: typeof scrollListener) => {
        scrollListener = listener;
        return { dispose: vi.fn() };
      },
      getScrollTop: () => scrollTop,
      getScrollLeft: () => scrollLeft,
      setScrollPosition: (viewport: { scrollTop: number; scrollLeft: number }) => {
        scrollTop = viewport.scrollTop;
        scrollLeft = viewport.scrollLeft;
      },
    };
    const cursorUpdates: unknown[] = [];
    const selectionUpdates: unknown[] = [];
    const viewportUpdates: unknown[] = [];
    const attachment = attachMonacoEditorViewState({
      editor,
      initialSelection: { anchor: 0, head: 6 },
      initialViewport: { scrollTop: 120, scrollLeft: 8 },
      onCursorPositionChange: (position) => cursorUpdates.push(position),
      onSelectionChange: (selection, viewSelection) =>
        selectionUpdates.push({ selection, viewSelection }),
      onViewportChange: (viewport) => viewportUpdates.push(viewport),
    });

    expect(cursorUpdates).toEqual([{ line: 1, column: 7 }]);
    expect(selectionUpdates).toEqual([{
      selection: {
        text: "select",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 7,
      },
      viewSelection: { anchor: 0, head: 6 },
    }]);
    expect({ scrollTop, scrollLeft }).toEqual({ scrollTop: 120, scrollLeft: 8 });

    scrollTop = 260;
    scrollLeft = 24;
    scrollListener?.();
    const viewportFrame = Math.max(...frames.keys());
    const callback = frames.get(viewportFrame);
    frames.delete(viewportFrame);
    callback?.(0);
    expect(viewportUpdates).toEqual([{ scrollTop: 260, scrollLeft: 24 }]);

    editor.setSelection({
      selectionStartLineNumber: 1,
      selectionStartColumn: 8,
      positionLineNumber: 1,
      positionColumn: 14,
    });
    selectionListener?.({ selection: currentSelection });
    expect(selectionUpdates[selectionUpdates.length - 1]).toEqual({
      selection: {
        text: "orders",
        startLineNumber: 1,
        startColumn: 8,
        endLineNumber: 1,
        endColumn: 14,
      },
      viewSelection: { anchor: 7, head: 13 },
    });

    attachment.dispose();
  });
});
