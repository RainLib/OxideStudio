import {
  dollarQuoteTagAt,
  startsHashComment,
  supportsPostgresDollarQuotes,
} from "@/features/query-languages/sql/lexicalRules";
import { normalizeSqlPlaceholders } from "@/features/query-languages/sql/placeholders";

function appendMaskedChar(output: string, char: string) {
  return output + (char === "\n" || char === "\r" ? char : " ");
}

function maskQuotedRegion(
  sql: string,
  output: string,
  index: number,
  quote: string,
) {
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
      output = appendMaskedChar(
        appendMaskedChar(output, sql[index] || ""),
        sql[index + 1] || "",
      );
      index += 2;
      while (index < sql.length) {
        if (sql.startsWith("*/", index)) {
          output = appendMaskedChar(
            appendMaskedChar(output, sql[index] || ""),
            sql[index + 1] || "",
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
