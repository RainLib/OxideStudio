import type { CachedSqlJoinTargetContext, CachedSqlRelationReference } from "./types";
import {
  currentTopLevelStatementBeforeCursor,
  NON_ALIAS_KEYWORDS,
  RELATION_KEYWORDS,
  splitQualifiedIdentifier,
  unquoteIdentifier,
} from "./lexical";
import {
  COMPLETE_QUALIFIED_IDENTIFIER_MATCHER,
  CTE_DECLARATION_MATCHER,
  JOIN_TARGET_CONTEXT_MATCHER,
  RELATION_MATCHER,
  RELATION_TARGET_CONTEXT_MATCHER,
  SQL_IDENTIFIER,
  SUBQUERY_RELATION_MATCHER,
  TABLE_FUNCTION_RELATION_MATCHER,
  TRAILING_AS_ALIAS_MATCHER,
  TRAILING_IMPLICIT_ALIAS_MATCHER,
  TRAILING_QUALIFIER,
  splitDelimitedIdentifiers,
} from "./syntax";

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

export function topLevelSelectList(source: string, masked: string) {
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

export function splitTopLevelExpressions(source: string) {
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
