import { isIdentifierChar } from "@/features/query-languages/sql/lexicalRules";
import { maskSqlNoise } from "@/features/query-languages/sql/maskNoise";
import {
  SQL_PLACEHOLDER_IDENTIFIER,
  sqlPlaceholderAt,
} from "@/features/query-languages/sql/placeholders";
import {
  splitSqlStatements,
  stripLeadingSqlComments,
} from "@/features/query-languages/sql/statements";

const SQL_RELATION_KEYWORDS = [
  "from",
  "join",
  "update",
  "into",
  "table",
  "view",
];

const SQL_IGNORED_RELATION_TOKENS = new Set([
  "select",
  "values",
  "set",
  "where",
  "on",
  "using",
  "with",
]);

export type RelationReference = {
  /** Optional server catalog/database from a three-part relation identifier. */
  database?: string;
  schema?: string;
  table: string;
};

function isKeywordAt(searchableSql: string, index: number, keyword: string) {
  if (!searchableSql.startsWith(keyword, index)) return false;

  const before = index > 0 ? searchableSql[index - 1] : "";
  const after = searchableSql[index + keyword.length] || "";
  return (
    (!before || !isIdentifierChar(before)) &&
    (!after || !isIdentifierChar(after))
  );
}

function findKeyword(searchableSql: string, keyword: string, from: number) {
  let index = from;
  while (index < searchableSql.length) {
    const found = searchableSql.indexOf(keyword, index);
    if (found < 0) return -1;
    if (isKeywordAt(searchableSql, found, keyword)) return found;
    index = found + keyword.length;
  }
  return -1;
}

function previousStatementStart(sql: string, index: number) {
  const statementSeparator = sql.lastIndexOf(";", index - 1);
  return statementSeparator >= 0 ? statementSeparator + 1 : 0;
}

function containsKeywordBetween(
  searchableSql: string,
  keyword: string,
  start: number,
  end: number,
) {
  const keywordIndex = findKeyword(searchableSql, keyword, start);
  return keywordIndex >= 0 && keywordIndex < end;
}

function statementHasAnyKeyword(
  searchableSql: string,
  start: number,
  end: number,
  keywords: string[],
) {
  return keywords.some((keyword) =>
    containsKeywordBetween(searchableSql, keyword, start, end),
  );
}

function shouldReadOnRelation(searchableSql: string, onIndex: number) {
  const statementStart = previousStatementStart(searchableSql, onIndex);
  const hasDdlAction = statementHasAnyKeyword(
    searchableSql,
    statementStart,
    onIndex,
    ["create", "drop"],
  );
  const hasOnRelationObject = statementHasAnyKeyword(
    searchableSql,
    statementStart,
    onIndex,
    ["index", "trigger", "policy"],
  );

  return hasDdlAction && hasOnRelationObject;
}

function skipWhitespace(sql: string, index: number) {
  while (index < sql.length && /\s/.test(sql[index] || "")) {
    index += 1;
  }
  return index;
}

function consumeWord(sql: string, index: number, word: string) {
  index = skipWhitespace(sql, index);
  const candidate = sql.slice(index, index + word.length);
  if (candidate.toLowerCase() !== word.toLowerCase()) return null;

  const after = sql[index + word.length] || "";
  if (after && isIdentifierChar(after)) return null;
  return index + word.length;
}

function skipRelationModifiers(sql: string, index: number) {
  const afterOnly = consumeWord(sql, index, "only");
  if (afterOnly !== null) {
    index = afterOnly;
  }

  const afterIf = consumeWord(sql, index, "if");
  if (afterIf !== null) {
    const afterNot = consumeWord(sql, afterIf, "not") ?? afterIf;
    const afterExists = consumeWord(sql, afterNot, "exists");
    if (afterExists !== null) {
      index = afterExists;
    }
  }

  return skipWhitespace(sql, index);
}

function readIdentifierPart(
  sql: string,
  index: number,
): [string, number] | null {
  index = skipWhitespace(sql, index);
  const placeholder = sqlPlaceholderAt(sql, index);
  if (placeholder) return [SQL_PLACEHOLDER_IDENTIFIER, placeholder.end];
  const first = sql[index];
  if (!first) return null;

  if (first === '"' || first === "`" || first === "'") {
    const quote = first;
    let part = "";
    index += 1;

    while (index < sql.length) {
      const char = sql[index] || "";
      index += 1;

      if (char === quote) {
        if (sql[index] === quote) {
          part += quote;
          index += 1;
          continue;
        }
        return [part, index];
      }

      part += char;
    }

    return null;
  }

  if (first === "[") {
    let part = "";
    index += 1;

    while (index < sql.length) {
      const char = sql[index] || "";
      index += 1;

      if (char === "]") {
        if (sql[index] === "]") {
          part += "]";
          index += 1;
          continue;
        }
        return [part, index];
      }

      part += char;
    }

    return null;
  }

  if (!isIdentifierChar(first)) return null;

  const start = index;
  while (index < sql.length && isIdentifierChar(sql[index] || "")) {
    index += 1;
  }

  return [sql.slice(start, index), index];
}

function readIdentifierPath(
  sql: string,
  index: number,
): [string[], number] | null {
  const first = readIdentifierPart(sql, index);
  if (!first) return null;

  const parts = [first[0]];
  index = first[1];

  while (index < sql.length) {
    index = skipWhitespace(sql, index);
    if (sql[index] !== ".") break;
    index += 1;

    const next = readIdentifierPart(sql, index);
    if (!next) break;
    parts.push(next[0]);
    index = next[1];
  }

  return [parts, index];
}

function skipBalancedParentheses(maskedSql: string, index: number) {
  index = skipWhitespace(maskedSql, index);
  if (maskedSql[index] !== "(") return null;

  let depth = 0;
  while (index < maskedSql.length) {
    const char = maskedSql[index] || "";
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }

  return null;
}

function skipOptionalCteMaterialization(maskedSql: string, index: number) {
  const afterNot = consumeWord(maskedSql, index, "not");
  if (afterNot !== null) {
    return consumeWord(maskedSql, afterNot, "materialized") ?? index;
  }

  return consumeWord(maskedSql, index, "materialized") ?? index;
}

function collectCteNames(sql: string, dialect?: string | null) {
  const names = new Set<string>();

  for (const statement of splitSqlStatements(sql)) {
    const source = stripLeadingSqlComments(statement);
    const masked = maskSqlNoise(source, dialect);
    let index = consumeWord(masked, 0, "with");
    if (index === null) continue;

    index = consumeWord(masked, index, "recursive") ?? index;

    while (index < masked.length) {
      const cteName = readIdentifierPart(source, index);
      if (!cteName) break;
      names.add(cteName[0].toLowerCase());
      index = skipWhitespace(masked, cteName[1]);

      if (masked[index] === "(") {
        const afterColumns = skipBalancedParentheses(masked, index);
        if (afterColumns === null) break;
        index = afterColumns;
      }

      const afterAs = consumeWord(masked, index, "as");
      if (afterAs === null) break;
      index = skipOptionalCteMaterialization(masked, afterAs);

      const afterBody = skipBalancedParentheses(masked, index);
      if (afterBody === null) break;
      index = skipWhitespace(masked, afterBody);

      if (masked[index] !== ",") break;
      index += 1;
    }
  }

  return names;
}

export function extractRelationReferences(
  sql: string,
  dialect?: string | null,
): RelationReference[] {
  const references: RelationReference[] = [];
  const seen = new Set<string>();
  const searchableSql = maskSqlNoise(sql, dialect).toLowerCase();
  const cteNames = collectCteNames(sql, dialect);
  const pushReference = (parts: string[]) => {
    const table = parts[parts.length - 1];
    if (
      !table ||
      table === SQL_PLACEHOLDER_IDENTIFIER ||
      SQL_IGNORED_RELATION_TOKENS.has(table.toLowerCase())
    ) {
      return;
    }

    const schema = parts.includes(SQL_PLACEHOLDER_IDENTIFIER)
      ? undefined
      : parts.length >= 2
        ? parts[parts.length - 2]
        : undefined;
    const database = parts.includes(SQL_PLACEHOLDER_IDENTIFIER)
      ? undefined
      : parts.length >= 3
        ? parts[parts.length - 3]
        : undefined;
    if (!schema && cteNames.has(table.toLowerCase())) {
      return;
    }

    const key = `${database || ""}.${schema || ""}.${table}`.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    references.push({
      ...(database ? { database } : {}),
      ...(schema ? { schema } : {}),
      table,
    });
  };

  for (const keyword of SQL_RELATION_KEYWORDS) {
    let searchIndex = 0;
    while (searchIndex < searchableSql.length) {
      const keywordIndex = findKeyword(searchableSql, keyword, searchIndex);
      if (keywordIndex < 0) break;

      const identifier = readIdentifierPath(
        sql,
        skipRelationModifiers(sql, keywordIndex + keyword.length),
      );
      if (identifier) {
        pushReference(identifier[0]);
      }

      searchIndex = keywordIndex + keyword.length;
    }
  }

  let onSearchIndex = 0;
  while (onSearchIndex < searchableSql.length) {
    const onIndex = findKeyword(searchableSql, "on", onSearchIndex);
    if (onIndex < 0) break;

    if (shouldReadOnRelation(searchableSql, onIndex)) {
      const identifier = readIdentifierPath(
        sql,
        skipRelationModifiers(sql, onIndex + "on".length),
      );
      if (identifier) {
        pushReference(identifier[0]);
      }
    }

    onSearchIndex = onIndex + "on".length;
  }

  return references;
}
