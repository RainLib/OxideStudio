const SAVED_SQL_DRAG_MIME = "application/x-oxide-saved-sql";

interface SavedSqlDragPayload {
  version: 1;
  projectId: string;
  fileId: string;
}

export function writeSavedSqlDrag(
  dataTransfer: DataTransfer,
  projectId: string,
  fileId: string,
) {
  const payload: SavedSqlDragPayload = { version: 1, projectId, fileId };
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(SAVED_SQL_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", fileId);
}

export function readSavedSqlDrag(
  dataTransfer: DataTransfer,
): SavedSqlDragPayload | null {
  const raw = dataTransfer.getData(SAVED_SQL_DRAG_MIME);
  if (!raw || raw.length > 2_048) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedSqlDragPayload>;
    if (
      value.version !== 1 ||
      typeof value.projectId !== "string" ||
      !value.projectId ||
      typeof value.fileId !== "string" ||
      !value.fileId
    ) {
      return null;
    }
    return value as SavedSqlDragPayload;
  } catch {
    return null;
  }
}

export function hasSavedSqlDrag(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(SAVED_SQL_DRAG_MIME);
}
