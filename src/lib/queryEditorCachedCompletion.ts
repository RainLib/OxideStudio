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
  /** Exact SQL spelling of the alias, including its original delimiters. */
  aliasSql?: string;
  /** A common table expression shadows a physical relation of the same name. */
  isCte?: boolean;
  /** A closed FROM/JOIN subquery with a visible alias and derived columns. */
  isDerived?: boolean;
  /** Only explicit CTE column lists are trusted by this lightweight fallback. */
  cteColumns?: string[];
};

export type CachedSqlJoinTargetContext = {
  /** Relations that are already complete before the JOIN target being typed. */
  sourceRelations: CachedSqlRelationReference[];
  /** The possibly-qualified target fragment after the active JOIN keyword. */
  targetFragment: string;
};

export type CachedSqlProjectionSource = {
  database?: string;
  schema?: string;
  tableName: string;
  sourceColumn: string;
};

const RELATION_KEYWORDS = new Set(["from", "join", "update", "into", "apply"]);
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
  const relation = {
    table: parts[parts.length - 1]!,
    schema: parts.length > 1 ? parts[parts.length - 2] || undefined : undefined,
  };
  const database = parts.length > 2 ? parts[parts.length - 3] : undefined;
  return database ? { ...relation, database } : relation;
}

const UNQUOTED_SQL_IDENTIFIER =
  '[_\\p{ID_Start}][$@#_\\u200c\\u200d\\p{ID_Continue}]*';
const SQL_IDENTIFIER =
  `(?:"(?:""|[^"])+"|\`(?:\`\`|[^\`])+\`|\\[(?:\\]\\]|[^\\]])+\\]|${UNQUOTED_SQL_IDENTIFIER})`;
// Besides ordinary one-to-four-part names, SQL Server accepts an omitted
// schema (`database..table` and `server.database..table`). Keep the empty
// segment visible to splitQualifiedIdentifier instead of letting the matcher
// stop after the first identifier.
const QUALIFIED_RELATION_IDENTIFIER =
  `(?:(?:${SQL_IDENTIFIER}\\s*\\.\\s*)?${SQL_IDENTIFIER}\\s*\\.\\s*\\.\\s*${SQL_IDENTIFIER}|${SQL_IDENTIFIER}(?:\\s*\\.\\s*${SQL_IDENTIFIER}){0,3})`;
const TRAILING_IDENTIFIER_FRAGMENT =
  `(?:"[^"]*|\`[^\`]*|\\[[^\\]]*|${UNQUOTED_SQL_IDENTIFIER})`;
const RELATION_MATCHER = new RegExp(
  `\\b(from|join|update|into|apply)\\s+(?:lateral\\s+)?(${QUALIFIED_RELATION_IDENTIFIER})\\s*(?:as\\s+)?(${SQL_IDENTIFIER})?`,
  "giu",
);
const TRAILING_QUALIFIER = new RegExp(
  `(${SQL_IDENTIFIER})\\s*\\.\\s*${TRAILING_IDENTIFIER_FRAGMENT}?$`,
  "iu",
);
const CTE_DECLARATION_MATCHER = new RegExp(
  `(?:\\bwith\\b|,)\\s*(?:recursive\\s+)?(${SQL_IDENTIFIER})(?:\\s*\\(([^)]*)\\))?\\s+as\\s*\\(`,
  "giu",
);
const JOIN_TARGET_CONTEXT_MATCHER = new RegExp(
  `\\b(?:(?:left|right|full|inner|outer|cross|natural)\\s+)*(?:join)\\s+((?:${SQL_IDENTIFIER}\\s*\\.\\s*)*(?:${TRAILING_IDENTIFIER_FRAGMENT})?)$`,
  "iu",
);
const RELATION_TARGET_CONTEXT_MATCHER = new RegExp(
  `\\b(?:from|join|into|update|truncate\\s+table|alter\\s+table|drop\\s+(?:table|view)|describe|desc)\\s+((?:${SQL_IDENTIFIER}\\s*\\.\\s*)*(?:${TRAILING_IDENTIFIER_FRAGMENT})?)$`,
  "iu",
);
const SUBQUERY_RELATION_MATCHER = /\b(?:from|join|apply)\s+(?:lateral\s+)?\(/giu;
const TABLE_FUNCTION_RELATION_MATCHER = new RegExp(
  `\\b(?:from|join|apply)\\s+(?:lateral\\s+)?${SQL_IDENTIFIER}(?:\\.${SQL_IDENTIFIER})*\\s*\\(`,
  "giu",
);
const COMPLETE_QUALIFIED_IDENTIFIER_MATCHER = new RegExp(
  `^${SQL_IDENTIFIER}(?:\\s*\\.\\s*${SQL_IDENTIFIER})*$`,
  "iu",
);
const TRAILING_AS_ALIAS_MATCHER = new RegExp(
  `\\bas\\s+(${SQL_IDENTIFIER})\\s*$`,
  "iu",
);
const TRAILING_IMPLICIT_ALIAS_MATCHER = new RegExp(
  `\\s+(${SQL_IDENTIFIER})\\s*$`,
  "iu",
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

function matchingParenthesis(source: string, openOffset: number) {
  let depth = 0;
  for (let index = openOffset; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function topLevelSelectList(source: string, masked: string) {
  const select = masked.match(/^\s*select\b/iu);
  if (!select) return null;
  const start = select[0].length;
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      /^from\b/iu.test(masked.slice(index)) &&
      (index === 0 || /\s/u.test(masked[index - 1]!))
    ) {
      return source.slice(start, index).replace(/^\s*distinct\b/iu, "");
    }
  }
  return source.slice(start).replace(/^\s*distinct\b/iu, "");
}

function splitTopLevelExpressions(source: string) {
  const expressions: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "`" | "[" | "'" | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (quote === "[") {
      if (character === "]") {
        if (next === "]") index += 1;
        else quote = null;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (["\"", "`", "[", "'"].includes(character)) {
      quote = character as '"' | "`" | "[" | "'";
    } else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      expressions.push(source.slice(start, index));
      start = index + 1;
    }
  }
  expressions.push(source.slice(start));
  return expressions;
}

function derivedColumnName(expression: string) {
  const trimmed = expression.trim();
  if (!trimmed || trimmed === "*" || trimmed.endsWith(".*")) return null;
  const explicitAlias = trimmed.match(TRAILING_AS_ALIAS_MATCHER)?.[1];
  if (explicitAlias) return unquoteIdentifier(explicitAlias);
  const implicitAlias = trimmed.match(TRAILING_IMPLICIT_ALIAS_MATCHER)?.[1];
  if (implicitAlias) return unquoteIdentifier(implicitAlias);
  const identifier = splitQualifiedIdentifier(trimmed);
  return identifier && COMPLETE_QUALIFIED_IDENTIFIER_MATCHER.test(trimmed)
    ? identifier.table
    : null;
}

function derivedSubqueryRelations(source: string, masked: string) {
  const relations: CachedSqlRelationReference[] = [];
  for (const match of masked.matchAll(SUBQUERY_RELATION_MATCHER)) {
    const openOffset = (match.index || 0) + match[0].lastIndexOf("(");
    const closeOffset = matchingParenthesis(masked, openOffset);
    if (closeOffset < 0) continue;
    const aliasMatch = source
      .slice(closeOffset + 1)
      .match(new RegExp(`^\\s*(?:as\\s+)?(${SQL_IDENTIFIER})`, "iu"));
    const alias = aliasMatch?.[1] ? unquoteIdentifier(aliasMatch[1]) : "";
    if (!alias || NON_ALIAS_KEYWORDS.has(alias.toLocaleLowerCase())) continue;
    const selectList = topLevelSelectList(
      source.slice(openOffset + 1, closeOffset),
      masked.slice(openOffset + 1, closeOffset),
    );
    const columns = selectList
      ? splitTopLevelExpressions(selectList)
          .map(derivedColumnName)
          .filter((column): column is string => Boolean(column))
      : [];
    relations.push({
      table: alias,
      alias,
      aliasSql: aliasMatch?.[1],
      isDerived: true,
      cteColumns: [...new Set(columns)],
    });
  }
  return relations;
}

function tableFunctionRelations(source: string, masked: string) {
  const relations: CachedSqlRelationReference[] = [];
  for (const match of masked.matchAll(TABLE_FUNCTION_RELATION_MATCHER)) {
    const openOffset = (match.index || 0) + match[0].lastIndexOf("(");
    const closeOffset = matchingParenthesis(masked, openOffset);
    if (closeOffset < 0) continue;
    const aliasMatch = source
      .slice(closeOffset + 1)
      .match(
        new RegExp(
          `^\\s*(?:as\\s+)?(${SQL_IDENTIFIER})(?:\\s*\\(([^)]*)\\))?`,
          "iu",
        ),
      );
    const alias = aliasMatch?.[1] ? unquoteIdentifier(aliasMatch[1]) : "";
    if (!alias || NON_ALIAS_KEYWORDS.has(alias.toLocaleLowerCase())) continue;
    relations.push({
      table: alias,
      alias,
      aliasSql: aliasMatch?.[1],
      isDerived: true,
      cteColumns: aliasMatch?.[2]
        ? splitDelimitedIdentifiers(aliasMatch[2])
        : [],
    });
  }
  return relations;
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
      aliasSql:
        possibleAlias && !NON_ALIAS_KEYWORDS.has(possibleAlias)
          ? match[3]
          : undefined,
    });
  }
  relations.push(
    ...derivedSubqueryRelations(statement.source, statement.masked),
    ...tableFunctionRelations(statement.source, statement.masked),
  );
  return relations;
}

/**
 * Returns the active JOIN target and only the relations that precede it.
 * Keeping the target fragment out of the relation list matters while users
 * type `JOIN cust`: the incomplete `cust` token must never be mistaken for a
 * metadata source and trigger a speculative database lookup.
 */
export function cachedSqlJoinTargetContext(
  textBeforeCursor: string,
): CachedSqlJoinTargetContext | null {
  const statement = currentTopLevelStatementBeforeCursor(textBeforeCursor);
  const match = statement.masked.match(JOIN_TARGET_CONTEXT_MATCHER);
  if (!match) return null;

  const maskedTarget = match[1] || "";
  const targetStart = statement.masked.length - maskedTarget.length;
  const sourceBeforeTarget = statement.source.slice(0, targetStart);
  const targetFragment = statement.source.slice(targetStart).trim();
  const sourceRelations = cachedSqlRelationsBeforeCursor(sourceBeforeTarget);
  if (sourceRelations.length === 0) return null;

  return { sourceRelations, targetFragment };
}

/**
 * Returns the relation-name fragment currently being typed. Unlike a trailing
 * keyword check, this remains true after `FROM cus` and supports Unicode and
 * qualified SQL Server names, which is required for pinyin-backed matching.
 */
export function cachedSqlRelationTargetPrefix(textBeforeCursor: string) {
  const statement = currentTopLevelStatementBeforeCursor(textBeforeCursor);
  const match = statement.masked.match(RELATION_TARGET_CONTEXT_MATCHER);
  if (!match) return null;
  const fragment = statement.source
    .slice(statement.masked.length - (match[1]?.length || 0))
    .trim();
  if (!fragment) return "";
  const lastPart = fragment.split(".").pop()?.trim() || "";
  return lastPart.replace(/^["`\[]/u, "").replace(/["`\]]$/u, "");
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
    const reversed = relations.slice().reverse();
    // SQL aliases shadow relation names in the active query block. Resolve
    // them in a separate pass so `orders users JOIN users u ... users.` binds
    // to the alias even though a later physical table has the same name.
    const aliased = reversed.find(
      (relation) => relation.alias?.toLowerCase() === normalized,
    );
    if (aliased) return aliased;

    // Keep the existing authoring fallback for a declared CTE before the
    // outer FROM clause is written. An explicitly aliased CTE is no longer
    // addressable by its declaration name, just like a physical relation.
    const cteColumns = ctes.get(normalized);
    const cteWasAliased = reversed.some(
      (relation) =>
        relation.isCte &&
        relation.alias &&
        relation.table.toLowerCase() === normalized,
    );
    if (cteColumns && !cteWasAliased) {
      return {
        table: qualifier,
        schema: undefined,
        isCte: true,
        cteColumns,
        alias: undefined,
      };
    }

    // Once a relation has an alias, SQL no longer permits its base name as a
    // qualifier. Returning it here would fabricate columns for invalid SQL
    // and, in collision cases, query the wrong metadata target.
    return (
      reversed.find(
        (relation) =>
          !relation.alias && relation.table.toLowerCase() === normalized,
      ) || null
    );
  }
  return relations.length === 1 ? relations[0]! : null;
}

function projectionWithoutAlias(expression: string) {
  const trimmed = expression.trim();
  const explicit = trimmed.match(TRAILING_AS_ALIAS_MATCHER);
  if (explicit?.index !== undefined) return trimmed.slice(0, explicit.index).trim();
  const implicit = trimmed.match(TRAILING_IMPLICIT_ALIAS_MATCHER);
  if (implicit?.index !== undefined) {
    const candidate = trimmed.slice(0, implicit.index).trim();
    if (COMPLETE_QUALIFIED_IDENTIFIER_MATCHER.test(candidate)) return candidate;
  }
  return trimmed;
}

function singleProjectionStatement(source: string) {
  const masked = maskSqlCommentsAndLiterals(source);
  let depth = 0;
  let quote: '"' | "`" | "[" | null = null;
  let terminator = -1;
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index]!;
    const next = masked[index + 1];
    if (quote === "[") {
      if (character === "]") {
        if (next === "]") index += 1;
        else quote = null;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === '"' || character === "`" || character === "[") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === ";" && depth === 0) {
      if (terminator >= 0 || masked.slice(index + 1).trim()) return null;
      terminator = index;
    }
  }

  const executable = source.slice(0, terminator >= 0 ? terminator : source.length);
  if (!executable.trim()) return null;
  const statement = currentTopLevelStatementBeforeCursor(executable);
  const prefix = executable.slice(0, executable.length - statement.source.length);
  return maskSqlCommentsAndLiterals(prefix).trim() ? null : statement;
}

function hasTopLevelSetOperation(masked: string) {
  const setOperations = new Set(["union", "intersect", "except", "minus"]);
  let depth = 0;
  let quote: '"' | "`" | "[" | null = null;
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index]!;
    const next = masked[index + 1];
    if (quote === "[") {
      if (character === "]") {
        if (next === "]") index += 1;
        else quote = null;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === '"' || character === "`" || character === "[") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || !/[A-Za-z_]/u.test(character)) continue;
    const token = masked.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
    if (!token) continue;
    if (setOperations.has(token.toLocaleLowerCase())) return true;
    index += token.length - 1;
  }
  return false;
}

/**
 * Resolve direct SELECT projections to physical relations by ordinal. This is
 * deliberately fail-closed: it never maps computed expressions, ambiguous
 * unqualified join columns, derived tables, CTEs, or mixed wildcard lists.
 */
export function cachedSqlProjectionSources(
  sql: string,
  resultColumns: readonly string[],
): Array<CachedSqlProjectionSource | undefined> {
  if (!sql.trim() || resultColumns.length === 0) return [];
  const statement = singleProjectionStatement(sql);
  if (!statement || hasTopLevelSetOperation(statement.masked)) {
    return resultColumns.map(() => undefined);
  }

  const selectList = topLevelSelectList(statement.source, statement.masked);
  if (!selectList) return resultColumns.map(() => undefined);
  const relations = cachedSqlRelationsBeforeCursor(statement.source);
  const physicalRelations = relations.filter(
    (relation) => !relation.isCte && !relation.isDerived,
  );
  if (physicalRelations.length === 0) {
    return resultColumns.map(() => undefined);
  }

  const expressions = splitTopLevelExpressions(selectList).map((expression, index) =>
    index === 0
      ? expression
          .replace(/^\s*(?:all|distinct)\b/iu, "")
          .replace(/^\s*top\s*(?:\(\s*\d+\s*\)|\d+)\s*(?:percent\s*)?(?:with\s+ties\s*)?/iu, "")
      : expression,
  );
  const wildcard = expressions.findIndex((expression) => {
    const value = projectionWithoutAlias(expression);
    return value === "*" || /\.\s*\*$/u.test(value);
  });
  if (wildcard >= 0) {
    if (
      expressions.length !== 1 ||
      physicalRelations.length !== 1 ||
      relations.length !== 1
    ) {
      return resultColumns.map(() => undefined);
    }
    const relation = physicalRelations[0]!;
    const wildcardSource = projectionWithoutAlias(expressions[0]!);
    if (wildcardSource !== "*") {
      const qualifierSql = wildcardSource.match(/^(.*?)\.\s*\*$/u)?.[1];
      if (
        !qualifierSql ||
        !COMPLETE_QUALIFIED_IDENTIFIER_MATCHER.test(qualifierSql)
      ) {
        return resultColumns.map(() => undefined);
      }
      const qualifier = splitQualifiedIdentifier(qualifierSql);
      if (
        !qualifier ||
        ("database" in qualifier && qualifier.database) ||
        qualifier.schema
      ) {
        return resultColumns.map(() => undefined);
      }
      const normalizedQualifier = qualifier.table.toLocaleLowerCase();
      const normalizedRelationQualifier = (
        relation.alias || relation.table
      ).toLocaleLowerCase();
      if (normalizedQualifier !== normalizedRelationQualifier) {
        return resultColumns.map(() => undefined);
      }
    }
    return resultColumns.map((sourceColumn) => ({
      database: relation.database,
      schema: relation.schema,
      tableName: relation.table,
      sourceColumn,
    }));
  }
  if (expressions.length !== resultColumns.length) {
    return resultColumns.map(() => undefined);
  }

  return expressions.map((expression) => {
    const source = projectionWithoutAlias(expression);
    if (!COMPLETE_QUALIFIED_IDENTIFIER_MATCHER.test(source)) return undefined;
    const identifier = splitQualifiedIdentifier(source);
    // Three/four-part column references require a full semantic binder. The
    // relation parser stores only the final three relation components, so a
    // renderer fallback must not reinterpret schema.table.column as
    // qualifier.column and inherit an unrelated formatter.
    if (!identifier || ("database" in identifier && identifier.database)) {
      return undefined;
    }
    const sourceColumn = identifier.table;
    const qualifier = identifier.schema;
    let relation: CachedSqlRelationReference | undefined;
    if (qualifier) {
      const normalized = qualifier.toLocaleLowerCase();
      const matches = physicalRelations.filter(
        (candidate) =>
          candidate.alias?.toLocaleLowerCase() === normalized ||
          (!candidate.alias && candidate.table.toLocaleLowerCase() === normalized),
      );
      if (matches.length === 1) relation = matches[0];
    } else if (physicalRelations.length === 1 && relations.length === 1) {
      relation = physicalRelations[0];
    }
    if (!relation) return undefined;
    return {
      database: relation.database,
      schema: relation.schema,
      tableName: relation.table,
      sourceColumn,
    };
  });
}
