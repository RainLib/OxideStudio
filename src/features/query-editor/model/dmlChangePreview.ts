/** Cheap UI hint only. The Rust parser remains authoritative when previewing. */
const DML_PREVIEW_RE = /^\s*(update|insert|delete)\b/i;

export function looksLikeDmlStatement(sql: string): boolean {
  return DML_PREVIEW_RE.test(sql);
}

export function dmlPreviewTabTitle(operation: string): string {
  const label = operation.trim().toLowerCase();
  if (label === "update") return "Preview update";
  if (label === "insert") return "Preview insert";
  if (label === "delete") return "Preview delete";
  return "Preview changes";
}
