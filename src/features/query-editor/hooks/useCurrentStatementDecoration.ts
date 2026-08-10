import { useEffect } from "react";
import { queryService } from "@/services/tauri";
import { mongodbCommandRangeAtCursor } from "../model/mongodbCommandRanges";
import {
  cachedCurrentStatementRangeAtOffset,
  currentStatementLineFrames,
  type CurrentStatementRange,
  type CurrentStatementRangeCache,
} from "../model/currentStatementDecoration";

type Disposable = { dispose: () => void };

type StatementResolution = {
  startOffset: number;
  endOffset: number;
  statementRanges?: CurrentStatementRange[];
} | null;

export type CurrentStatementDecorationOptions = {
  connectionId: string;
  editor: any;
  enabled: boolean;
  isMongoDbConsole: boolean;
  monaco: any;
  resolveSqlStatementAtCursor?: (
    connectionId: string,
    sql: string,
    offset: number,
  ) => Promise<StatementResolution>;
};

export type UseCurrentStatementDecorationOptions =
  CurrentStatementDecorationOptions & { ownerKey: string };

/** Owns current-statement parsing, caching, decoration, and stale-response cleanup. */
export function useCurrentStatementDecoration(
  options: UseCurrentStatementDecorationOptions,
) {
  useEffect(() => {
    if (!options.editor || !options.monaco || !options.ownerKey) return;
    return attachCurrentStatementDecoration(options).dispose;
  }, [
    options.connectionId,
    options.editor,
    options.enabled,
    options.isMongoDbConsole,
    options.monaco,
    options.ownerKey,
    options.resolveSqlStatementAtCursor,
  ]);
}

export function attachCurrentStatementDecoration(
  options: CurrentStatementDecorationOptions,
): Disposable {
  const {
    connectionId,
    editor,
    enabled,
    isMongoDbConsole,
    monaco,
    resolveSqlStatementAtCursor = queryService.resolveSqlStatementAtCursor,
  } = options;
  let decorationIds: string[] = [];
  let timer: number | null = null;
  let requestGeneration = 0;
  let rangeCache: CurrentStatementRangeCache | null = null;
  let renderedRange:
    | (CurrentStatementRange & { modelVersion: number })
    | null = null;
  let cursorDisposable: Disposable | undefined;
  let contentDisposable: Disposable | undefined;
  let modelDisposable: Disposable | undefined;
  let disposed = false;

  const clear = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    requestGeneration += 1;
    rangeCache = null;
    renderedRange = null;
    decorationIds = editor.deltaDecorations(decorationIds, []);
  };

  const decorate = (startOffset: number, endOffset: number) => {
    const model = editor.getModel();
    if (!model || endOffset <= startOffset) {
      renderedRange = null;
      decorationIds = editor.deltaDecorations(decorationIds, []);
      return;
    }
    const modelVersion = model.getVersionId();
    if (
      renderedRange !== null &&
      renderedRange.modelVersion === modelVersion &&
      renderedRange.startOffset === startOffset &&
      renderedRange.endOffset === endOffset &&
      decorationIds.length > 0
    ) {
      return;
    }
    const decorations = currentStatementLineFrames(
      model,
      startOffset,
      endOffset,
    ).map((frame) => ({
      range: new monaco.Range(frame.lineNumber, 1, frame.lineNumber, 1),
      options: {
        isWholeLine: true,
        className: frame.className,
      },
    }));
    decorationIds = editor.deltaDecorations(decorationIds, decorations);
    renderedRange = { modelVersion, startOffset, endOffset };
  };

  const resolve = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) return;
    if (!selection.isEmpty()) {
      requestGeneration += 1;
      decorate(
        model.getOffsetAt(selection.getStartPosition()),
        model.getOffsetAt(selection.getEndPosition()),
      );
      return;
    }
    const position = editor.getPosition();
    if (!position) return;
    const offset = model.getOffsetAt(position);
    if (model.getLineContent(position.lineNumber).trim() === "") {
      requestGeneration += 1;
      decorate(0, 0);
      return;
    }
    if (isMongoDbConsole) {
      requestGeneration += 1;
      rangeCache = null;
      const command = mongodbCommandRangeAtCursor(model.getValue(), offset);
      if (command) decorate(command.from, command.to);
      else decorate(0, 0);
      return;
    }
    const cachedRange = cachedCurrentStatementRangeAtOffset(
      rangeCache,
      model.getVersionId(),
      offset,
    );
    if (cachedRange) {
      requestGeneration += 1;
      decorate(cachedRange.startOffset, cachedRange.endOffset);
      return;
    }
    const requestId = requestGeneration + 1;
    requestGeneration = requestId;
    const modelVersion = model.getVersionId();
    timer = window.setTimeout(async () => {
      timer = null;
      const currentModel = editor.getModel();
      const currentSelection = editor.getSelection();
      if (
        disposed ||
        requestGeneration !== requestId ||
        !currentModel ||
        currentModel !== model ||
        currentModel.getVersionId() !== modelVersion ||
        !currentSelection ||
        !currentSelection.isEmpty()
      ) {
        return;
      }
      try {
        const statement = await resolveSqlStatementAtCursor(
          connectionId,
          currentModel.getValue(),
          offset,
        );
        if (
          disposed ||
          requestGeneration !== requestId ||
          editor.getModel() !== currentModel ||
          currentModel.getVersionId() !== modelVersion
        ) {
          return;
        }
        if (statement) {
          const ranges = statement.statementRanges?.length
            ? statement.statementRanges
            : [{
                startOffset: statement.startOffset,
                endOffset: statement.endOffset,
              }];
          rangeCache = { modelVersion, ranges };
          decorate(statement.startOffset, statement.endOffset);
        } else {
          rangeCache = null;
          decorate(0, 0);
        }
      } catch {
        if (
          !disposed &&
          requestGeneration === requestId &&
          editor.getModel() === currentModel &&
          currentModel.getVersionId() === modelVersion
        ) {
          rangeCache = null;
          decorate(0, 0);
        }
      }
    }, 80);
  };

  if (enabled) {
    cursorDisposable = editor.onDidChangeCursorSelection(resolve);
    contentDisposable = editor.onDidChangeModelContent(resolve);
    modelDisposable = editor.onDidChangeModel(() => {
      rangeCache = null;
      renderedRange = null;
      resolve();
    });
    resolve();
  } else {
    clear();
  }

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cursorDisposable?.dispose();
      contentDisposable?.dispose();
      modelDisposable?.dispose();
      clear();
    },
  };
}
