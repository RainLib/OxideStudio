import { type ProjectDdlDialect } from "@/features/schema-diff/model/project-ddl/types";

export function splitStatements(sql: string, dialect: ProjectDdlDialect) {
  const normalized =
    dialect === "sqlserver"
      ? sql.replace(/^\s*GO\s*$/gim, ";")
      : dialect === "oracle"
        ? sql.replace(/^\s*\/\s*$/gm, ";")
        : sql;
  return splitTopLevel(normalized, ";");
}

export function splitTopLevel(value: string, delimiter: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let dollarQuote = "";
  let bracketQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] || "";
    if (dollarQuote) {
      if (value.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = "";
      }
      continue;
    }
    if (bracketQuote) {
      if (char === "]" && value[index + 1] === "]") {
        index += 1;
      } else if (char === "]") {
        bracketQuote = false;
      }
      continue;
    }
    if (quote) {
      if (char === quote && value[index + 1] === quote) {
        index += 1;
      } else if (char === quote && value[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (["'", '"', "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketQuote = true;
      continue;
    }
    const tag = char === "$" ? readDollarQuoteTag(value, index) : "";
    if (tag) {
      dollarQuote = tag;
      index += tag.length - 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === delimiter && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

export function findTopLevelKeyword(value: string, keyword: string) {
  return topLevelKeywordOffsets(value, keyword)[0] ?? -1;
}

export function findLastTopLevelKeyword(value: string, keyword: string) {
  const offsets = topLevelKeywordOffsets(value, keyword);
  return offsets[offsets.length - 1] ?? -1;
}

export function topLevelKeywordOffsets(value: string, keyword: string) {
  const offsets: number[] = [];
  const expected = keyword.toUpperCase();
  let depth = 0;
  let quote = "";
  let dollarQuote = "";
  let bracketQuote = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] || "";
    if (dollarQuote) {
      if (value.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = "";
      }
      continue;
    }
    if (bracketQuote) {
      if (char === "]" && value[index + 1] === "]") index += 1;
      else if (char === "]") bracketQuote = false;
      continue;
    }
    if (quote) {
      if (char === quote && value[index + 1] === quote) index += 1;
      else if (char === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketQuote = true;
      continue;
    }
    const tag = char === "$" ? readDollarQuoteTag(value, index) : "";
    if (tag) {
      dollarQuote = tag;
      index += tag.length - 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (
      depth === 0 &&
      value.slice(index, index + expected.length).toUpperCase() === expected &&
      !/[A-Za-z0-9_$]/.test(value[index - 1] || "") &&
      !/[A-Za-z0-9_$]/.test(value[index + expected.length] || "")
    ) {
      offsets.push(index);
      index += expected.length - 1;
    }
  }
  return offsets;
}

export function matchingParen(value: string, opening: number) {
  let depth = 0;
  let quote = "";
  let dollarQuote = "";
  let bracketQuote = false;
  for (let index = opening; index < value.length; index += 1) {
    const char = value[index] || "";
    if (dollarQuote) {
      if (value.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = "";
      }
      continue;
    }
    if (bracketQuote) {
      if (char === "]" && value[index + 1] === "]") {
        index += 1;
      } else if (char === "]") {
        bracketQuote = false;
      }
      continue;
    }
    if (quote) {
      if (char === quote && value[index + 1] === quote) {
        index += 1;
      } else if (char === quote && value[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (["'", '"', "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketQuote = true;
      continue;
    }
    const tag = char === "$" ? readDollarQuoteTag(value, index) : "";
    if (tag) {
      dollarQuote = tag;
      index += tag.length - 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function stripSqlComments(value: string) {
  let result = "";
  let quote = "";
  let dollarQuote = "";
  let bracketQuote = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] || "";
    const next = value[index + 1] || "";
    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        result += char;
      } else {
        result += " ";
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") {
        blockCommentDepth += 1;
        result += "  ";
        index += 1;
      } else if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        result += "  ";
        index += 1;
      } else {
        result += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }
    if (dollarQuote) {
      result += char;
      if (value.startsWith(dollarQuote, index)) {
        result += value.slice(index + 1, index + dollarQuote.length);
        index += dollarQuote.length - 1;
        dollarQuote = "";
      }
      continue;
    }
    if (bracketQuote) {
      result += char;
      if (char === "]" && next === "]") {
        result += next;
        index += 1;
      } else if (char === "]") {
        bracketQuote = false;
      }
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote && next === quote) {
        result += next;
        index += 1;
      } else if (char === quote && value[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockCommentDepth = 1;
      result += "  ";
      index += 1;
      continue;
    }
    if (["'", '"', "`"].includes(char)) {
      quote = char;
      result += char;
      continue;
    }
    if (char === "[") {
      bracketQuote = true;
      result += char;
      continue;
    }
    const tag = char === "$" ? readDollarQuoteTag(value, index) : "";
    if (tag) {
      dollarQuote = tag;
      result += tag;
      index += tag.length - 1;
      continue;
    }
    result += char;
  }
  return result;
}

export function readDollarQuoteTag(value: string, start: number) {
  return (
    value.slice(start).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0] || ""
  );
}

export function leadingWords(value: string) {
  return value.replace(/\s+/g, " ").trim().split(" ").slice(0, 5).join(" ");
}
