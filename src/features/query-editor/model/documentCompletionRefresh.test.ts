import { describe, expect, it } from "vitest";
import { shouldRetriggerDocumentCompletion } from "./documentCompletionRefresh";

function fixture() {
  const model = { getVersionId: () => 7 };
  const position = { lineNumber: 3, column: 9 };
  return {
    model,
    request: {
      model,
      position,
      modelVersion: 7,
      token: { isCancellationRequested: false },
    },
    editor: {
      getModel: () => model,
      getPosition: () => position,
      hasTextFocus: () => true,
    },
  };
}

describe("document completion metadata refresh guard", () => {
  it("refreshes the completion session that is still active", () => {
    const { editor, request } = fixture();
    expect(shouldRetriggerDocumentCompletion(editor, request)).toBe(true);
  });

  it("does not reopen a cancelled or blurred completion session", () => {
    const cancelled = fixture();
    cancelled.request.token.isCancellationRequested = true;
    expect(
      shouldRetriggerDocumentCompletion(cancelled.editor, cancelled.request),
    ).toBe(false);

    const blurred = fixture();
    blurred.editor.hasTextFocus = () => false;
    expect(
      shouldRetriggerDocumentCompletion(blurred.editor, blurred.request),
    ).toBe(false);
  });

  it("rejects refresh after a tab, edit or cursor change", () => {
    const switched = fixture();
    switched.editor.getModel = () => ({ getVersionId: () => 7 });
    expect(
      shouldRetriggerDocumentCompletion(switched.editor, switched.request),
    ).toBe(false);

    const edited = fixture();
    edited.request.model.getVersionId = () => 8;
    expect(
      shouldRetriggerDocumentCompletion(edited.editor, edited.request),
    ).toBe(false);

    const moved = fixture();
    moved.editor.getPosition = () => ({ lineNumber: 4, column: 1 });
    expect(
      shouldRetriggerDocumentCompletion(moved.editor, moved.request),
    ).toBe(false);
  });
});
