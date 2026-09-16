import {
  EditorSelectionState,
  EditorViewSelectionState,
  EditorViewportState,
} from "@/features/workspace-tabs/model/types";

export function editorSelectionsEqual(
  left: EditorSelectionState | null | undefined,
  right: EditorSelectionState | null,
) {
  return (
    left === right ||
    Boolean(
      left &&
        right &&
        left.text === right.text &&
        left.startLineNumber === right.startLineNumber &&
        left.startColumn === right.startColumn &&
        left.endLineNumber === right.endLineNumber &&
        left.endColumn === right.endColumn,
    ) ||
    (!left && !right)
  );
}

export function editorViewSelectionsEqual(
  left: EditorViewSelectionState | undefined,
  right: EditorViewSelectionState,
) {
  return Boolean(
    left && left.anchor === right.anchor && left.head === right.head,
  );
}

export function editorViewportsEqual(
  left: EditorViewportState | undefined,
  right: EditorViewportState,
) {
  return Boolean(
    left &&
      left.scrollTop === right.scrollTop &&
      left.scrollLeft === right.scrollLeft,
  );
}
