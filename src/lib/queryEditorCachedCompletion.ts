/**
 * Conservative relation extraction used only while SQL LSP is unavailable.
 * It deliberately recognizes a narrow, top-level SQL surface so the editor
 * can reuse one table's cached metadata without pretending to parse a full
 * vendor grammar in the renderer.
 */
export type CachedSqlRelationReference = {
  table: string;
  schema?: string;
  /** Optional catalog/database from a three-part relation identifier. */
  database?: string;
  alias?: string;
  /** A common table expression shadows a physical relation of the same name. */
  isCte?: boolean;
  /** Only explicit CTE column lists are trusted by this lightweight fallback. */
  cteColumns?: string[];
};

const RELATION_KEYWORDS = new Set(["from", "join", "update", "into"]);
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
const NON_ALIAS_KEYWORDS = new Set([
  "select",
  "with",
  "where",
  "join",
  "left",
  "right",
  "inner",
  "outer",
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

function unquoteIdentifier(value: string) {
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
function maskSqlCommentsAndLiterals(source: string) {
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
        : preserveIdentifier && current !== ";"
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
function currentTopLevelStatementBeforeCursor(source: string) {
  const masked = maskSqlCommentsAndLiterals(source);
  let parentheses = 0;
  let semicolonStart = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === ";" && parentheses === 0) {
      semicolonStart = index + 1;
    }
  }
  const segment = masked.slice(semicolonStart);
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
        candidateStart = semicolonStart + lineOffset + line.length - line.trimStart().length;
        initialKeyword = keyword;
      }
    }

    for (const character of line) {
      if (character === "(") parentheses += 1;
      else if (character === ")") parentheses = Math.max(0, parentheses - 1);
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
    source: source.slice(start),
    masked: masked.slice(start),
  };
}

/**
 * Resolves the current top-level statement while preserving the source text.
 * Lightweight editor fallbacks reuse this instead of splitting at a raw `;`,
 * so a delimiter inside a literal or comment never resets completion context.
 */
export function sqlStatementBeforeCursor(source: string) {
  return currentTopLevelStatementBeforeCursor(source).source;
}

function splitQualifiedIdentifier(value: string) {
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
      if (part) parts.push(part);
      current = "";
      continue;
    }
    current += character;
  }
  const finalPart = unquoteIdentifier(current);
  if (finalPart) parts.push(finalPart);
  if (parts.length === 0) return null;
  const relation = {
    table: parts[parts.length - 1]!,
    schema: parts.length > 1 ? parts[parts.length - 2] : undefined,
  };
  const database = parts.length > 2 ? parts[parts.length - 3] : undefined;
  return database ? { ...relation, database } : relation;
}

const SQL_IDENTIFIER =
  '(?:"(?:""|[^"])+"|`(?:``|[^`])+`|\\[(?:\\]\\]|[^\\]])+\\]|[A-Za-z_][\\w$]*)';
const TRAILING_IDENTIFIER_FRAGMENT =
  '(?:"[^"]*|`[^`]*|\\[[^\\]]*|[A-Za-z_][\\w$]*)';
const RELATION_MATCHER = new RegExp(
  `\\b(from|join|update|into)\\s+(${SQL_IDENTIFIER}(?:\\.${SQL_IDENTIFIER})*)\\s*(?:as\\s+)?(${SQL_IDENTIFIER})?`,
  "gi",
);
const TRAILING_QUALIFIER = new RegExp(
  `(${SQL_IDENTIFIER})\\s*\\.\\s*${TRAILING_IDENTIFIER_FRAGMENT}?$`,
  "i",
);
const CTE_DECLARATION_MATCHER = new RegExp(
  `(?:\\bwith\\b|,)\\s*(?:recursive\\s+)?(${SQL_IDENTIFIER})(?:\\s*\\(([^)]*)\\))?\\s+as\\s*\\(`,
  "gi",
);

function splitDelimitedIdentifiers(value: string) {
  const values: string[] = [];
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
    if (character === ",") {
      const identifier = unquoteIdentifier(current);
      if (identifier) values.push(identifier);
      current = "";
      continue;
    }
    current += character;
  }
  const identifier = unquoteIdentifier(current);
  if (identifier) values.push(identifier);
  return values;
}

function cteDeclarations(source: string) {
  const declarations = new Map<string, string[]>();
  for (const match of source.matchAll(CTE_DECLARATION_MATCHER)) {
    const name = unquoteIdentifier(match[1]!);
    if (!name) continue;
    declarations.set(
      name.toLocaleLowerCase(),
      match[2] ? splitDelimitedIdentifiers(match[2]) : [],
    );
  }
  return declarations;
}

export function cachedSqlRelationsBeforeCursor(
  textBeforeCursor: string,
): CachedSqlRelationReference[] {
  const statement = currentTopLevelStatementBeforeCursor(textBeforeCursor);
  const ctes = cteDeclarations(statement.masked);
  const relations: CachedSqlRelationReference[] = [];
  for (const match of statement.masked.matchAll(RELATION_MATCHER)) {
    if (!RELATION_KEYWORDS.has(match[1]!.toLowerCase())) continue;
    const relation = splitQualifiedIdentifier(match[2]!);
    if (!relation) continue;
    const alias = match[3] ? unquoteIdentifier(match[3]) : undefined;
    const possibleAlias = alias?.toLowerCase();
    const cteColumns = ctes.get(relation.table.toLocaleLowerCase());
    relations.push({
      ...relation,
      ...(cteColumns
        ? { isCte: true, cteColumns }
        : {}),
      alias:
        possibleAlias && !NON_ALIAS_KEYWORDS.has(possibleAlias)
          ? alias
          : undefined,
    });
  }
  return relations;
}

/**
 * Resolves the only safe metadata target for a field completion fallback.
 * With an explicit `alias.` qualifier we can select that relation; without a
 * qualifier we require exactly one visible relation to avoid leaking fields
 * from arbitrary tables into an ambiguous join.
 */
export function cachedSqlRelationForFieldCompletion(
  textBeforeCursor: string,
): CachedSqlRelationReference | null {
  const statement = currentTopLevelStatementBeforeCursor(textBeforeCursor);
  const qualifierMatch = statement.source.match(TRAILING_QUALIFIER);
  const qualifier = qualifierMatch?.[1]
    ? unquoteIdentifier(qualifierMatch[1])
    : undefined;
  const ctes = cteDeclarations(statement.masked);
  const relations = cachedSqlRelationsBeforeCursor(statement.source);
  if (qualifier) {
    const normalized = qualifier.toLowerCase();
    const cteColumns = ctes.get(normalized);
    if (cteColumns) {
      return {
        table: qualifier,
        schema: undefined,
        isCte: true,
        cteColumns,
        alias: undefined,
      };
    }
    return (
      relations
        .slice()
        .reverse()
        .find(
          (relation) =>
            relation.alias?.toLowerCase() === normalized ||
            relation.table.toLowerCase() === normalized,
        ) || null
    );
  }
  return relations.length === 1 ? relations[0]! : null;
}
