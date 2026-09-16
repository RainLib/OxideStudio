import {
  dollarQuoteTagAt,
  isIdentifierChar,
  isPostgresDialect,
  startsHashComment,
} from "@/features/query-languages/sql/lexicalRules";

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

export const SQL_PLACEHOLDER_IDENTIFIER = "__oxide_placeholder__";

export function sqlPlaceholderSpans(
  sql: string,
  dialect?: string | null,
): SqlPlaceholderSpan[] {
  const spans: SqlPlaceholderSpan[] = [];
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith("--", index) || startsHashComment(sql, index, dialect)) {
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

export function sqlPlaceholderAt(
  sql: string,
  start: number,
  dialect?: string | null,
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
  return takePlaceholderWhile(sql, start + 1, (char) =>
    /[A-Za-z0-9_$]/.test(char),
  );
}

function delimitedPlaceholderNameEnd(
  sql: string,
  start: number,
  close: string,
  suffix = "",
) {
  if (!/[A-Za-z_]/.test(sql[start] || "")) return null;
  const nameEnd = takePlaceholderWhile(sql, start + 1, (char) =>
    /[A-Za-z0-9_$.-]/.test(char),
  );
  if (sql[nameEnd] !== close) return null;
  const end = nameEnd + 1;
  if (suffix && sql[end] !== suffix) return null;
  return end + suffix.length;
}

function takePlaceholderWhile(
  sql: string,
  start: number,
  predicate: (char: string) => boolean,
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

function skipPlaceholderQuotedRegion(
  sql: string,
  start: number,
  quote: string,
) {
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
