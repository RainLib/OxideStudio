export interface MysqlRoutineSyntaxDiagnostic {
  startOffset: number;
  endOffset: number;
  message: string;
  code: "MYSQL001" | "MYSQL002" | "MYSQL003";
}

export interface MysqlRoutineSyntaxAnalysis {
  diagnostics: MysqlRoutineSyntaxDiagnostic[];
  routineRanges: Array<{ from: number; to: number }>;
  skippedOversizedDocument: boolean;
}

type RoutineKind = "PROCEDURE" | "FUNCTION";
type RoutineBlock = "BEGIN" | "CASE";
type ParameterTokenKind = "comma" | "other";

interface StatementScan {
  start: number | null;
  createStart: number | null;
  wordCount: number;
  createCandidate: boolean;
  routineKind: RoutineKind | null;
  parameterDepth: number;
  parameterStarted: boolean;
  parameterEnded: boolean;
  lastParameterToken: { kind: ParameterTokenKind; from: number; to: number } | null;
  blocks: RoutineBlock[];
  sawBegin: boolean;
  lastWordWasEnd: boolean;
  pendingEnd: boolean;
  pendingFunctionReturn: { from: number; to: number } | null;
}

const MAX_DIAGNOSTIC_DOCUMENT_LENGTH = 4 * 1024 * 1024;
const NON_ROUTINE_CREATE_TYPES = new Set([
  "DATABASE",
  "INDEX",
  "LOGFILE",
  "ROLE",
  "SCHEMA",
  "SERVER",
  "SPATIAL",
  "TABLE",
  "TEMPORARY",
  "UNIQUE",
  "USER",
  "VIEW",
]);
const CONTROL_BLOCK_SUFFIXES = new Set(["IF", "LOOP", "REPEAT", "WHILE"]);

function newStatementScan(): StatementScan {
  return {
    start: null,
    createStart: null,
    wordCount: 0,
    createCandidate: false,
    routineKind: null,
    parameterDepth: 0,
    parameterStarted: false,
    parameterEnded: false,
    lastParameterToken: null,
    blocks: [],
    sawBegin: false,
    lastWordWasEnd: false,
    pendingEnd: false,
    pendingFunctionReturn: null,
  };
}

export function supportsMysqlRoutineSyntaxDiagnostics(driver?: string | null) {
  const normalized = String(driver || "").trim().toLowerCase();
  return normalized === "mysql" || normalized === "custom_mysql" || normalized === "custom-mysql";
}

/**
 * Analyze MySQL routine declarations without invoking a second SQL parser.
 * The scanner is quote/comment/delimiter aware and retains only the active
 * statement's small block/parameter state, so time is O(n) and memory is O(depth).
 */
export function analyzeMysqlRoutineSyntax(source: string): MysqlRoutineSyntaxAnalysis {
  if (source.length > MAX_DIAGNOSTIC_DOCUMENT_LENGTH) {
    return { diagnostics: [], routineRanges: [], skippedOversizedDocument: true };
  }

  const diagnostics: MysqlRoutineSyntaxDiagnostic[] = [];
  const routineRanges: Array<{ from: number; to: number }> = [];
  let statement = newStatementScan();
  let delimiter = ";";
  let index = 0;

  const markContent = (offset: number) => {
    if (statement.start === null) statement.start = offset;
  };

  const reportPendingFunctionReturn = () => {
    const pending = statement.pendingFunctionReturn;
    if (!pending) return;
    diagnostics.push({
      startOffset: pending.from,
      endOffset: pending.to,
      message: "RETURN in a MySQL function requires an expression",
      code: "MYSQL003",
    });
    statement.pendingFunctionReturn = null;
  };

  const finalizeStatement = (to: number) => {
    reportPendingFunctionReturn();
    if (statement.routineKind && statement.createStart !== null) {
      routineRanges.push({
        from: statement.createStart,
        to: trimEndOffset(source, statement.createStart, to),
      });
    }
    statement = newStatementScan();
  };

  const observeRoutineWord = (word: string, from: number, to: number) => {
    markContent(from);
    statement.wordCount += 1;
    if (statement.wordCount === 1) {
      statement.createCandidate = word === "CREATE";
      statement.createStart = statement.createCandidate ? from : null;
    } else if (
      statement.createCandidate &&
      statement.wordCount <= 16 &&
      !statement.routineKind
    ) {
      if (word === "PROCEDURE" || word === "FUNCTION") {
        statement.routineKind = word;
      } else if (NON_ROUTINE_CREATE_TYPES.has(word)) {
        statement.createCandidate = false;
      }
    }

    if (!statement.routineKind) {
      statement.lastWordWasEnd = word === "END";
      return;
    }

    if (statement.pendingFunctionReturn) {
      statement.pendingFunctionReturn = null;
    }

    if (statement.pendingEnd) {
      if (word === "CASE") {
        if (statement.blocks[statement.blocks.length - 1] === "CASE") {
          statement.blocks.pop();
        }
      } else if (!CONTROL_BLOCK_SUFFIXES.has(word)) {
        statement.blocks.pop();
      }
      statement.pendingEnd = false;
    }

    if (word === "BEGIN") {
      if (!statement.lastWordWasEnd) {
        statement.sawBegin = true;
        statement.blocks.push("BEGIN");
      }
    } else if (word === "CASE") {
      if (!statement.lastWordWasEnd) statement.blocks.push("CASE");
    } else if (word === "END" && statement.sawBegin) {
      statement.pendingEnd = true;
    }

    if (statement.parameterEnded && word === "RETURN") {
      if (statement.routineKind === "PROCEDURE") {
        diagnostics.push({
          startOffset: from,
          endOffset: to,
          message: "RETURN is not valid in a MySQL procedure; use LEAVE with a block label",
          code: "MYSQL002",
        });
      } else {
        statement.pendingFunctionReturn = { from, to };
      }
    }
    statement.lastWordWasEnd = word === "END";
  };

  const observeSymbol = (symbol: string, from: number, to: number) => {
    markContent(from);
    if (!statement.routineKind) return;

    if (symbol !== ";" && statement.pendingFunctionReturn) {
      statement.pendingFunctionReturn = null;
    }

    if (symbol === "(" && !statement.parameterStarted) {
      statement.parameterStarted = true;
      statement.parameterDepth = 1;
      statement.lastParameterToken = null;
      return;
    }
    if (!statement.parameterStarted || statement.parameterEnded) return;
    if (symbol === "(") {
      statement.parameterDepth += 1;
      statement.lastParameterToken = { kind: "other", from, to };
      return;
    }
    if (symbol === ")") {
      if (statement.parameterDepth === 1) {
        if (statement.lastParameterToken?.kind === "comma") {
          diagnostics.push({
            startOffset: statement.lastParameterToken.from,
            endOffset: statement.lastParameterToken.to,
            message: "Trailing comma is not allowed in a MySQL routine parameter list",
            code: "MYSQL001",
          });
        }
        statement.parameterDepth = 0;
        statement.parameterEnded = true;
      } else {
        statement.parameterDepth = Math.max(0, statement.parameterDepth - 1);
        statement.lastParameterToken = { kind: "other", from, to };
      }
      return;
    }
    statement.lastParameterToken = {
      kind: symbol === "," && statement.parameterDepth === 1 ? "comma" : "other",
      from,
      to,
    };
  };

  const routineSemicolonIsInternal = () => {
    reportPendingFunctionReturn();
    if (!statement.routineKind || !statement.sawBegin) {
      statement.lastWordWasEnd = false;
      return false;
    }
    if (statement.pendingEnd) {
      statement.blocks.pop();
      statement.pendingEnd = false;
    }
    statement.lastWordWasEnd = false;
    return statement.blocks.length > 0;
  };

  while (index < source.length) {
    if (index === 0 || source[index - 1] === "\n") {
      const directive = delimiterDirectiveAt(source, index);
      if (directive) {
        if (statement.start !== null) finalizeStatement(index);
        delimiter = directive.delimiter;
        index = directive.nextLine;
        continue;
      }
    }

    if (delimiter !== ";" && source.startsWith(delimiter, index)) {
      finalizeStatement(index);
      index += delimiter.length;
      continue;
    }

    const character = source[index] || "";
    const next = source[index + 1] || "";
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if ((character === "-" && next === "-" && /\s/u.test(source[index + 2] || "")) || character === "#") {
      index = skipLineComment(source, index + (character === "#" ? 1 : 2));
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      markContent(index);
      if (statement.pendingFunctionReturn) statement.pendingFunctionReturn = null;
      const end = skipQuoted(source, index, character);
      if (statement.parameterStarted && !statement.parameterEnded) {
        statement.lastParameterToken = { kind: "other", from: index, to: end };
      }
      index = end;
      continue;
    }

    if (isWordStart(character)) {
      const end = wordEnd(source, index, delimiter);
      observeRoutineWord(source.slice(index, end).toUpperCase(), index, end);
      if (statement.parameterStarted && !statement.parameterEnded) {
        statement.lastParameterToken = { kind: "other", from: index, to: end };
      }
      index = end;
      continue;
    }

    if (character === ";" && delimiter === ";") {
      observeSymbol(character, index, index + 1);
      if (routineSemicolonIsInternal()) {
        index += 1;
        continue;
      }
      finalizeStatement(index);
      index += 1;
      continue;
    }

    observeSymbol(character, index, index + 1);
    index += 1;
  }

  if (statement.start !== null) finalizeStatement(source.length);
  return { diagnostics, routineRanges, skippedOversizedDocument: false };
}

export function isMysqlRoutineParserDiagnostic(
  diagnostic: { source?: string; code?: string | number | { value?: unknown } },
) {
  const source = String(diagnostic.source || "").toLowerCase();
  const rawCode =
    typeof diagnostic.code === "object" && diagnostic.code
      ? diagnostic.code.value
      : diagnostic.code;
  const code = String(rawCode || "").toUpperCase();
  return source === "tree-sitter-sql" && (code === "SYNTAX_ERROR" || code === "PARSE_ERROR");
}

function delimiterDirectiveAt(source: string, lineStart: number) {
  const newline = source.indexOf("\n", lineStart);
  const lineEnd = newline === -1 ? source.length : newline;
  const line = source.slice(lineStart, lineEnd).trim();
  const match = /^DELIMITER(?:\s+)(\S+)\s*$/iu.exec(line);
  if (!match?.[1] || /\s/u.test(match[1])) return null;
  return {
    delimiter: match[1],
    nextLine: newline === -1 ? source.length : newline + 1,
  };
}

function trimEndOffset(source: string, from: number, to: number) {
  let end = Math.max(from, Math.min(source.length, to));
  while (end > from && /\s/u.test(source[end - 1] || "")) end -= 1;
  return end;
}

function skipLineComment(source: string, from: number) {
  const newline = source.indexOf("\n", from);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, from: number) {
  const close = source.indexOf("*/", from);
  return close === -1 ? source.length : close + 2;
}

function skipQuoted(source: string, start: number, quote: string) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      index += 2;
      continue;
    }
    if (source[index] === quote && source[index + 1] === quote) {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function isWordStart(character: string) {
  return /[A-Za-z_]/u.test(character);
}

function wordEnd(source: string, start: number, delimiter: string) {
  let index = start + 1;
  while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index] || "")) {
    if (delimiter !== ";" && source.startsWith(delimiter, index)) break;
    index += 1;
  }
  return index;
}
