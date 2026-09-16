import { dollarQuoteTagAt } from "@/features/query-languages/sql/lexicalRules";

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
