import type { QueryResult } from "@/services/tauri/types";

const METADATA_STATEMENT_TYPES = new Set([
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "COMMENT",
  "RENAME",
]);

const SQL_RELATION_KEYWORDS = ["from", "join", "update", "into", "table", "view"];
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
  schema?: string;
  table: string;
};

export type SqlPlaceholderKind =
  | "dollarNumber"
  | "questionMark"
  | "atName"
  | "colonName"
  | "mustache"
  | "dollarBrace"
  | "pythonNamed";

export type SqlPlaceholderSpan = {
  start: number;
  end: number;
  kind: SqlPlaceholderKind;
};

const SQL_PLACEHOLDER_IDENTIFIER = "__oxide_placeholder__";

export function sqlPlaceholderSpans(
  sql: string,
  dialect?: string | null
): SqlPlaceholderSpan[] {
  const spans: SqlPlaceholderSpan[] = [];
  let index = 0;

  while (index < sql.length) {
    if (
      sql.startsWith("--", index) ||
      startsHashComment(sql, index, dialect)
    ) {
      index = skipPlaceholderLineComment(sql, index);
      continue;
    }
    if (sql.startsWith("/*", index)) {
      index = skipPlaceholderBlockComment(sql, index);
      continue;
    }

    const char = sql[index] || "";
    if (char === "$") {
      const dollarQuoteEnd = placeholderDollarQuoteEnd(sql, index);
      if (dollarQuoteEnd !== null) {
        index = dollarQuoteEnd;
        continue;
      }
    }
    if (char === "'" || char === '"' || char === "`") {
      index = skipPlaceholderQuotedRegion(sql, index, char);
      continue;
    }
    if (char === "[") {
      index = skipPlaceholderBracketedIdentifier(sql, index);
      continue;
    }

    const span = sqlPlaceholderAt(sql, index, dialect);
    if (span) {
      spans.push(span);
      index = span.end;
      continue;
    }
    index += 1;
  }

  return spans;
}

export function normalizeSqlPlaceholders(sql: string, dialect?: string | null) {
  const spans = sqlPlaceholderSpans(sql, dialect);
  if (spans.length === 0) return sql;

  const chars = sql.split("");
  for (const span of spans) {
    chars[span.start] = "p";
    for (let index = span.start + 1; index < span.end; index += 1) {
      chars[index] = "_";
    }
  }
  return chars.join("");
}

function sqlPlaceholderAt(
  sql: string,
  start: number,
  dialect?: string | null
): SqlPlaceholderSpan | null {
  const first = sql[start] || "";
  const previous = sql[start - 1] || "";
  const previousIsIdentifier = Boolean(previous && isIdentifierChar(previous));
  let end: number | null = null;
  let kind: SqlPlaceholderKind | null = null;

  if (first === "$" && !previousIsIdentifier) {
    if (/\d/.test(sql[start + 1] || "")) {
      end = takePlaceholderWhile(sql, start + 2, (char) => /\d/.test(char));
      kind = "dollarNumber";
    } else if (sql[start + 1] === "{") {
      end = delimitedPlaceholderNameEnd(sql, start + 2, "}");
      kind = end === null ? null : "dollarBrace";
    }
  } else if (first === "?") {
    if (sql[start + 1] === "|" || sql[start + 1] === "&") return null;
    if (
      isPostgresDialect(dialect) &&
      !/\d/.test(sql[start + 1] || "") &&
      isPostgresJsonQuestionOperator(sql, start)
    ) {
      return null;
    }
    end = takePlaceholderWhile(sql, start + 1, (char) => /\d/.test(char));
    kind = "questionMark";
  } else if (
    first === "@" &&
    !previousIsIdentifier &&
    previous !== "@" &&
    sql[start + 1] !== "@"
  ) {
    end = namedPlaceholderEnd(sql, start + 1);
    kind = end === null ? null : "atName";
  } else if (
    first === ":" &&
    !previousIsIdentifier &&
    previous !== ":" &&
    sql[start + 1] !== ":"
  ) {
    end = namedPlaceholderEnd(sql, start + 1);
    kind = end === null ? null : "colonName";
  } else if (first === "{" && sql[start + 1] === "{") {
    end = delimitedPlaceholderNameEnd(sql, start + 2, "}", "}");
    kind = end === null ? null : "mustache";
  } else if (first === "%" && !previousIsIdentifier && sql[start + 1] === "(") {
    end = delimitedPlaceholderNameEnd(sql, start + 2, ")", "s");
    kind = end === null ? null : "pythonNamed";
  }

  return end !== null && kind ? { start, end, kind } : null;
}

function isPostgresDialect(dialect: string | null | undefined) {
  const normalized = String(dialect || "").trim().toLowerCase();
  return ["postgres", "postgresql", "pgsql", "psql"].includes(normalized);
}

function isPostgresJsonQuestionOperator(sql: string, index: number) {
  const before = sql.slice(0, index).trimEnd();
  const after = sql.slice(index + 1).trimStart();
  if (!before || !after) return false;

  const previousChar = before[before.length - 1] || "";
  if ("(,=<>!+-*/%".includes(previousChar)) return false;

  const previousWord = before.match(/([A-Za-z_][A-Za-z0-9_$]*)$/)?.[1];
  if (
    previousWord &&
    [
      "SELECT",
      "WHERE",
      "AND",
      "OR",
      "ON",
      "WHEN",
      "THEN",
      "ELSE",
      "VALUES",
      "VALUE",
      "SET",
      "RETURNING",
      "BY",
      "LIMIT",
      "OFFSET",
    ].includes(previousWord.toUpperCase())
  ) {
    return false;
  }

  return true;
}

function namedPlaceholderEnd(sql: string, start: number) {
  if (!/[A-Za-z_]/.test(sql[start] || "")) return null;
  return takePlaceholderWhile(sql, start + 1, (char) => /[A-Za-z0-9_$]/.test(char));
}

function delimitedPlaceholderNameEnd(
  sql: string,
  start: number,
  close: string,
  suffix = ""
) {
  if (!/[A-Za-z_]/.test(sql[start] || "")) return null;
  const nameEnd = takePlaceholderWhile(sql, start + 1, (char) =>
    /[A-Za-z0-9_$.-]/.test(char)
  );
  if (sql[nameEnd] !== close) return null;
  const end = nameEnd + 1;
  if (suffix && sql[end] !== suffix) return null;
  return end + suffix.length;
}

function takePlaceholderWhile(
  sql: string,
  start: number,
  predicate: (char: string) => boolean
) {
  let index = start;
  while (index < sql.length && predicate(sql[index] || "")) index += 1;
  return index;
}

function skipPlaceholderLineComment(sql: string, start: number) {
  const newline = sql.indexOf("\n", start);
  return newline < 0 ? sql.length : newline + 1;
}

function skipPlaceholderBlockComment(sql: string, start: number) {
  let depth = 0;
  let index = start;
  while (index < sql.length) {
    if (sql.startsWith("/*", index)) {
      depth += 1;
      index += 2;
      continue;
    }
    if (sql.startsWith("*/", index)) {
      depth = Math.max(0, depth - 1);
      index += 2;
      if (depth === 0) break;
      continue;
    }
    index += 1;
  }
  return index;
}

function skipPlaceholderQuotedRegion(sql: string, start: number, quote: string) {
  let index = start + 1;
  while (index < sql.length) {
    const char = sql[index] || "";
    index += 1;
    if (char === "\\" && quote === "'" && index < sql.length) {
      index += 1;
      continue;
    }
    if (char === quote) {
      if (sql[index] === quote) index += 1;
      else break;
    }
  }
  return index;
}

function skipPlaceholderBracketedIdentifier(sql: string, start: number) {
  let index = start + 1;
  while (index < sql.length) {
    const char = sql[index] || "";
    index += 1;
    if (char === "]") {
      if (sql[index] === "]") index += 1;
      else break;
    }
  }
  return index;
}

function placeholderDollarQuoteEnd(sql: string, start: number) {
  const tag = dollarQuoteTagAt(sql, start);
  if (!tag) return null;
  const bodyStart = start + tag.length;
  const bodyEnd = sql.indexOf(tag, bodyStart);
  return bodyEnd < 0 ? sql.length : bodyEnd + tag.length;
}

function isIdentifierChar(char: string) {
  return /[A-Za-z0-9_$]/.test(char);
}

function appendMaskedChar(output: string, char: string) {
  return output + (char === "\n" || char === "\r" ? char : " ");
}

function startsHashComment(
  sql: string,
  index: number,
  dialect?: string | null
) {
  if (sql[index] !== "#") return false;
  // PostgreSQL uses #>, #>> and #- as JSON operators. They must remain
  // visible to both SQL analysis and parameter scanning.
  if (isPostgresDialect(dialect)) {
    return false;
  }
  return index === 0 || /\s/.test(sql[index - 1] || "");
}

function supportsPostgresDollarQuotes(dialect: string | null | undefined) {
  const normalized = String(dialect || "").trim().toLowerCase();
  return ["postgres", "postgresql", "pgsql", "psql"].includes(normalized);
}

function dollarQuoteTagAt(sql: string, index: number) {
  if (sql[index] !== "$") return null;

  let end = index + 1;
  while (end < sql.length) {
    const char = sql[end] || "";
    if (char === "$") {
      return sql.slice(index, end + 1);
    }
    if (end === index + 1 && !/[A-Za-z_]/.test(char)) return null;
    if (end > index + 1 && !/[A-Za-z0-9_]/.test(char)) return null;
    end += 1;
  }

  return null;
}

function maskQuotedRegion(sql: string, output: string, index: number, quote: string) {
  output = appendMaskedChar(output, sql[index] || "");
  index += 1;

  while (index < sql.length) {
    const char = sql[index] || "";
    output = appendMaskedChar(output, char);
    index += 1;

    if (char === "\\" && quote === "'" && index < sql.length) {
      output = appendMaskedChar(output, sql[index] || "");
      index += 1;
      continue;
    }

    if (char === quote) {
      if (sql[index] === quote) {
        output = appendMaskedChar(output, sql[index] || "");
        index += 1;
        continue;
      }
      break;
    }
  }

  return { output, index };
}

function maskBracketedIdentifier(sql: string, output: string, index: number) {
  output = appendMaskedChar(output, sql[index] || "");
  index += 1;

  while (index < sql.length) {
    const char = sql[index] || "";
    output = appendMaskedChar(output, char);
    index += 1;

    if (char === "]") {
      if (sql[index] === "]") {
        output = appendMaskedChar(output, sql[index] || "");
        index += 1;
        continue;
      }
      break;
    }
  }

  return { output, index };
}

function maskDollarQuotedRegion(sql: string, output: string, index: number) {
  const tag = dollarQuoteTagAt(sql, index);
  if (!tag) return null;

  const bodyStart = index + tag.length;
  const bodyEnd = sql.indexOf(tag, bodyStart);
  const end = bodyEnd >= 0 ? bodyEnd + tag.length : sql.length;

  while (index < end) {
    output = appendMaskedChar(output, sql[index] || "");
    index += 1;
  }

  return { output, index };
}

export function maskSqlNoise(sql: string, dialect?: string | null) {
  sql = normalizeSqlPlaceholders(sql, dialect);
  let output = "";
  let index = 0;
  const shouldMaskDollarQuotes = supportsPostgresDollarQuotes(dialect);

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      while (index < sql.length) {
        const char = sql[index] || "";
        output = appendMaskedChar(output, char);
        index += 1;
        if (char === "\n") break;
      }
      continue;
    }

    if (startsHashComment(sql, index, dialect)) {
      while (index < sql.length) {
        const char = sql[index] || "";
        output = appendMaskedChar(output, char);
        index += 1;
        if (char === "\n") break;
      }
      continue;
    }

    if (sql.startsWith("/*", index)) {
      output = appendMaskedChar(appendMaskedChar(output, sql[index] || ""), sql[index + 1] || "");
      index += 2;
      while (index < sql.length) {
        if (sql.startsWith("*/", index)) {
          output = appendMaskedChar(
            appendMaskedChar(output, sql[index] || ""),
            sql[index + 1] || ""
          );
          index += 2;
          break;
        }
        const char = sql[index] || "";
        output = appendMaskedChar(output, char);
        index += 1;
      }
      continue;
    }

    if (shouldMaskDollarQuotes && sql[index] === "$") {
      const masked = maskDollarQuotedRegion(sql, output, index);
      if (masked) {
        output = masked.output;
        index = masked.index;
        continue;
      }
    }

    const char = sql[index] || "";
    if (char === "'" || char === '"' || char === "`") {
      const masked = maskQuotedRegion(sql, output, index, char);
      output = masked.output;
      index = masked.index;
      continue;
    }

    if (char === "[") {
      const masked = maskBracketedIdentifier(sql, output, index);
      output = masked.output;
      index = masked.index;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

export function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = "";
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const newlineIndex = sql.indexOf("\n", index + 2);
      const end = newlineIndex === -1 ? sql.length : newlineIndex + 1;
      current += sql.slice(index, end);
      index = end;
      continue;
    }

    if (sql.startsWith("/*", index)) {
      const endIndex = sql.indexOf("*/", index + 2);
      const end = endIndex === -1 ? sql.length : endIndex + 2;
      current += sql.slice(index, end);
      index = end;
      continue;
    }

    const dollarQuote = dollarQuoteTagAt(sql, index);
    if (dollarQuote) {
      const endIndex = sql.indexOf(dollarQuote, index + dollarQuote.length);
      const end = endIndex === -1 ? sql.length : endIndex + dollarQuote.length;
      current += sql.slice(index, end);
      index = end;
      continue;
    }

    const char = sql[index] || "";
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      current += char;
      index += 1;

      while (index < sql.length) {
        const quotedChar = sql[index] || "";
        current += quotedChar;
        index += 1;

        if (quotedChar === "\\" && quote === "'" && index < sql.length) {
          current += sql[index] || "";
          index += 1;
          continue;
        }

        if (quotedChar === quote) {
          if (sql[index] === quote) {
            current += sql[index] || "";
            index += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }

    if (char === "[") {
      current += char;
      index += 1;

      while (index < sql.length) {
        const bracketChar = sql[index] || "";
        current += bracketChar;
        index += 1;

        if (bracketChar === "]") {
          if (sql[index] === "]") {
            current += sql[index] || "";
            index += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }

    if (char === ";") {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

export function stripLeadingSqlComments(sql: string) {
  let remaining = sql.trimStart();

  while (remaining.length > 0) {
    if (remaining.startsWith("--")) {
      const newlineIndex = remaining.indexOf("\n");
      if (newlineIndex === -1) return "";
      remaining = remaining.slice(newlineIndex + 1).trimStart();
      continue;
    }

    if (remaining.startsWith("/*")) {
      const endIndex = remaining.indexOf("*/");
      if (endIndex === -1) return "";
      remaining = remaining.slice(endIndex + 2).trimStart();
      continue;
    }

    return remaining;
  }

  return "";
}

export function firstSqlKeyword(sql: string) {
  return stripLeadingSqlComments(sql)
    .replace(/^\(+/, "")
    .match(/^[a-zA-Z]+/)?.[0]
    ?.toUpperCase();
}

export function queryMayChangeMetadata(
  sql: string,
  results: Pick<QueryResult, "statementType">[] | null | undefined
) {
  if (
    results?.some((result) =>
      METADATA_STATEMENT_TYPES.has((result.statementType || "").toUpperCase())
    )
  ) {
    return true;
  }

  return splitSqlStatements(sql).some((statement) => {
    const keyword = firstSqlKeyword(statement);
    return !!keyword && METADATA_STATEMENT_TYPES.has(keyword);
  });
}

export function metadataRefreshNamespaces(
  sql: string,
  fallbackNamespace?: string | null,
  dialect?: string | null
) {
  const namespaces = new Set<string>();

  for (const reference of extractRelationReferences(sql, dialect)) {
    if (reference.schema) {
      namespaces.add(reference.schema);
    }
  }

  const fallback = fallbackNamespace?.trim();
  if (namespaces.size === 0 && fallback) {
    namespaces.add(fallback);
  }

  return Array.from(namespaces);
}

function firstMatchedGroup(match: RegExpMatchArray | null) {
  return match?.slice(1).find((value) => value && value.trim())?.trim() || null;
}

function normalizeSchemaToken(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "$user") return null;
  return trimmed;
}

function parseSchemaList(value: string) {
  const schemas: string[] = [];
  let index = 0;
  const input = value.trim().replace(/;+\s*$/, "");

  while (index < input.length) {
    while (index < input.length && /[\s,]/.test(input[index] || "")) {
      index += 1;
    }
    if (index >= input.length) break;

    const quote = input[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      let schema = "";
      index += 1;

      while (index < input.length) {
        const char = input[index] || "";
        index += 1;

        if (char === quote) {
          if (input[index] === quote) {
            schema += quote;
            index += 1;
            continue;
          }
          break;
        }

        schema += char;
      }

      schemas.push(schema);
      continue;
    }

    const start = index;
    while (index < input.length && input[index] !== ",") {
      index += 1;
    }
    schemas.push(input.slice(start, index).trim());
  }

  return schemas;
}

function extractSchemaContextFromStatement(sql: string) {
  const statement = stripLeadingSqlComments(sql);
  const useMatch = statement.match(
    /^USE\s+(?:`([^`]+)`|"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_$]*))\s*;?$/i
  );
  const useSchema = normalizeSchemaToken(firstMatchedGroup(useMatch));
  if (useSchema) return useSchema;

  const searchPathMatch = statement.match(
    /^SET\s+search_path\s*(?:TO|=)\s*([\s\S]*?)\s*;?$/i
  );
  const searchPathSchema = searchPathMatch?.[1]
    ? parseSchemaList(searchPathMatch[1])
        .map((schema) => normalizeSchemaToken(schema))
        .find((schema): schema is string => Boolean(schema))
    : null;
  if (searchPathSchema) return searchPathSchema;

  const setSchemaMatch = statement.match(
    /^SET\s+SCHEMA\s+(?:`([^`]+)`|"([^"]+)"|'([^']+)'|([a-zA-Z_][a-zA-Z0-9_$]*))\s*;?$/i
  );
  return normalizeSchemaToken(firstMatchedGroup(setSchemaMatch));
}

export function extractSchemaContextChange(sql: string) {
  let selectedSchema: string | null = null;
  for (const statement of splitSqlStatements(sql)) {
    selectedSchema = extractSchemaContextFromStatement(statement) || selectedSchema;
  }
  return selectedSchema;
}

function isKeywordAt(searchableSql: string, index: number, keyword: string) {
  if (!searchableSql.startsWith(keyword, index)) return false;

  const before = index > 0 ? searchableSql[index - 1] : "";
  const after = searchableSql[index + keyword.length] || "";
  return (!before || !isIdentifierChar(before)) && (!after || !isIdentifierChar(after));
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
  end: number
) {
  const keywordIndex = findKeyword(searchableSql, keyword, start);
  return keywordIndex >= 0 && keywordIndex < end;
}

function statementHasAnyKeyword(
  searchableSql: string,
  start: number,
  end: number,
  keywords: string[]
) {
  return keywords.some((keyword) =>
    containsKeywordBetween(searchableSql, keyword, start, end)
  );
}

function shouldReadOnRelation(searchableSql: string, onIndex: number) {
  const statementStart = previousStatementStart(searchableSql, onIndex);
  const hasDdlAction = statementHasAnyKeyword(searchableSql, statementStart, onIndex, [
    "create",
    "drop",
  ]);
  const hasOnRelationObject = statementHasAnyKeyword(
    searchableSql,
    statementStart,
    onIndex,
    ["index", "trigger", "policy"]
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

function readIdentifierPart(sql: string, index: number): [string, number] | null {
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

function readIdentifierPath(sql: string, index: number): [string, number] | null {
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

  return [parts.join("."), index];
}

function unquoteIdentifierPart(part: string) {
  const trimmed = part.trim().replace(/[;,)]*$/g, "");
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "`" && last === "`") ||
      (first === "[" && last === "]")
    ) {
      return trimmed
        .slice(1, -1)
        .replace(/""/g, '"')
        .replace(/``/g, "`");
    }
  }
  return trimmed;
}

function splitIdentifierPath(identifier: string) {
  return identifier
    .split(".")
    .map(unquoteIdentifierPart)
    .map((part) => part.trim())
    .filter(Boolean);
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
  dialect?: string | null
): RelationReference[] {
  const references: RelationReference[] = [];
  const seen = new Set<string>();
  const searchableSql = maskSqlNoise(sql, dialect).toLowerCase();
  const cteNames = collectCteNames(sql, dialect);
  const pushReference = (identifier: string) => {
    const parts = splitIdentifierPath(identifier);
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
    if (!schema && cteNames.has(table.toLowerCase())) {
      return;
    }

    const key = `${schema || ""}.${table}`.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    references.push({ schema, table });
  };

  for (const keyword of SQL_RELATION_KEYWORDS) {
    let searchIndex = 0;
    while (searchIndex < searchableSql.length) {
      const keywordIndex = findKeyword(searchableSql, keyword, searchIndex);
      if (keywordIndex < 0) break;

      const identifier = readIdentifierPath(
        sql,
        skipRelationModifiers(sql, keywordIndex + keyword.length)
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
        skipRelationModifiers(sql, onIndex + "on".length)
      );
      if (identifier) {
        pushReference(identifier[0]);
      }
    }

    onSearchIndex = onIndex + "on".length;
  }

  return references;
}
