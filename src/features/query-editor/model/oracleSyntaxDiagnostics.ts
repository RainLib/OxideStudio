export interface OracleSyntaxDiagnostic {
  startOffset: number;
  endOffset: number;
  message: string;
  code: "ORACLE001";
}

const ORACLE_DRIVERS = new Set(["oracle", "oceanbase-oracle"]);
const TABLE_CONSTRAINT_STARTERS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "UNIQUE",
  "FOREIGN",
  "CHECK",
  "EXCLUDE",
  "SUPPLEMENTAL",
  "PERIOD",
  "PARTITION",
  "SUBPARTITION",
]);
const NON_TABLE_CREATE_OBJECTS = new Set([
  "AS",
  "SELECT",
  "WITH",
  "VIEW",
  "INDEX",
  "SEQUENCE",
  "TRIGGER",
  "PROCEDURE",
  "FUNCTION",
  "PACKAGE",
]);
const ALTER_TABLE_NON_ADD_ACTIONS = new Set([
  "MODIFY",
  "DROP",
  "RENAME",
  "ENABLE",
  "DISABLE",
]);
const MESSAGE = "Oracle DEFAULT clause must appear before NOT NULL";

interface OracleToken {
  kind: "word" | "symbol";
  value: string;
  from: number;
  to: number;
}

export function supportsOracleSyntaxDiagnostics(driver?: string) {
  return ORACLE_DRIVERS.has(driver?.trim().toLowerCase() || "");
}

export function buildOracleSyntaxDiagnostics(
  source: string,
  driver?: string,
): OracleSyntaxDiagnostic[] {
  if (!supportsOracleSyntaxDiagnostics(driver)) return [];
  const diagnostics: OracleSyntaxDiagnostic[] = [];
  for (const statement of splitOracleStatements(tokenizeOracleSyntax(source))) {
    const definitionRange = columnDefinitionRange(statement);
    if (!definitionRange) continue;
    for (const definition of splitColumnDefinitions(
      statement,
      definitionRange.from,
      definitionRange.to,
    )) {
      if (TABLE_CONSTRAINT_STARTERS.has(definition.find((token) => token.kind === "word")?.value || "")) {
        continue;
      }
      const notNull = definition.findIndex(
        (token, index) =>
          token.kind === "word" &&
          token.value === "NOT" &&
          definition[index + 1]?.kind === "word" &&
          definition[index + 1]?.value === "NULL",
      );
      if (notNull < 0) continue;
      const offendingDefault = definition
        .slice(notNull + 2)
        .find((token) => token.kind === "word" && token.value === "DEFAULT");
      if (offendingDefault) {
        diagnostics.push({
          startOffset: offendingDefault.from,
          endOffset: offendingDefault.to,
          message: MESSAGE,
          code: "ORACLE001",
        });
      }
    }
  }
  return diagnostics;
}

function splitOracleStatements(tokens: readonly OracleToken[]) {
  const statements: OracleToken[][] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "symbol" && token.value === "(") depth += 1;
    else if (token.kind === "symbol" && token.value === ")") depth = Math.max(0, depth - 1);
    else if (token.kind === "symbol" && token.value === ";" && depth === 0) {
      if (start < index) statements.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  if (start < tokens.length) statements.push(tokens.slice(start));
  return statements;
}

function columnDefinitionRange(tokens: readonly OracleToken[]) {
  if (tokens[0]?.kind !== "word") return null;
  if (tokens[0].value === "CREATE") {
    let tableIndex = -1;
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token.kind === "symbol" && token.value === "(") return null;
      if (token.kind !== "word") continue;
      if (token.value === "TABLE") {
        tableIndex = index;
        break;
      }
      if (NON_TABLE_CREATE_OBJECTS.has(token.value)) return null;
    }
    if (tableIndex < 0) return null;
    const openIndex = tokens.findIndex(
      (token, index) => index > tableIndex && token.kind === "symbol" && token.value === "(",
    );
    return openIndex < 0 ? null : insideParentheses(tokens, openIndex);
  }
  if (tokens[0].value !== "ALTER") return null;
  let tableSeen = false;
  let addIndex = -1;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "word") continue;
    if (!tableSeen) {
      if (token.value === "TABLE") tableSeen = true;
      continue;
    }
    if (token.value === "ADD") {
      addIndex = index;
      break;
    }
    if (ALTER_TABLE_NON_ADD_ACTIONS.has(token.value)) return null;
  }
  if (addIndex < 0) return null;
  let from = addIndex + 1;
  if (tokens[from]?.kind === "word" && tokens[from]?.value === "COLUMN") from += 1;
  return tokens[from]?.kind === "symbol" && tokens[from]?.value === "("
    ? insideParentheses(tokens, from)
    : from < tokens.length
      ? { from, to: tokens.length }
      : null;
}

function insideParentheses(tokens: readonly OracleToken[], openIndex: number) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "symbol") continue;
    if (token.value === "(") depth += 1;
    else if (token.value === ")" && --depth === 0) return { from: openIndex + 1, to: index };
  }
  return { from: openIndex + 1, to: tokens.length };
}

function splitColumnDefinitions(
  tokens: readonly OracleToken[],
  from: number,
  to: number,
) {
  const definitions: OracleToken[][] = [];
  let start = from;
  let depth = 0;
  for (let index = from; index < to; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "symbol" && token.value === "(") depth += 1;
    else if (token.kind === "symbol" && token.value === ")") depth = Math.max(0, depth - 1);
    else if (token.kind === "symbol" && token.value === "," && depth === 0) {
      if (start < index) definitions.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  if (start < to) definitions.push(tokens.slice(start, to));
  return definitions;
}

function tokenizeOracleSyntax(source: string) {
  const tokens: OracleToken[] = [];
  for (let index = 0; index < source.length; ) {
    const character = source[index]!;
    const next = source[index + 1] || "";
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && next === "-") {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (character === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }
    if ((character === "q" || character === "Q") && next === "'") {
      index = skipOracleAlternativeQuote(source, index);
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      index = skipQuotedToken(source, index, character);
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$#]*/u.exec(source.slice(index))?.[0];
    if (word) {
      tokens.push({ kind: "word", value: word.toUpperCase(), from: index, to: index + word.length });
      index += word.length;
      continue;
    }
    tokens.push({ kind: "symbol", value: character, from: index, to: index + 1 });
    index += 1;
  }
  return tokens;
}

function skipQuotedToken(source: string, start: number, quote: string) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] !== quote) continue;
    if (source[index + 1] === quote) {
      index += 1;
      continue;
    }
    return index + 1;
  }
  return source.length;
}

function skipOracleAlternativeQuote(source: string, start: number) {
  const opener = source[start + 2] || "";
  const closer = ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[opener] || opener;
  for (let index = start + 3; index < source.length; index += 1) {
    if (source[index] === closer && source[index + 1] === "'") return index + 2;
  }
  return source.length;
}
