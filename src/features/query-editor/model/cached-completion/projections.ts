import type { CachedSqlProjectionSource, CachedSqlRelationReference } from "./types";
import {
  currentTopLevelStatementBeforeCursor,
  maskSqlCommentsAndLiterals,
  splitQualifiedIdentifier,
} from "./lexical";
import {
  cachedSqlRelationsBeforeCursor,
  splitTopLevelExpressions,
  topLevelSelectList,
} from "./relations";
import {
  COMPLETE_QUALIFIED_IDENTIFIER_MATCHER,
  TRAILING_AS_ALIAS_MATCHER,
  TRAILING_IMPLICIT_ALIAS_MATCHER,
} from "./syntax";

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
    (relation) => !relation.isCte && !relation.isDerived && !relation.server && !relation.schemaOmitted,
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
