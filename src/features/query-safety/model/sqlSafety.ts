import { sqlKeywordText } from "@/features/query-safety/model/sqlScanner";

export function looksReadOnlySqlStatement(
  statement: string,
  mutatingSqlPrefixes: string[],
) {
  const keywordText = sqlKeywordText(statement);
  const normalized = keywordText.trim().toLowerCase();
  if (!normalized) return false;

  const firstKeyword = normalized.match(/^[a-z_]+/)?.[0] ?? "";
  if (
    firstKeyword === "show" ||
    firstKeyword === "describe" ||
    firstKeyword === "desc"
  ) {
    return true;
  }
  if (
    firstKeyword === "select" ||
    firstKeyword === "table" ||
    firstKeyword === "values" ||
    firstKeyword === "explain" ||
    firstKeyword === "with"
  ) {
    if (
      /\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/.test(normalized)
    ) {
      return false;
    }
    if (
      /\binto\b/.test(normalized) ||
      /\block\s+in\s+share\s+mode\b/.test(normalized)
    ) {
      return false;
    }
    return !mutatingSqlPrefixes.some((keyword) =>
      new RegExp(`\\b${keyword}\\b`).test(normalized),
    );
  }

  return false;
}

export function looksDestructiveSqlStatement(statement: string) {
  const normalized = sqlKeywordText(statement).trim().toLowerCase();
  if (!normalized) return false;

  const firstKeyword = normalized.match(/^[a-z_]+/)?.[0] ?? "";
  if (["delete", "drop", "truncate"].includes(firstKeyword)) {
    return true;
  }
  return (
    /\bdrop\s+(database|schema|table|view|materialized\s+view|index|function|procedure|trigger|constraint)\b/.test(
      normalized,
    ) ||
    /\bdelete\s+from\b/.test(normalized) ||
    /\btruncate\s+(table\s+)?\w/.test(normalized) ||
    /\balter\s+table\b[\s\S]*\bdrop\b/.test(normalized)
  );
}
