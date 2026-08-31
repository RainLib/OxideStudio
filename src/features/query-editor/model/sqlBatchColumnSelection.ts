import { maskSqlNoise } from "@/lib/sqlAnalysis";
import { sqlStatementBeforeCursor } from "@/lib/queryEditorCachedCompletion";

export type SqlBatchColumnMode = "select" | "insert";

export type SqlBatchColumnCandidate = {
  key: string;
  label: string;
  insertText: string;
  detail?: string;
};

export function sqlBatchColumnMode(
  textBeforeCursor: string,
  dialect?: string,
): SqlBatchColumnMode | null {
  // Batch selection is a local presentation action, but it must share the
  // same statement boundary and lexical-noise rules as the LSP/fallback path.
  // In particular, a semicolon or `FROM` within a literal/comment must not
  // switch the active editor statement or expose an unrelated column picker.
  const statement = sqlStatementBeforeCursor(textBeforeCursor);
  const masked = maskSqlNoise(statement, dialect);
  if (
    /\binsert\s+into\b/iu.test(masked) &&
    /\binsert\s+into\s+[\s\S]*\(\s*(?:[\w$`"\[\].]*\s*)$/iu.test(statement)
  ) {
    return "insert";
  }
  const normalized = masked.toLocaleLowerCase();
  const selectIndex = normalized.lastIndexOf("select");
  const fromIndex = normalized.lastIndexOf("from");
  return selectIndex >= 0 && selectIndex > fromIndex ? "select" : null;
}

export function sqlBatchColumnInsertion(
  candidates: readonly SqlBatchColumnCandidate[],
  mode: SqlBatchColumnMode,
  keywordCase: "upper" | "lower" | "preserve" = "upper",
) {
  const columns = candidates.map((candidate) => candidate.insertText).join(", ");
  if (mode === "select") return { text: columns, snippet: false };
  const valuesKeyword = keywordCase === "lower" ? "values" : "VALUES";
  const values = candidates.map((_, index) => `\${${index + 1}:value}`).join(", ");
  return { text: `${columns}) ${valuesKeyword} (${values})`, snippet: true };
}

export function uniqueSqlBatchColumnCandidates(
  candidates: readonly SqlBatchColumnCandidate[],
  limit = 128,
) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.insertText.trim() || seen.has(candidate.key) || seen.size >= limit) return false;
    seen.add(candidate.key);
    return true;
  });
}
