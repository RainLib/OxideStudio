export type EditorSaveTarget = "original-file" | "sql-library";

export function editorSaveTargetTooltip(
  target: EditorSaveTarget,
  isDirty: boolean,
): string {
  if (target === "original-file") {
    return isDirty
      ? "Save to Original File (Ctrl+S)"
      : "Original File Saved";
  }
  return isDirty
    ? "Save to SQL Library (Ctrl+S)"
    : "SQL Library Item Saved";
}
