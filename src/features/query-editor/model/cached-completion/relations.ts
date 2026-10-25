import type { CachedSqlJoinTargetContext, CachedSqlRelationReference } from "./types";
import { cachedQueryScopes } from "./queryScopes";
import { cachedIdentifierQualifier } from "./identifierFragments";
import { cachedLocalDeclarations, localColumnList } from "./localDeclarations";
import { matchingSqlParenthesis as matchingParenthesis, quotedSqlIdentifierEnd as quotedIdentifierEnd, isSqlComparisonFrom } from "./structure";
import {
  currentTopLevelStatementBeforeCursor,
  NON_ALIAS_KEYWORDS,
  RELATION_KEYWORDS,
  splitQualifiedIdentifier,
  unquoteIdentifier,
  type CachedSqlStatement,
} from "./lexical";
import {
  COMPLETE_QUALIFIED_IDENTIFIER_MATCHER,
  JOIN_TARGET_CONTEXT_MATCHER,
  RELATION_MATCHER,
  COMMA_RELATION_MATCHER,
  RELATION_TARGET_CONTEXT_MATCHER,
  SQL_IDENTIFIER,
  SUBQUERY_RELATION_MATCHER,
  TABLE_FUNCTION_RELATION_MATCHER,
  TRAILING_AS_ALIAS_MATCHER,
  TRAILING_IMPLICIT_ALIAS_MATCHER,
  splitDelimitedIdentifiers,
} from "./syntax";

function relationAlias(sql: string | undefined) {
  if (!sql) return undefined;
  const value = unquoteIdentifier(sql);
  return /^["`[]/u.test(sql) || !NON_ALIAS_KEYWORDS.has(value.toLowerCase()) ? value : undefined;
}

export function topLevelSelectList(source: string, masked: string) {
  const select = masked.match(/^\s*select\b/iu);
  if (!select) return null;
  const start = select[0].length;
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index];
    if (['"', '`', '['].includes(character!)) { index = quotedIdentifierEnd(masked, index); continue; }
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      /^from\b/iu.test(masked.slice(index)) &&
      !isSqlComparisonFrom(masked,index) &&
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

function derivedSubqueryRelations(source: string, masked: string, add:(relation:CachedSqlRelationReference,offset:number)=>void) {
  for (const match of masked.matchAll(SUBQUERY_RELATION_MATCHER)) {
    const openOffset = (match.index || 0) + match[0].lastIndexOf("(");
    const closeOffset = matchingParenthesis(masked, openOffset);
    if (closeOffset < 0) continue;
    const aliasMatch = source
      .slice(closeOffset + 1)
      .match(new RegExp(`^\\s*(?:as\\s+)?(${SQL_IDENTIFIER})`, "iu"));
    const alias = relationAlias(aliasMatch?.[1]);
    if (!alias) continue;
    const list = localColumnList(source, masked, closeOffset + 1 + aliasMatch![0].length);
    const selectList = topLevelSelectList(
      source.slice(openOffset + 1, closeOffset),
      masked.slice(openOffset + 1, closeOffset),
    );
    const columns = selectList
      ? splitTopLevelExpressions(selectList)
          .map(derivedColumnName)
          .filter((column): column is string => Boolean(column))
      : [];
    add({
      table: alias,
      alias,
      aliasSql: aliasMatch?.[1],
      isDerived: true,
      cteColumns: list?.columns ?? [...new Set(columns)],
      localSource: {kind:"query",start:openOffset+1,end:closeOffset,...(list?{columns:list.columns}:{})},
    },match.index);
  }
}

function tableFunctionRelations(source: string, masked: string, add:(relation:CachedSqlRelationReference,offset:number)=>void) {
  for (const match of masked.matchAll(TABLE_FUNCTION_RELATION_MATCHER)) {
    const openOffset = (match.index || 0) + match[0].lastIndexOf("(");
    const closeOffset = matchingParenthesis(masked, openOffset);
    if (closeOffset < 0) continue;
    const aliasMatch = source
      .slice(closeOffset + 1)
      .match(
        new RegExp(
          `^\\s*(?:as\\s+)?(${SQL_IDENTIFIER})`,
          "iu",
        ),
      );
    const alias = relationAlias(aliasMatch?.[1]);
    const name = alias || splitQualifiedIdentifier(match[1]!)?.table;
    if (!name) continue;
    const list = alias ? localColumnList(source, masked, closeOffset + 1 + aliasMatch![0].length) : undefined;
    add({
      table: name,
      alias,
      aliasSql: alias ? aliasMatch?.[1] : undefined,
      isDerived: true,
      cteColumns: list?.columns ?? [],
    },match.index);
  }
}

export function cachedSqlRelationsBeforeCursor(
  textBeforeCursor: string,
): CachedSqlRelationReference[] {
  return scopedRelationsBeforeCursor(textBeforeCursor).relations.map(withoutLocalSource);
}

function withoutLocalSource(relation:CachedSqlRelationReference) {
  const result={...relation};delete result.localSource;return result;
}

function scopedRelationsBeforeCursor(textBeforeCursor:string, bound=false, prepared?: CachedSqlStatement) {
  const statement = prepared ?? currentTopLevelStatementBeforeCursor(textBeforeCursor);
  const scopes=cachedQueryScopes(statement.masked, prepared?.cursorOffset);
  const namedCtes = cachedLocalDeclarations(statement.source,statement.masked,offset=>scopes.isCteDeclaration(offset)&&(!bound||scopes.declarationAt(offset)!==undefined));
  const recursiveOwners = new Set<number>();
  for (const match of statement.masked.matchAll(/\bwith\s+recursive\b/giu)) {
    const owner = scopes.declarationAt(match.index);
    if (owner !== undefined) recursiveOwners.add(owner);
  }
  const ctes = prepared && bound ? cachedLocalDeclarations(statement.source,statement.masked, offset => {
    const owner = scopes.declarationAt(offset);
    return scopes.isCteDeclaration(offset) && owner !== undefined && (offset <= prepared.cursorOffset || recursiveOwners.has(owner));
  }) : namedCtes;
  const relations: CachedSqlRelationReference[] = [];
  const owners=new Map<CachedSqlRelationReference,number>();
  const offsets = new Map<CachedSqlRelationReference, number>();
  const add=(relation:CachedSqlRelationReference,offset:number)=>{if(!scopes.isInputPosition(offset)&&!/^(?:update|into)\b/iu.test(statement.masked.slice(offset,offset+8)))return;const owner=scopes.relationAt(offset);if(bound&&owner===undefined)return;relations.push(relation);owners.set(relation,owner??0);offsets.set(relation,offset);};
  const physical = (name: string, aliasSql: string | undefined, offset: number) => {
    const relation = splitQualifiedIdentifier(name);
    if (!relation) return;
    const alias = relationAlias(aliasSql);
    const cteName = relation.table.toLocaleLowerCase();
    // An unavailable forward CTE must not become a physical metadata lookup.
    const declaration = !relation.schema && !relation.server && !relation.schemaOmitted && !("database" in relation && relation.database) ? ctes.get(cteName) ?? (namedCtes.has(cteName) ? {columns:[]} : undefined) : undefined;
    add({
      ...relation,
      ...(declaration
        ? { isCte: true, cteColumns:declaration.columns,...("localSource" in declaration && declaration.localSource?{localSource:declaration.localSource}:{}) }
        : {}),
      alias,
      aliasSql: alias ? aliasSql : undefined,
    },offset);
  };
  const callOrColumnList = (match: RegExpExecArray, comma = false) => {
    const aliasSql = match[comma ? 2 : 3], alias = relationAlias(aliasSql);
    if (aliasSql && !alias) return false;
    let end = match.index + match[0].length;
    while (end < statement.masked.length && /\s/u.test(statement.masked[end]!)) end++;
    if (statement.masked[end] !== '(') return false;
    if (alias) {
      const close = matchingParenthesis(statement.masked, end);
      const columns = close < 0 ? [] : splitDelimitedIdentifiers(statement.source.slice(end + 1, close));
      const physical = splitQualifiedIdentifier(match[comma?1:2]!);
      const declaration = physical && !physical.schema && !physical.server && !physical.schemaOmitted && !("database" in physical && physical.database) ? ctes.get(physical.table.toLowerCase()) ?? (namedCtes.has(physical.table.toLowerCase()) ? {columns:[]} : undefined) : undefined;
      const original = declaration && "localSource" in declaration ? declaration.localSource : undefined;
      const renamed = declaration?.columns.length ? declaration.columns.map((name,index)=>columns[index]??name) : columns;
      const localSource = original?.kind === "query" ? {...original,columns:renamed} : !declaration && physical ? {kind:"physical" as const,...physical,columns} : undefined;
      add({table:alias,alias,aliasSql,isDerived:true,cteColumns:columns,...(localSource?{localSource}:{})}, match.index);
    }
    return true;
  };
  for (const match of statement.masked.matchAll(RELATION_MATCHER)) {
    if (RELATION_KEYWORDS.has(match[1]!.toLowerCase()) && !callOrColumnList(match)) physical(match[2]!, match[3], match.index);
  }
  for (const match of statement.masked.matchAll(COMMA_RELATION_MATCHER)) {
    if (scopes.isFromComma(match.index) && !callOrColumnList(match, true)) physical(match[1]!, match[2], match.index);
  }
  derivedSubqueryRelations(statement.source, statement.masked,add);
  tableFunctionRelations(statement.source, statement.masked,add);
  relations.sort((left, right) => offsets.get(left)! - offsets.get(right)!);
  const covered = new Set(offsets.values());
  return {relations,owners,ctes,activeOwner:scopes.activeOwner,inputsComplete:scopes.visibleInputPositions().every(offset=>covered.has(offset))};
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
  const sourceRelations = scopedRelationsBeforeCursor(sourceBeforeTarget,true).relations;
  if (sourceRelations.length === 0) return null;

  return { sourceRelations, targetFragment };
}

/**
 * Returns the relation-name fragment currently being typed. Unlike a trailing
 * keyword check, this remains true after `FROM cus` and supports Unicode and
 * qualified SQL Server names, which is required for pinyin-backed matching.
 */
export function cachedSqlRelationTargetPrefix(textBeforeCursor: string, prepared?: Pick<CachedSqlStatement, "source" | "masked">) {
  const fragment = cachedSqlRelationTargetFragment(textBeforeCursor,prepared);
  if(fragment===null)return null;
  if(!fragment)return "";
  const lastPart=splitQualifiedIdentifier(fragment)?.table??"";
  return lastPart.replace(/^["`\[]/u, "").replace(/["`\]]$/u, "");
}

export function cachedSqlRelationTargetFragment(textBeforeCursor:string,prepared?:Pick<CachedSqlStatement,"source"|"masked">) {
  const statement = prepared ?? currentTopLevelStatementBeforeCursor(textBeforeCursor);
  const match = statement.masked.match(RELATION_TARGET_CONTEXT_MATCHER);
  if (!match) return null;
  const fragment = statement.source
    .slice(statement.masked.length - (match[1]?.length || 0))
    .trim();
  return fragment;
}

/**
 * Resolves the only safe metadata target for a field completion fallback.
 * With an explicit `alias.` qualifier we can select that relation; without a
 * qualifier we require exactly one visible relation to avoid leaking fields
 * from arbitrary tables into an ambiguous join.
 */
export function cachedSqlRelationForFieldCompletion(
  textBeforeCursor: string,
  prepared?: CachedSqlStatement,
): CachedSqlRelationReference | null {
  const statement = prepared ? { source: prepared.source.slice(0, prepared.cursorOffset), masked: prepared.masked.slice(0, prepared.cursorOffset) } : currentTopLevelStatementBeforeCursor(textBeforeCursor);
  const qualifierText = cachedIdentifierQualifier(statement.source,statement.masked);
  const qualifier = qualifierText
    ? unquoteIdentifier(qualifierText)
    : undefined;
  const bindings = scopedRelationsBeforeCursor(statement.source,true,prepared);
  if (prepared && !bindings.inputsComplete) return null;
  const result = cachedSqlBindingForQualifier(bindings, qualifier, !prepared || bindings.relations.length === 0);
  return result && !prepared ? withoutLocalSource(result) : result;
}

export function cachedSqlFieldBindings(statement: CachedSqlStatement) {
  return scopedRelationsBeforeCursor(statement.source, true, statement);
}

export function cachedSqlBindingForQualifier(
  {ctes,relations,owners}: ReturnType<typeof cachedSqlFieldBindings>,
  qualifier?: string,
  allowUnreferencedCte = false,
): CachedSqlRelationReference | null {
  const nearest=(matches:CachedSqlRelationReference[])=>{
    const depth=Math.max(...matches.map(relation=>owners.get(relation)??0));
    const closest=matches.filter(relation=>(owners.get(relation)??0)===depth);
    return closest.length===1?closest[0]!:null;
  };
  if (qualifier) {
    const normalized = qualifier.toLowerCase();
    const reversed = relations.slice().reverse();
    // SQL aliases shadow relation names in the active query block. Resolve
    // them in a separate pass so `orders users JOIN users u ... users.` binds
    // to the alias even though a later physical table has the same name.
    const aliased = reversed.filter(
      (relation) => relation.alias?.toLowerCase() === normalized,
    );
    if (aliased.length) return nearest(aliased);

    // Keep the existing authoring fallback for a declared CTE before the
    // outer FROM clause is written. An explicitly aliased CTE is no longer
    // addressable by its declaration name, just like a physical relation.
    const declaration = ctes.get(normalized);
    const cteWasAliased = reversed.some(
      (relation) =>
        relation.isCte &&
        relation.alias &&
        relation.table.toLowerCase() === normalized,
    );
    const cteIsReferenced = reversed.some(relation => relation.isCte && !relation.alias && relation.table.toLowerCase() === normalized);
    if (declaration && !cteWasAliased && (allowUnreferencedCte || cteIsReferenced)) {
      return {
        table: qualifier,
        schema: undefined,
        isCte: true,
        cteColumns: declaration.columns,
        localSource: declaration.localSource,
        alias: undefined,
      };
    }

    // Once a relation has an alias, SQL no longer permits its base name as a
    // qualifier. Returning it here would fabricate columns for invalid SQL
    // and, in collision cases, query the wrong metadata target.
    return (
      nearest(reversed.filter(
        (relation) =>
          !relation.alias && relation.table.toLowerCase() === normalized,
      ))
    );
  }
  return relations.length === 1 ? relations[0]! : null;
}
