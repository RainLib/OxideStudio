export type DocumentCompletionRefreshRequest = {
  model: {
    getVersionId: () => number;
  };
  position: {
    lineNumber: number;
    column: number;
  };
  modelVersion: number;
  token: {
    isCancellationRequested?: boolean;
  };
};

export type DocumentCompletionEditorState = {
  getModel: () => unknown;
  getPosition: () =>
    | {
        lineNumber: number;
        column: number;
      }
    | null;
  hasTextFocus: () => boolean;
};

/**
 * A stale-while-revalidate metadata response may only refresh the completion
 * session that requested it. Monaco cancels the provider token when that
 * session closes; the remaining checks protect against tab, edit and cursor
 * changes that happen before the background metadata request finishes.
 */
export function shouldRetriggerDocumentCompletion(
  editor: DocumentCompletionEditorState | null | undefined,
  request: DocumentCompletionRefreshRequest,
) {
  if (request.token.isCancellationRequested || !editor?.hasTextFocus()) {
    return false;
  }
  if (
    editor.getModel() !== request.model ||
    request.model.getVersionId() !== request.modelVersion
  ) {
    return false;
  }
  const currentPosition = editor.getPosition();
  return (
    currentPosition?.lineNumber === request.position.lineNumber &&
    currentPosition.column === request.position.column
  );
}
