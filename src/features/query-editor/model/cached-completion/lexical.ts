export const RELATION_KEYWORDS = new Set(["from", "join", "update", "into", "apply"]);
const SOFT_STATEMENT_KEYWORDS = new Set([
  "select",
  "with",
  "insert",
  "update",
  "delete",
  "merge",
  "replace",
  "create",
  "alter",
  "drop",
  "truncate",
  "explain",
  "show",
  "describe",
  "desc",
  "use",
  "call",
  "exec",
  "execute",
  "begin",
  "commit",
  "rollback",
  "analyze",
  "vacuum",
]);
export const NON_ALIAS_KEYWORDS = new Set([
  "as",
  "except",
  "intersect",
  "minus",
  "qualify",
  "window",
  "fetch",
  "for",
  "using",
  "natural",
  "tablesample",
  "pivot",
  "unpivot",
  "connect",
  "start",
  "model",
  "match_recognize",
  "prewhere",
  "settings",
  "format",
  "sample",
  "select",
  "with",
  "where",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "lateral",
  "apply",
  "full",
  "cross",
  "on",
  "group",
  "order",
  "limit",
  "offset",
  "having",
  "union",
  "returning",
  "set",
  "values",
]);

export function unquoteIdentifier(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed.slice(1, -1).replace(/""|``|]]/g, (match) => match[0]!);
  }
  return trimmed;
}

/** Preserve character offsets while hiding comments and literals from a small
 * regex-based relation extractor. */
export function maskSqlCommentsAndLiterals(source: string) {
  let output = "";
  let index = 0;
  let quote: "'" | '"' | "`" | "[" | null = null;
  let lineComment = false;
  let blockComment = false;
  while (index < source.length) {
    const current = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        output += current;
      } else {
        output += " ";
      }
      index += 1;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 2;
        blockComment = false;
      } else {
        output += current === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (quote) {
      // Keep quoted identifiers recognizable to the relation/alias fallback,
      // but neutralize only their delimiters for statement-boundary scanning.
      // String literals remain fully hidden so a literal cannot look like a
      // FROM/JOIN clause.
      const preserveIdentifier = quote !== "'";
      output += current === "\n"
        ? "\n"
        : preserveIdentifier
          ? current
          : " ";
      if (quote === "[") {
        if (current === "]") {
          if (next === "]") {
            output += preserveIdentifier ? next : " ";
            index += 2;
            continue;
          }
          quote = null;
        }
      } else if (current === quote) {
        if (next === quote) {
          output += preserveIdentifier ? next : " ";
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }
    if (current === "-" && next === "-") {
      output += "  ";
      index += 2;
      lineComment = true;
      continue;
    }
    if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      blockComment = true;
      continue;
    }
    if (current === "'") {
      quote = current;
      output += " ";
      index += 1;
      continue;
    }
    if (current === '"' || current === "`" || current === "[") {
      quote = current;
      output += current;
      index += 1;
      continue;
    }
    if (current === "$") {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        const closingOffset = source.indexOf(tag, index + tag.length);
        const end = closingOffset === -1 ? source.length : closingOffset + tag.length;
        for (let offset = index; offset < end; offset += 1) {
          output += source[offset] === "\n" ? "\n" : " ";
        }
        index = end;
        continue;
      }
    }
    output += current;
    index += 1;
  }
  return output;
}

function softStatementKeyword(line: string) {
  const keyword = line.trimStart().match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  if (!keyword) return undefined;
  const normalized = keyword.toLowerCase();
  return SOFT_STATEMENT_KEYWORDS.has(normalized) ? normalized : undefined;
}

function isWrappedStatementContinuation(initial: string, candidate: string) {
  if (initial === "with") {
    return ["select", "insert", "update", "delete", "merge"].includes(candidate);
  }
  if (initial === "insert") return candidate === "select" || candidate === "with";
  if (["explain", "describe", "desc"].includes(initial)) {
    return ["select", "with", "insert", "update", "delete", "merge"].includes(
      candidate,
    );
  }
  if (initial === "create") {
    return ["select", "with", "begin"].includes(candidate);
  }
  return initial === "alter" && candidate === "update";
}

function isSetOperationContinuation(previousNonEmptyLine: string, candidate: string) {
  return (
    candidate === "select" &&
    ["UNION", "UNION ALL", "INTERSECT", "EXCEPT", "MINUS"].includes(
      previousNonEmptyLine.trim().toUpperCase(),
    )
  );
}

/**
 * Cached completion deliberately works on one statement only. A document may
 * contain several complete queries, and relations from an earlier query must
 * not make an unqualified completion in the next query ambiguous. Semicolons
 * in comments and string literals are already hidden by the mask; semicolons
 * nested in an expression are retained as part of that statement. A blank
 * line before an unambiguously top-level statement keyword is also a soft
 * boundary, matching the Rust query selection and LSP parser behaviour when
 * users type several console queries without semicolons.
 */
function structureWithoutQuotedIdentifiers(masked: string) {
  let output = "", quote: string | undefined;
  for (let index = 0; index < masked.length; index++) {
    const character = masked[index]!;
    if (quote) {
      output += character === "\n" ? "\n" : " ";
      if (character === quote) {
        if (masked[index + 1] === quote) { output += " "; index++; }
        else quote = undefined;
      }
    } else if (character === '"' || character === '`' || character === '[') {
      quote = character === '[' ? ']' : character;
      output += " ";
    } else output += character;
  }
  return output;
}

export type CachedSqlStatement = { source: string; masked: string; cursorOffset: number };

/** Select one statement from a complete document. Quoted identifier contents
 * must not change parentheses, semicolon or blank-line statement boundaries. */
export function currentTopLevelStatementAtCursor(source: string, cursorOffset: number): CachedSqlStatement {
  const masked = maskSqlCommentsAndLiterals(source);
  const structure = structureWithoutQuotedIdentifiers(masked);
  let parentheses = 0;
  let semicolonStart = 0;
  let end = source.length;
  for (let index = 0; index < structure.length; index += 1) {
    const character = structure[index];
    if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === ";" && parentheses === 0) {
      if (index < cursorOffset) semicolonStart = index + 1;
      else { end = index; break; }
    }
  }
  const segment = structure.slice(semicolonStart, end);
  let initialKeyword: string | undefined;
  let previousNonEmptyLine = "";
  let blankLines = 0;
  parentheses = 0;
  let candidateStart: number | undefined;
  let lineOffset = 0;

  for (const lineWithNewline of segment.matchAll(/.*(?:\n|$)/g)) {
    const fullLine = lineWithNewline[0];
    if (!fullLine) continue;
    const line = fullLine.endsWith("\n") ? fullLine.slice(0, -1) : fullLine;
    const trimmed = line.trim();
    const keyword = softStatementKeyword(line);

    if (!initialKeyword && trimmed) {
      initialKeyword = keyword;
    } else if (blankLines > 0 && parentheses === 0 && initialKeyword && keyword) {
      if (
        !isWrappedStatementContinuation(initialKeyword, keyword) &&
        !isSetOperationContinuation(previousNonEmptyLine, keyword)
      ) {
        const candidate = semicolonStart + lineOffset + line.length - line.trimStart().length;
        if (candidate > cursorOffset) { end = candidate; break; }
        candidateStart = candidate;
        initialKeyword = keyword;
      }
    }

    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === "(") parentheses += 1;
      else if (character === ")") parentheses = Math.max(0, parentheses - 1);
      else if (parentheses === 0 && /[A-Za-z_]/u.test(character!)) {
        const start = index;
        while (index + 1 < line.length && /[A-Za-z0-9_]/u.test(line[index + 1]!)) index++;
        const word = line.slice(start, index + 1).toLowerCase();
        if (initialKeyword && isWrappedStatementContinuation(initialKeyword, word)) initialKeyword = word;
      }
    }
    if (trimmed) {
      previousNonEmptyLine = trimmed;
      blankLines = 0;
    } else if (initialKeyword) {
      blankLines += 1;
    }
    lineOffset += fullLine.length;
  }
  const start = candidateStart ?? semicolonStart;
  return {
    source: source.slice(start, end),
    masked: masked.slice(start, end),
    cursorOffset: cursorOffset - start,
  };
}

export function currentTopLevelStatementBeforeCursor(source: string) {
  const { source: statement, masked } = currentTopLevelStatementAtCursor(source, source.length);
  return { source: statement, masked };
}

/**
 * Resolves the current top-level statement while preserving the source text.
 * Lightweight editor fallbacks reuse this instead of splitting at a raw `;`,
 * so a delimiter inside a literal or comment never resets completion context.
 */
export function sqlStatementBeforeCursor(source: string) {
  return currentTopLevelStatementBeforeCursor(source).source;
}

export function splitQualifiedIdentifier(value: string) {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "`" | "[" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    const next = value[index + 1];
    if (quote === "[") {
      current += character;
      if (character === "]") {
        if (next === "]") {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === '"' || character === "`" || character === "[") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ".") {
      const part = unquoteIdentifier(current);
      // Preserve SQL Server's intentionally omitted schema in
      // `database..table`. Dropping the empty segment would reinterpret the
      // database as a schema and load metadata from the wrong catalog.
      parts.push(part);
      current = "";
      continue;
    }
    current += character;
  }
  const finalPart = unquoteIdentifier(current);
  if (!finalPart) return null;
  parts.push(finalPart);
  if (parts.length > 4) return null;
  const relation = {
    table: parts[parts.length - 1]!,
    schema: parts.length > 1 ? parts[parts.length - 2] || undefined : undefined,
  };
  const database = parts.length > 2 ? parts[parts.length - 3] : undefined;
  const qualified = database ? { ...relation, database } : relation;
  return { ...qualified, ...(parts.length === 4 ? {server:parts[0] || undefined} : {}), ...(parts.length >= 3 && !parts[parts.length - 2] ? {schemaOmitted:true as const} : {}) };
}
