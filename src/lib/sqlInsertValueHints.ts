import { maskSqlNoise } from "@/lib/sqlAnalysis";

export type SqlInsertValueHint = {
  /** Zero-based document offset immediately before a VALUES expression. */
  offset: number;
  column: string;
};

function isIdentifierBoundary(value: string | undefined) {
  return !value || !/[A-Za-z0-9_$]/.test(value);
}

function findWord(sql: string, word: string, from: number) {
  const lower = sql.toLowerCase();
  let index = lower.indexOf(word, from);
  while (index >= 0) {
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

/**
 * Return positional column labels for explicit `INSERT INTO t (a, b) VALUES`
 * clauses. It intentionally declines implicit-column INSERTs: resolving those
 * safely requires live table metadata and must not trigger a metadata scan as
 * the user types.
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
    const values = findWord(maskedSql, "values", columnClose + 1);
    const select = findWord(maskedSql, "select", columnClose + 1);
    if (columns.length === 0 || values < 0 || (select >= 0 && select < values)) {
      searchFrom = columnClose + 1;
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
