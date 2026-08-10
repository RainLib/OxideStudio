export type EditorLineActionTarget = {
  trigger: (source: string, command: string, payload: unknown) => void;
};

/**
 * Delegate to Monaco's native command so indentation, undo grouping,
 * multi-cursor behavior, selections, and read-only state stay editor-owned.
 */
export function insertLineBelow(editor: EditorLineActionTarget) {
  editor.trigger(
    "oxide.insertLineBelow",
    "editor.action.insertLineAfter",
    null,
  );
}
