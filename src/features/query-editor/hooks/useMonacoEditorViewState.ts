import { useEffect, useRef } from "react";
import type {
  EditorSelectionState,
  EditorViewSelectionState,
  EditorViewportState,
} from "@/store/useTabStore";

type Disposable = { dispose: () => void };

export type MonacoEditorViewStateOptions = {
  editor: any;
  initialSelection?: EditorViewSelectionState;
  initialViewport?: EditorViewportState;
  onCursorPositionChange: (position: { line: number; column: number }) => void;
  onSelectionChange: (
    selection: EditorSelectionState | null,
    viewSelection: EditorViewSelectionState,
  ) => void;
  onViewportChange: (viewport: EditorViewportState) => void;
};

export type UseMonacoEditorViewStateOptions = Omit<
  MonacoEditorViewStateOptions,
  "editor"
> & {
  editor: any;
  ownerKey: string;
};

/**
 * Keeps Monaco's cursor selection and viewport alive across tab/editor
 * remounts. Runtime callbacks stay fresh without reinstalling listeners for
 * each scroll or store update.
 */
export function useMonacoEditorViewState(
  options: UseMonacoEditorViewStateOptions,
) {
  const runtimeRef = useRef(options);
  runtimeRef.current = options;

  useEffect(() => {
    if (!options.editor || !options.ownerKey) return;
    return attachMonacoEditorViewState({
      editor: options.editor,
      initialSelection: options.initialSelection,
      initialViewport: options.initialViewport,
      onCursorPositionChange: (position) =>
        runtimeRef.current.onCursorPositionChange(position),
      onSelectionChange: (selection, viewSelection) =>
        runtimeRef.current.onSelectionChange(selection, viewSelection),
      onViewportChange: (viewport) =>
        runtimeRef.current.onViewportChange(viewport),
    }).dispose;
  }, [options.editor, options.ownerKey]);
}

export function attachMonacoEditorViewState(
  options: MonacoEditorViewStateOptions,
): Disposable {
  const {
    editor,
    initialSelection,
    initialViewport,
    onCursorPositionChange,
    onSelectionChange,
    onViewportChange,
  } = options;
  let viewportEmitFrame: number | null = null;
  let viewportRestoreFrame: number | null = null;
  let latestViewport = initialViewport;
  let lastEmittedViewport = initialViewport;
  let disposed = false;

  const readViewport = (): EditorViewportState => ({
    scrollTop: Math.max(0, editor.getScrollTop?.() || 0),
    scrollLeft: Math.max(0, editor.getScrollLeft?.() || 0),
  });
  const emitViewport = (viewport: EditorViewportState) => {
    if (editorViewportsEqual(lastEmittedViewport, viewport)) return;
    lastEmittedViewport = viewport;
    onViewportChange(viewport);
  };
  const scheduleViewport = () => {
    latestViewport = readViewport();
    if (viewportEmitFrame !== null) return;
    viewportEmitFrame = window.requestAnimationFrame(() => {
      viewportEmitFrame = null;
      if (!disposed && latestViewport) emitViewport(latestViewport);
    });
  };
  const flushViewport = () => {
    latestViewport = readViewport();
    if (viewportEmitFrame !== null) {
      window.cancelAnimationFrame(viewportEmitFrame);
      viewportEmitFrame = null;
    }
    emitViewport(latestViewport);
  };

  const emitSelection = (selection: any) => {
    const model = editor.getModel?.();
    if (!model || !selection) return;
    const anchorPosition = {
      lineNumber: selection.selectionStartLineNumber,
      column: selection.selectionStartColumn,
    };
    const headPosition = {
      lineNumber: selection.positionLineNumber,
      column: selection.positionColumn,
    };
    const viewSelection = {
      anchor: model.getOffsetAt(anchorPosition),
      head: model.getOffsetAt(headPosition),
    };
    onCursorPositionChange({
      line: headPosition.lineNumber,
      column: headPosition.column,
    });
    const selectedText = model.getValueInRange(selection);
    onSelectionChange(
      selectedText.trim()
        ? {
            text: selectedText,
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn,
          }
        : null,
      viewSelection,
    );
  };

  restoreSelection(editor, initialSelection);
  emitSelection(editor.getSelection?.());
  restoreViewport(editor, initialViewport, (frame) => {
    viewportRestoreFrame = frame;
  });
  const selectionDisposable = editor.onDidChangeCursorSelection?.(
    (event: { selection?: unknown }) => emitSelection(event.selection),
  );
  const scrollDisposable = editor.onDidScrollChange?.(scheduleViewport);

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      selectionDisposable?.dispose();
      scrollDisposable?.dispose();
      flushViewport();
      if (viewportRestoreFrame !== null) {
        window.cancelAnimationFrame(viewportRestoreFrame);
        viewportRestoreFrame = null;
      }
    },
  };
}

export function normalizedEditorViewSelection(
  selection: EditorViewSelectionState | undefined,
  documentLength: number,
) {
  if (!selection) return undefined;
  return {
    anchor: Math.min(Math.max(0, selection.anchor), documentLength),
    head: Math.min(Math.max(0, selection.head), documentLength),
  };
}

function restoreSelection(editor: any, selection?: EditorViewSelectionState) {
  const model = editor.getModel?.();
  if (!model) return;
  const normalized = normalizedEditorViewSelection(
    selection,
    model.getValueLength(),
  );
  if (!normalized) return;
  const anchor = model.getPositionAt(normalized.anchor);
  const head = model.getPositionAt(normalized.head);
  editor.setSelection?.({
    selectionStartLineNumber: anchor.lineNumber,
    selectionStartColumn: anchor.column,
    positionLineNumber: head.lineNumber,
    positionColumn: head.column,
  });
}

function restoreViewport(
  editor: any,
  viewport: EditorViewportState | undefined,
  setFrame: (frame: number | null) => void,
) {
  if (!viewport) return;
  const apply = () => {
    editor.setScrollPosition?.({
      scrollTop: viewport.scrollTop,
      scrollLeft: viewport.scrollLeft,
    });
  };
  apply();
  let attempts = 0;
  const restoreNextFrame = () => {
    apply();
    attempts += 1;
    if (attempts >= 8) {
      setFrame(null);
      return;
    }
    setFrame(window.requestAnimationFrame(restoreNextFrame));
  };
  setFrame(window.requestAnimationFrame(restoreNextFrame));
}

function editorViewportsEqual(
  left: EditorViewportState | undefined,
  right: EditorViewportState,
) {
  return Boolean(
    left &&
      left.scrollTop === right.scrollTop &&
      left.scrollLeft === right.scrollLeft,
  );
}
