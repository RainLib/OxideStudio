import { quoteIdentifier } from "@/lib/databaseDialect";
import {
  completionFilterTextForQuery,
  completionMatchScore,
  completionMatches,
} from "./completionMatch";
import type {
  CachedSqlJoinTargetContext,
  CachedSqlRelationReference,
} from "@/lib/queryEditorCachedCompletion";
import type {
  ConstraintInfo,
  DatabaseDriver,
} from "@/services/tauri/types";
import type { LspForeignKeyRelationship } from "@/services/lsp/relationshipIndex";

export type SqlForeignKeyJoinCompletion = {
  label: string;
  detail: string;
  documentation: string;
  filterText: string;
  insertText: string;
  sortText: string;
};

export type SqlForeignKeyJoinCompletionOptions = {
  driver: DatabaseDriver;
  defaultSchema?: string;
  keywordCase?: "upper" | "lower";
};

function isForeignKey(constraint: ConstraintInfo) {
  return /foreign\s+key|^fk$/iu.test(constraint.constraint_type.trim());
}

function normalized(value: string | undefined) {
  return value?.trim().toLocaleLowerCase() || "";
}

function sqlKeyword(value: string, keywordCase: "upper" | "lower") {
  return keywordCase === "lower" ? value.toLocaleLowerCase() : value;
}

function aliasSeed(table: string) {
  const words = table
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean);
  const seed =
    words.length > 1
      ? words.map((word) => word[0]).join("")
      : words[0]?.slice(0, 1);
  return /^[A-Za-z_]$/u.test(seed || "") ? seed!.toLocaleLowerCase() : "t";
}

function targetAlias(
  table: string,
  visibleRelations: readonly CachedSqlRelationReference[],
) {
  const occupied = new Set(
    visibleRelations
      .map((relation) => relation.alias)
      .filter((alias): alias is string => Boolean(alias))
      .map((alias) => alias.toLocaleLowerCase()),
  );
  const seed = aliasSeed(table);
  if (!occupied.has(seed)) return seed;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${seed}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return `${seed}_joined`;
}

function qualifiedTarget(
  driver: DatabaseDriver,
  targetSchema: string | undefined,
  targetTable: string,
  sourceSchema: string | undefined,
  defaultSchema: string | undefined,
  targetFragment: string,
) {
  // Monaco replaces only the final word after `schema.`. Repeating the schema
  // in the insertion would produce `schema.schema.table`.
  if (targetFragment.includes(".")) return quoteIdentifier(driver, targetTable);
  const currentSchema = sourceSchema || defaultSchema;
  if (targetSchema && normalized(targetSchema) !== normalized(currentSchema)) {
    return `${quoteIdentifier(driver, targetSchema)}.${quoteIdentifier(
      driver,
      targetTable,
    )}`;
  }
  return quoteIdentifier(driver, targetTable);
}

function sourceQualifier(driver: DatabaseDriver, relation: CachedSqlRelationReference) {
  return quoteIdentifier(driver, relation.alias || relation.table);
}

/** Converts both outgoing and incoming catalog relationships into the same
 * source-to-target constraint shape consumed by the JOIN renderer. */
export function sqlJoinConstraintsFromRelationshipIndex(
  sourceRelation: CachedSqlRelationReference,
  sourceSchema: string,
  relationships: readonly LspForeignKeyRelationship[],
): ConstraintInfo[] {
  const sourceTable = normalized(sourceRelation.table);
  const schema = normalized(sourceSchema);
  return relationships.flatMap((relationship): ConstraintInfo[] => {
    if (
      normalized(relationship.ownerSchema) === schema &&
      normalized(relationship.ownerTable) === sourceTable
    ) {
      return [
        {
          name: relationship.name,
          constraint_type: "FOREIGN KEY",
          columns: relationship.ownerColumns,
          referenced_schema: relationship.referencedSchema,
          referenced_table: relationship.referencedTable,
          referenced_columns: relationship.referencedColumns,
        },
      ];
    }
    if (
      normalized(relationship.referencedSchema) === schema &&
      normalized(relationship.referencedTable) === sourceTable
    ) {
      return [
        {
          name: `${relationship.name} (referenced by)`,
          constraint_type: "FOREIGN KEY",
          columns: relationship.referencedColumns,
          referenced_schema: relationship.ownerSchema,
          referenced_table: relationship.ownerTable,
          referenced_columns: relationship.ownerColumns,
        },
      ];
    }
    return [];
  });
}

/**
 * Builds deterministic JOIN snippets from one already-visible relation's
 * outgoing foreign keys. The caller deliberately supplies metadata for only
 * that relation, so completion never fans out into an N-table schema scan.
 */
export function sqlForeignKeyJoinCompletions(
  context: CachedSqlJoinTargetContext,
  sourceRelation: CachedSqlRelationReference,
  constraints: readonly ConstraintInfo[],
  options: SqlForeignKeyJoinCompletionOptions,
): SqlForeignKeyJoinCompletion[] {
  const keywordCase = options.keywordCase || "upper";
  const source = sourceQualifier(options.driver, sourceRelation);
  const completions: SqlForeignKeyJoinCompletion[] = [];
  const seen = new Set<string>();
  const targetCounts = new Map<string, number>();
  const targetQuery =
    context.targetFragment
      .split(".")
      .pop()
      ?.trim()
      .replace(/^["`\[]|["`\]]$/gu, "") || "";

  for (const constraint of constraints) {
    const targetTable = constraint.referenced_table?.trim();
    const sourceColumns = constraint.columns.filter(Boolean);
    const targetColumns = constraint.referenced_columns.filter(Boolean);
    if (
      !isForeignKey(constraint) ||
      !targetTable ||
      sourceColumns.length === 0 ||
      sourceColumns.length !== targetColumns.length
    ) {
      continue;
    }
    if (!completionMatches(targetTable, targetQuery)) continue;

    const targetSchema = constraint.referenced_schema?.trim() || undefined;
    const key = [
      normalized(targetSchema),
      normalized(targetTable),
      sourceColumns.map(normalized).join(","),
      targetColumns.map(normalized).join(","),
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);

    const target = qualifiedTarget(
      options.driver,
      targetSchema,
      targetTable,
      sourceRelation.schema,
      options.defaultSchema,
      context.targetFragment,
    );
    const alias = targetAlias(targetTable, context.sourceRelations);
    const quotedAlias = quoteIdentifier(options.driver, alias);
    const predicates = sourceColumns.map((sourceColumn, index) =>
      `${quotedAlias}.${quoteIdentifier(options.driver, targetColumns[index]!)} = ${
        source
      }.${quoteIdentifier(options.driver, sourceColumn)}`,
    );
    const on = sqlKeyword("ON", keywordCase);
    const and = ` ${sqlKeyword("AND", keywordCase)} `;
    const targetKey = `${normalized(targetSchema)}.${normalized(targetTable)}`;
    const occurrence = targetCounts.get(targetKey) || 0;
    targetCounts.set(targetKey, occurrence + 1);
    const currentSchema = sourceRelation.schema || options.defaultSchema;
    const displayTarget =
      targetSchema && normalized(targetSchema) !== normalized(currentSchema)
        ? `${targetSchema}.${targetTable}`
        : targetTable;
    const constraintLabel = constraint.name?.trim() || "foreign key";

    completions.push({
      label:
        occurrence === 0
          ? displayTarget
          : `${displayTarget} · ${constraintLabel}`,
      detail: `Foreign-key JOIN from ${sourceRelation.alias || sourceRelation.table}`,
      documentation: `${constraintLabel}: ${sourceRelation.table}(${sourceColumns.join(
        ", ",
      )}) → ${displayTarget}(${targetColumns.join(", ")})`,
      filterText:
        completionFilterTextForQuery(targetTable, targetQuery, targetTable) ||
        targetTable,
      insertText: `${target} ${quotedAlias} ${on} ${predicates.join(and)}`,
      sortText: `-1:${String(9_999 - Math.max(0, completionMatchScore(targetTable, targetQuery))).padStart(4, "0")}:${displayTarget.toLocaleLowerCase()}:${occurrence}`,
    });
  }

  return completions;
}
