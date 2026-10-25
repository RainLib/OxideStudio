import { currentTopLevelStatementAtCursor } from "./lexical";

export const MAX_CACHED_SQL_DOCUMENT_CODE_UNITS = 512 * 1024;

/** Read a bounded complete model once per metadata request. A partial window
 * cannot prove statement/query ownership, so oversized models fail closed. */
export function cachedSqlDocumentContext(model: any, position: any, prefix: string) {
  if (typeof model.getValue !== "function" || typeof model.getOffsetAt !== "function") {
    return currentTopLevelStatementAtCursor(prefix, prefix.length);
  }
  if (typeof model.getValueLength === "function" && model.getValueLength() > MAX_CACHED_SQL_DOCUMENT_CODE_UNITS) return null;
  const source: string = model.getValue();
  const cursorOffset: number = model.getOffsetAt(position);
  if (source.length > MAX_CACHED_SQL_DOCUMENT_CODE_UNITS || cursorOffset < 0 || cursorOffset > source.length) return null;
  return currentTopLevelStatementAtCursor(source, cursorOffset);
}
