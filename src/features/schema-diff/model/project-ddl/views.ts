import {
  columnList,
  normalizeIdentifier,
  normalizeRelationName,
  readQualifiedIdentifier,
} from "@/features/schema-diff/model/project-ddl/identifiers";
import {
  findLastTopLevelKeyword,
  findTopLevelKeyword,
  leadingWords,
  matchingParen,
  splitTopLevel,
} from "@/features/schema-diff/model/project-ddl/lexical";
import type {
  ColumnInfo,
  SchemaRelationSnapshot,
} from "@/services/tauri/types";

export function parseCreateView(
  statement: string,
  fallbackSchema: string,
  warnings: Set<string>,
): SchemaRelationSnapshot | null {
  const match = statement.match(
    /^CREATE\s+(?:(?:OR\s+(?:REPLACE|ALTER))\s+)?(?:(?:ALGORITHM\s*=\s*[^\s]+|DEFINER\s*=\s*[^\s]+|SQL\s+SECURITY\s+\w+|TEMPORARY|TEMP|FORCE|NOFORCE|EDITIONING|EDITIONABLE|NONEDITIONABLE)\s+)*(MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?/i,
  );
  if (!match) return null;

  const rest = statement.slice(match[0].length).trimStart();
  const identifier = readQualifiedIdentifier(rest);
  const name = normalizeRelationName(identifier, fallbackSchema);
  if (!name) {
    warnings.add(
      `CREATE VIEW has an unsupported identifier: ${leadingWords(statement)}.`,
    );
    return null;
  }

  const afterName = rest.slice(identifier.length).trimStart();
  let explicitColumns: string[] = [];
  let viewBody = afterName;
  if (afterName.startsWith("(")) {
    const close = matchingParen(afterName, 0);
    if (close < 0) {
      warnings.add(
        `CREATE VIEW ${name} has an unbalanced explicit column list.`,
      );
      return null;
    }
    explicitColumns = columnList(afterName.slice(1, close));
    viewBody = afterName.slice(close + 1);
  }

  const asOffset = findTopLevelKeyword(viewBody, "AS");
  if (asOffset < 0) {
    warnings.add(
      `CREATE VIEW ${name} has no supported AS query and was imported without columns.`,
    );
  }
  const selectSql =
    asOffset >= 0 ? viewBody.slice(asOffset + 2).trimStart() : "";
  const inferredColumns =
    explicitColumns.length > 0
      ? explicitColumns
      : inferViewColumnNames(selectSql);
  if (explicitColumns.length === 0 && inferredColumns.length === 0) {
    warnings.add(
      `View ${name} has no safely inferable columns; its relation descriptor remains review-only.`,
    );
  }
  if (inferredColumns.length > 0) {
    warnings.add(
      `View ${name} column types are unavailable in offline DDL and use UNKNOWN placeholders for review.`,
    );
  }

  return {
    name,
    objectType: match[1] ? "MATERIALIZED VIEW" : "VIEW",
    columns: inferredColumns.map(reviewOnlyViewColumn),
    indexes: [],
    constraints: [],
  };
}

export function reviewOnlyViewColumn(name: string): ColumnInfo {
  return {
    name,
    data_type: "UNKNOWN",
    is_nullable: true,
    is_primary_key: false,
    is_unique: false,
    is_indexed: false,
    is_auto_increment: false,
  };
}

export function inferViewColumnNames(sql: string) {
  const select = sql.match(/^SELECT\s+(?:(?:DISTINCT|ALL)\s+)?/i);
  if (!select) return [];
  const selectBody = sql.slice(select[0].length);
  const fromOffset = findTopLevelKeyword(selectBody, "FROM");
  if (fromOffset < 0) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of splitTopLevel(selectBody.slice(0, fromOffset), ",")) {
    const expression = item.trim();
    if (!expression || /(?:^|\.)\*$/i.test(expression)) continue;
    const aliasOffset = findLastTopLevelKeyword(expression, "AS");
    const alias =
      aliasOffset >= 0
        ? normalizeIdentifier(expression.slice(aliasOffset + 2))
        : normalizeSimpleColumnReference(expression);
    if (alias && !seen.has(alias)) {
      seen.add(alias);
      names.push(alias);
    }
  }
  return names;
}

export function normalizeSimpleColumnReference(value: string) {
  const identifier = readQualifiedIdentifier(value.trim());
  if (!identifier || identifier.length !== value.trim().length) return "";
  const segments = identifier
    .split(".")
    .map(normalizeIdentifier)
    .filter(Boolean);
  return segments[segments.length - 1] || "";
}
