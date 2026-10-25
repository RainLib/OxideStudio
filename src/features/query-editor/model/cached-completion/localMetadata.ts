import type { CachedSqlStatement } from "./lexical";
import { unquoteIdentifier } from "./lexical";
import { cachedSqlBindingForQualifier, cachedSqlFieldBindings, splitTopLevelExpressions } from "./relations";
import { SQL_IDENTIFIER, TRAILING_AS_ALIAS_MATCHER, TRAILING_IMPLICIT_ALIAS_MATCHER } from "./syntax";
import { topLevelSqlWords, matchingSqlParenthesis } from "./structure";
import type { CachedSearchColumn, CachedColumnSet } from "./metadataSearch";
import type { CachedSqlRelationReference } from "./types";
import { cachedColumnMatches } from "./columnIdentity";
import { uniqueCachedColumn } from "./uniqueColumn";
const reference = new RegExp(`^(${SQL_IDENTIFIER})(?:\\s*\\.\\s*(${SQL_IDENTIFIER}))?$`, "u");
const wildcard = new RegExp(`^(?:(${SQL_IDENTIFIER})\\s*\\.\\s*)?\\*$`, "u");
const MAX_DEPTH = 32,
  MAX_QUERIES = 64,
  MAX_OUTPUTS = 32768;
function projectedExpression(source: string, masked: string) {
  const explicit = masked.match(TRAILING_AS_ALIAS_MATCHER),
    implicit = masked.match(TRAILING_IMPLICIT_ALIAS_MATCHER);
  let alias = explicit;
  if (!alias && implicit?.index !== undefined) {
    const before = masked.slice(0, implicit.index).trim();
    if (reference.test(before) || before.endsWith(')') || /^\d+(?:\.\d+)?$/u.test(before)) alias = implicit;
  }
  const expressionMask = alias?.index !== undefined ? masked.slice(0, alias.index) : masked;
  let maskedExpression = expressionMask.trim(),
    start = expressionMask.indexOf(maskedExpression);
  while (maskedExpression.startsWith('(') && matchingSqlParenthesis(maskedExpression, 0) === maskedExpression.length - 1) {
    const inner = maskedExpression.slice(1, -1),
      trimmed = inner.trim();
    start += 1 + inner.indexOf(trimmed);
    maskedExpression = trimmed;
  }
  const ref = maskedExpression.match(reference),
    star = maskedExpression.match(wildcard);
  const rawAlias = alias?.[1] ? source.slice(alias.index! + alias[0].lastIndexOf(alias[1]), alias.index! + alias[0].length).trim() : undefined;
  const atom = (match: RegExpMatchArray, capture: number) => {
    const value = match[capture];
    if (!value) return undefined;
    const at = start + (capture === 1 ? match[0].indexOf(value) : match[0].lastIndexOf(value));
    return source.slice(at, at + value.length);
  };
  const rawRef = ref ? [ref[0], atom(ref, 1)!, atom(ref, 2)] : undefined;
  const rawStar = star ? [star[0], atom(star, 1)] : undefined;
  return {
    name: rawAlias ? unquoteIdentifier(rawAlias) : rawRef ? unquoteIdentifier(rawRef[2] ?? rawRef[1]!) : undefined,
    ref: rawRef,
    star: rawStar
  };
}

/** Per-request direct-projection provenance. No computed-type guesses and no
 * catalog-wide name lookup. Every physical read starts from a scoped binding. */
export function createCachedLocalMetadataResolver(statement: CachedSqlStatement, load: (relation: CachedSqlRelationReference) => Promise<CachedColumnSet>, options: {
  driver: string;
  token: {
    isCancellationRequested?: boolean;
  };
  onIncomplete: () => void;
}) {
  const work = new Map<string, Promise<CachedColumnSet>>();
  const views = new Map<string, ReturnType<typeof cachedSqlFieldBindings>>();
  const fallback = (relation: CachedSqlRelationReference): CachedColumnSet => ({
    complete: false,
    columns: (relation.cteColumns ?? []).map(name => ({
      name,
      dataType: "column"
    }))
  });
  const rename = (columns: CachedSearchColumn[], names?: string[]) => names ? columns.map((column, index) => ({
    ...column,
    name: names[index] ?? column.name
  })) : columns;
  const unknown = (relation: CachedSqlRelationReference, names?: string[]): CachedColumnSet => names?.length ? {
    complete: false,
    columns: names.map(name => ({
      name,
      dataType: "column"
    }))
  } : fallback(relation);
  const resolveSet = async (relation: CachedSqlRelationReference, depth = 0, path = new Set<string>()): Promise<CachedColumnSet> => {
    if (options.token.isCancellationRequested) return {
      columns: [],
      complete: false
    };
    const local = relation.localSource;
    if (!local) return relation.isCte || relation.isDerived ? fallback(relation) : load(relation);
    if (local.kind === "physical") {
      const snapshot = await load({
        table: local.table,
        schema: local.schema,
        database: local.database,
        server: local.server,
        schemaOmitted: local.schemaOmitted
      });
      return !snapshot.complete && !snapshot.columns.length ? unknown(relation, local.columns) : {
        columns: rename(snapshot.columns, local.columns),
        complete: snapshot.complete
      };
    }
    const key = `${local.start}:${local.end}:${JSON.stringify(local.columns ?? null)}`;
    if (path.has(key)) return unknown(relation, local.columns);
    if (depth >= MAX_DEPTH) {
      options.onIncomplete();
      return unknown(relation, local.columns);
    }
    if (work.has(key)) return work.get(key)!;
    if (work.size >= MAX_QUERIES) {
      options.onIncomplete();
      return unknown(relation, local.columns);
    }
    const next = new Set(path);
    next.add(key);
    const task = (async () => {
      const words = [...topLevelSqlWords(statement.masked, local.start, local.end)];
      const select = words.find(word => word.word === "SELECT");
      if (!select) return unknown(relation, local.columns);
      const end = words.find(word => word.start > select.start && ["FROM", "UNION", "INTERSECT", "EXCEPT", "MINUS"].includes(word.word))?.start ?? local.end;
      const bodyMask = statement.masked.slice(select.end, end).replace(/^\s*(?:all|distinct)\b/iu, match => " ".repeat(match.length)).replace(/^\s*top\s*(?:\(\s*\d+\s*\)|\d+)\s*(?:percent\s*)?(?:with\s+ties\s*)?/iu, match => " ".repeat(match.length));
      const maskedParts = splitTopLevelExpressions(bodyMask);
      let offset = select.end;
      const parts = maskedParts.map(masked => {
        const source = statement.source.slice(offset, offset + masked.length);
        offset += masked.length + 1;
        return projectedExpression(source, masked);
      });
      if (parts.length > MAX_OUTPUTS) {
        options.onIncomplete();
        return unknown(relation, local.columns);
      }
      const setOperation = words.some(word => ["UNION", "INTERSECT", "EXCEPT", "MINUS"].includes(word.word));
      const viewKey = String(select.start);
      let view = views.get(viewKey);
      if (!view) {
        view = cachedSqlFieldBindings({
          ...statement,
          cursorOffset: select.end
        });
        views.set(viewKey, view);
      }
      if (!view.inputsComplete) return unknown(relation, local.columns);
      const resolved = new Map<CachedSqlRelationReference, Promise<CachedColumnSet>>();
      const inputs = (ref: CachedSqlRelationReference) => {
        let value = resolved.get(ref);
        if (!value) {
          value = resolveSet(ref, depth + 1, next);
          resolved.set(ref, value);
        }
        return value;
      };
      const outputs: CachedSearchColumn[] = [];
      let complete = true;
      for (const part of parts) {
        if (options.token.isCancellationRequested) return {
          columns: [],
          complete: false
        };
        if (part.star && !setOperation) {
          const qualifier = part.star[1] ? unquoteIdentifier(part.star[1]) : undefined;
          const input = cachedSqlBindingForQualifier(view, qualifier);
          if (input) {
            const snapshot = await inputs(input);
            if (!snapshot.complete) return unknown(relation, local.columns);
            outputs.push(...snapshot.columns);
          } else return unknown(relation, local.columns);
        } else {
          let column: CachedSearchColumn | undefined;
          if (part.ref && !setOperation) {
            const qualifier = part.ref[2] ? unquoteIdentifier(part.ref[1]!) : undefined;
            const input = cachedSqlBindingForQualifier(view, qualifier);
            if (input) {
              const snapshot = await inputs(input);
              const matches = snapshot.complete ? snapshot.columns.filter(column => cachedColumnMatches(column.name, part.ref![2] ?? part.ref![1]!, options.driver)) : [];
              if (matches.length === 1) column = matches[0];
            } else if (!qualifier) column = await uniqueCachedColumn(view, part.ref[1]!, options.driver, inputs, options.token, options.onIncomplete);
          }
          outputs.push(column ? {
            ...column,
            name: part.name ?? column.name
          } : {
            name: part.name ?? "",
            dataType: "column"
          });
        }
        if (outputs.length > MAX_OUTPUTS) {
          options.onIncomplete();
          return unknown(relation, local.columns);
        }
        if (options.token.isCancellationRequested) return {
          columns: [],
          complete: false
        };
      }
      // Preserve ordinal renames, including unnamed computed expressions.
      const named = rename(outputs, local.columns);
      if (named.some(column => !column.name)) complete = false;
      const renamed = named.filter(column => column.name);
      const counts = new Map<string, number>();
      for (const column of renamed) counts.set(column.name, (counts.get(column.name) ?? 0) + 1);
      if ([...counts.values()].some(count => count > 1)) complete = false;
      return {
        columns: renamed.filter(column => counts.get(column.name) === 1),
        complete
      };
    })();
    work.set(key, task);
    return task;
  };
  return {
    resolve: async (relation: CachedSqlRelationReference) => (await resolveSet(relation)).columns,
    resolveSet
  };
}
