export type SqlBatchColumnMode = "select" | "insert";

export type SqlBatchColumnCandidate = {
  key: string;
  label: string;
  insertText: string;
  detail?: string;
};

export function sqlBatchColumnMode(textBeforeCursor: string): SqlBatchColumnMode | null {
  const statement = textBeforeCursor.slice(textBeforeCursor.lastIndexOf(";") + 1);
  if (/\binsert\s+into\s+[\s\S]*\(\s*(?:[\w$`"\[\].]*\s*)$/iu.test(statement)) {
    return "insert";
  }
  const selectIndex = statement.toLocaleLowerCase().lastIndexOf("select");
  const fromIndex = statement.toLocaleLowerCase().lastIndexOf("from");
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
