import { maskSqlNoise } from "@/lib/sqlAnalysis";

export type SqlInsertValueHint = {
  /** Zero-based document offset immediately before a VALUES expression. */
  offset: number;
  column: string;
};

function dollarQuoteTagAt(sql: string, index: number, to: number) {
  if (sql[index] !== "$") return null;
  const candidate = sql.slice(index, Math.min(to, index + 129));
  return candidate.match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0] ?? null;
}

/**
 * Return the first character inside an enclosing PostgreSQL dollar-quoted
 * body. Callers use it to trim a bounded viewport slice so routine SQL is not
 * mistaken for an opaque string by the ordinary SQL noise masker.
 */
export function findEnclosingDollarQuoteBodyStart(
  sql: string,
  position: number,
) {
  const to = Math.max(0, Math.min(position, sql.length));
  let index = 0;
  let activeTag: string | null = null;
  let bodyStart = -1;
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  while (index < to) {
    if (activeTag) {
      if (sql.startsWith(activeTag, index)) {
        index += activeTag.length;
        activeTag = null;
        bodyStart = -1;
      } else {
        index += 1;
      }
      continue;
    }
    if (lineComment) {
      if (sql[index] === "\n") lineComment = false;
      index += 1;
      continue;
    }
    if (blockComment) {
      if (sql.startsWith("*/", index)) {
        index += 2;
        blockComment = false;
      } else {
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (sql[index] === quote) {
        if (sql[index + 1] === quote) index += 2;
        else {
          index += 1;
          quote = null;
        }
      } else {
        index += 1;
      }
      continue;
    }
    if (sql.startsWith("--", index)) {
      index += 2;
      lineComment = true;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      index += 2;
      blockComment = true;
      continue;
    }
    if (["'", '"', "`", "["].includes(sql[index] || "")) {
      quote = sql[index] === "[" ? "]" : sql[index] || null;
      index += 1;
      continue;
    }
    const tag = dollarQuoteTagAt(sql, index, to);
    if (tag) {
      activeTag = tag;
      bodyStart = index + tag.length;
      index = bodyStart;
      continue;
    }
    index += 1;
  }
  return activeTag ? bodyStart : null;
}

function isIdentifierBoundary(value: string | undefined) {
  return !value || !/[A-Za-z0-9_$]/.test(value);
}

function findWord(sql: string, word: string, from: number, to = sql.length) {
  const lower = sql.toLowerCase();
  let index = lower.indexOf(word, from);
  while (index >= 0 && index < to) {
    if (
      isIdentifierBoundary(lower[index - 1]) &&
      isIdentifierBoundary(lower[index + word.length])
    ) {
      return index;
    }
    index = lower.indexOf(word, index + word.length);
  }
  return -1;
}

function findWordAtDepth(
  sql: string,
  word: string,
  from: number,
  to: number,
  targetDepth: number,
) {
  let depth = 0;
  for (let index = from; index < to; index += 1) {
    if (
      depth === targetDepth &&
      sql.slice(index, index + word.length).toLowerCase() === word &&
      isIdentifierBoundary(sql[index - 1]) &&
      isIdentifierBoundary(sql[index + word.length])
    ) {
      return index;
    }
    if (sql[index] === "(") depth += 1;
    else if (sql[index] === ")") depth = Math.max(0, depth - 1);
  }
  return -1;
}

function skipWhitespace(sql: string, index: number) {
  while (index < sql.length && /\s/.test(sql[index] || "")) index += 1;
  return index;
}

function skipQuotedIdentifier(sql: string, index: number) {
  const opener = sql[index] || "";
  const closer = opener === "[" ? "]" : opener;
  index += 1;
  while (index < sql.length) {
    if (sql[index] === closer) {
      if (sql[index + 1] === closer) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function skipQualifiedIdentifier(sql: string, from: number) {
  let index = skipWhitespace(sql, from);
  let readPart = false;
  while (index < sql.length) {
    const char = sql[index] || "";
    if (char === '"' || char === "`" || char === "[") {
      index = skipQuotedIdentifier(sql, index);
      readPart = true;
    } else if (/[A-Za-z_$]/.test(char)) {
      index += 1;
      while (/[A-Za-z0-9_$]/.test(sql[index] || "")) index += 1;
      readPart = true;
    } else {
      break;
    }
    const after = skipWhitespace(sql, index);
    if (sql[after] !== ".") return index;
    index = skipWhitespace(sql, after + 1);
  }
  return readPart ? index : from;
}

function matchingParen(maskedSql: string, open: number) {
  let depth = 0;
  for (let index = open; index < maskedSql.length; index += 1) {
    const char = maskedSql[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
    if (char === ";" && depth === 0) return -1;
  }
  return -1;
}

function unquoteIdentifier(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const opener = trimmed[0];
  const closer = opener === "[" ? "]" : opener;
  if (!['"', "`", "["].includes(opener || "") || trimmed.charAt(trimmed.length - 1) !== closer) {
    return trimmed;
  }
  return trimmed.slice(1, -1).replace(new RegExp(`${closer}${closer}`, "g"), closer);
}

function explicitColumns(sql: string, from: number, to: number) {
  const columns: string[] = [];
  let start = from;
  let quote: string | null = null;
  for (let index = from; index <= to; index += 1) {
    const char = index === to ? "," : (sql[index] || ",");
    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === '"' || char === "`" || char === "[") {
      quote = char === "[" ? "]" : char;
      continue;
    }
    if (char === ",") {
      const column = unquoteIdentifier(sql.slice(start, index));
      if (!column || !/^[A-Za-z_$\["`]/.test(column)) return [];
      columns.push(column);
      start = index + 1;
    }
  }
  return columns;
}

function nextValueStart(sql: string, maskedSql: string, from: number, to: number) {
  for (let index = from; index < to; index += 1) {
    if (!/\s/.test(maskedSql[index] || "")) return index;
    if (["'", '"', "`", "["].includes(sql[index] || "")) return index;
  }
  return -1;
}

function parseValuesRow(sql: string, maskedSql: string, open: number) {
  const starts: number[] = [];
  let depth = 1;
  let valueStart = open + 1;
  for (let index = open + 1; index < maskedSql.length; index += 1) {
    const char = maskedSql[index] || "";
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 1) {
        const start = nextValueStart(sql, maskedSql, valueStart, index);
        if (start >= 0) starts.push(start);
        return { starts, next: index + 1 };
      }
      depth -= 1;
      continue;
    }
    if (char === "," && depth === 1) {
      const start = nextValueStart(sql, maskedSql, valueStart, index);
      if (start >= 0) starts.push(start);
      valueStart = index + 1;
    }
    if (char === ";" && depth === 1) break;
  }
  return null;
}

const SELECT_PROJECTION_BOUNDARIES = [
  "from",
  "into",
  "where",
  "group",
  "having",
  "order",
  "offset",
  "fetch",
  "for",
  "option",
  "union",
  "except",
  "intersect",
  "limit",
  "qualify",
  "window",
] as const;

function wordAt(sql: string, word: string, index: number, to: number) {
  return (
    index + word.length <= to &&
    sql.slice(index, index + word.length).toLowerCase() === word &&
    isIdentifierBoundary(sql[index - 1]) &&
    isIdentifierBoundary(sql[index + word.length])
  );
}

function findInsertSourceSelect(maskedSql: string, from: number, to: number) {
  const sourceStart = skipWhitespace(maskedSql, from);
  if (sourceStart < to && maskedSql[sourceStart] === "(") {
    const inner = skipWhitespace(maskedSql, sourceStart + 1);
    if (wordAt(maskedSql, "select", inner, to)) {
      return { offset: inner, depth: 1 };
    }
  }
  const offset = findWordAtDepth(maskedSql, "select", from, to, 0);
  return offset >= 0 ? { offset, depth: 0 } : null;
}

function projectionIsWildcard(maskedSql: string, from: number, to: number) {
  let depth = 0;
  let compact = "";
  for (let index = from; index < to; index += 1) {
    const char = maskedSql[index] || "";
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && !/\s/.test(char)) {
      compact += char;
    }
  }
  if (compact === "*" || compact === ".*") return true;
  if (!compact.endsWith(".*")) return false;
  const qualifier = compact.slice(0, -2);
  return (
    qualifier.length > 0 &&
    [...qualifier].every((char) => /[\p{L}\p{N}_$#.\[\]]/u.test(char))
  );
}

function selectProjectionStarts(
  sql: string,
  maskedSql: string,
  select: number,
  selectDepth: number,
  to: number,
) {
  let cursor = skipWhitespace(maskedSql, select + "select".length);
  if (wordAt(maskedSql, "all", cursor, to)) {
    cursor = skipWhitespace(maskedSql, cursor + "all".length);
  } else if (wordAt(maskedSql, "distinct", cursor, to)) {
    cursor = skipWhitespace(maskedSql, cursor + "distinct".length);
    if (wordAt(maskedSql, "on", cursor, to)) {
      const open = skipWhitespace(maskedSql, cursor + "on".length);
      if (maskedSql[open] !== "(") return [];
      const close = matchingParen(maskedSql, open);
      if (close < 0 || close >= to) return [];
      cursor = skipWhitespace(maskedSql, close + 1);
    }
  }

  if (wordAt(maskedSql, "top", cursor, to)) {
    cursor = skipWhitespace(maskedSql, cursor + "top".length);
    if (maskedSql[cursor] === "(") {
      const close = matchingParen(maskedSql, cursor);
      if (close < 0 || close >= to) return [];
      cursor = skipWhitespace(maskedSql, close + 1);
    } else {
      const valueStart = cursor;
      while (cursor < to && !/[\s,]/.test(maskedSql[cursor] || "")) cursor += 1;
      if (cursor === valueStart) return [];
      cursor = skipWhitespace(maskedSql, cursor);
    }
    if (wordAt(maskedSql, "percent", cursor, to)) {
      cursor = skipWhitespace(maskedSql, cursor + "percent".length);
    }
    if (wordAt(maskedSql, "with", cursor, to)) {
      const ties = skipWhitespace(maskedSql, cursor + "with".length);
      if (wordAt(maskedSql, "ties", ties, to)) {
        cursor = skipWhitespace(maskedSql, ties + "ties".length);
      }
    }
  }

  const starts: number[] = [];
  let expressionStart = cursor;
  let depth = selectDepth;
  for (; cursor < to; cursor += 1) {
    const char = maskedSql[cursor] || "";
    if (
      depth === selectDepth &&
      SELECT_PROJECTION_BOUNDARIES.some((word) =>
        wordAt(maskedSql, word, cursor, to),
      )
    ) {
      break;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === selectDepth) break;
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === selectDepth) {
      const start = nextValueStart(sql, maskedSql, expressionStart, cursor);
      if (start < 0 || projectionIsWildcard(maskedSql, expressionStart, cursor)) {
        return [];
      }
      starts.push(start);
      expressionStart = cursor + 1;
    }
  }
  const start = nextValueStart(sql, maskedSql, expressionStart, cursor);
  if (start < 0 || projectionIsWildcard(maskedSql, expressionStart, cursor)) {
    return [];
  }
  starts.push(start);
  return starts;
}

/**
 * Return positional column labels for explicit `INSERT INTO t (a, b)` VALUES
 * or SELECT sources. It intentionally declines implicit-column INSERTs:
 * resolving those safely requires live table metadata and must not trigger a
 * metadata scan as the user types.
 */
export function sqlInsertValueHints(sql: string): SqlInsertValueHint[] {
  const maskedSql = maskSqlNoise(sql);
  const hints: SqlInsertValueHint[] = [];
  let searchFrom = 0;
  while (searchFrom < maskedSql.length) {
    const insert = findWord(maskedSql, "insert", searchFrom);
    if (insert < 0) break;
    const into = findWord(maskedSql, "into", insert + "insert".length);
    if (into < 0) {
      searchFrom = insert + "insert".length;
      continue;
    }
    const tableEnd = skipQualifiedIdentifier(sql, into + "into".length);
    const columnOpen = skipWhitespace(maskedSql, tableEnd);
    if (maskedSql[columnOpen] !== "(") {
      searchFrom = into + "into".length;
      continue;
    }
    const columnClose = matchingParen(maskedSql, columnOpen);
    if (columnClose < 0) break;
    const columns = explicitColumns(sql, columnOpen + 1, columnClose);
    const statementEndCandidate = maskedSql.indexOf(";", columnClose + 1);
    const statementEnd =
      statementEndCandidate >= 0 ? statementEndCandidate : maskedSql.length;
    const values = findWordAtDepth(
      maskedSql,
      "values",
      columnClose + 1,
      statementEnd,
      0,
    );
    const select = findInsertSourceSelect(
      maskedSql,
      columnClose + 1,
      statementEnd,
    );
    if (columns.length === 0 || (values < 0 && !select)) {
      searchFrom = columnClose + 1;
      continue;
    }
    if (select && (values < 0 || select.offset < values)) {
      const starts = selectProjectionStarts(
        sql,
        maskedSql,
        select.offset,
        select.depth,
        statementEnd,
      );
      if (starts.length === columns.length) {
        starts.forEach((offset, index) => {
          const column = columns[index];
          if (column) hints.push({ offset, column });
        });
      }
      searchFrom = Math.max(statementEnd + 1, insert + "insert".length);
      continue;
    }
    let rowStart = skipWhitespace(maskedSql, values + "values".length);
    while (maskedSql[rowStart] === "(") {
      const row = parseValuesRow(sql, maskedSql, rowStart);
      if (!row) break;
      row.starts.slice(0, columns.length).forEach((offset, index) => {
        const column = columns[index];
        if (column) hints.push({ offset, column });
      });
      rowStart = skipWhitespace(maskedSql, row.next);
      if (maskedSql[rowStart] !== ",") break;
      rowStart = skipWhitespace(maskedSql, rowStart + 1);
    }
    searchFrom = Math.max(rowStart, insert + "insert".length);
  }
  return hints;
}
