import {
  attachConstraint,
  parseAlterTableConstraint,
} from "@/features/schema-diff/model/project-ddl/constraints";
import { detectProjectDdlDialect } from "@/features/schema-diff/model/project-ddl/dialect";
import { parseCreateIndex } from "@/features/schema-diff/model/project-ddl/indexes";
import {
  leadingWords,
  splitStatements,
  stripSqlComments,
} from "@/features/schema-diff/model/project-ddl/lexical";
import { parseCreateSchemaObject } from "@/features/schema-diff/model/project-ddl/schemaObjects";
import { parseCreateTable } from "@/features/schema-diff/model/project-ddl/tables";
import {
  type ProjectDdlDialect,
  type ProjectDdlParseResult,
} from "@/features/schema-diff/model/project-ddl/types";
import { parseCreateView } from "@/features/schema-diff/model/project-ddl/views";
import type {
  ConstraintInfo,
  IndexInfo,
  SchemaObjectSnapshot,
  SchemaRelationSnapshot,
} from "@/services/tauri/types";

/**
 * A deliberately bounded DDL reader for project baselines. It understands the
 * portable CREATE TABLE / CREATE INDEX subset, retains unsupported constructs
 * as explicit warnings, and never produces executable SQL. The resulting
 * snapshot is review-only until a dialect-owned parser can establish a fully
 * verified source fingerprint.
 */
export function parseProjectDdl(
  sql: string,
  fallbackSchema: string,
  preferredDialect: ProjectDdlDialect = "generic",
): ProjectDdlParseResult {
  const warnings = new Set<string>();
  const detectedDialect = detectProjectDdlDialect(sql);
  const dialect =
    detectedDialect.dialect === "generic"
      ? preferredDialect
      : detectedDialect.dialect;
  if (
    preferredDialect !== "generic" &&
    detectedDialect.confidence === "high" &&
    detectedDialect.dialect !== "generic" &&
    detectedDialect.dialect !== preferredDialect
  ) {
    warnings.add(
      `DDL markers indicate ${detectedDialect.dialect}, but the current connection uses ${preferredDialect}; parsed as detected source syntax for review.`,
    );
  }
  const relations = new Map<string, SchemaRelationSnapshot>();
  const schemaObjects = new Map<string, SchemaObjectSnapshot>();
  const pendingIndexes: Array<{ table: string; index: IndexInfo }> = [];
  const pendingConstraints: Array<{
    table: string;
    constraint: ConstraintInfo;
  }> = [];

  for (const statement of splitStatements(stripSqlComments(sql), dialect)) {
    const trimmed = statement.trim();
    if (!trimmed) continue;
    const view = parseCreateView(trimmed, fallbackSchema, warnings);
    if (view) {
      if (relations.has(view.name)) {
        warnings.add(
          `Duplicate CREATE relation for ${view.name}; the later definition was ignored.`,
        );
      } else {
        relations.set(view.name, view);
      }
      continue;
    }
    const table = parseCreateTable(trimmed, fallbackSchema, warnings);
    if (table) {
      if (relations.has(table.name)) {
        warnings.add(
          `Duplicate CREATE relation for ${table.name}; the later definition was ignored.`,
        );
      } else {
        relations.set(table.name, table);
      }
      continue;
    }
    const alteredConstraint = parseAlterTableConstraint(
      trimmed,
      fallbackSchema,
      warnings,
    );
    if (alteredConstraint) {
      pendingConstraints.push(alteredConstraint);
      continue;
    }
    const index = parseCreateIndex(trimmed, fallbackSchema);
    if (index) {
      pendingIndexes.push(index);
      continue;
    }
    const schemaObject = parseCreateSchemaObject(
      trimmed,
      fallbackSchema,
      warnings,
    );
    if (schemaObject) {
      const key = `${schemaObject.objectType.toUpperCase()}:${schemaObject.name}`;
      if (schemaObjects.has(key)) {
        warnings.add(
          `Duplicate CREATE ${schemaObject.objectType} for ${schemaObject.name}; the later definition was ignored.`,
        );
      } else {
        schemaObjects.set(key, schemaObject);
      }
      continue;
    }
    if (/^CREATE\b/i.test(trimmed)) {
      warnings.add(
        `Unsupported CREATE statement was ignored: ${leadingWords(trimmed)}.`,
      );
    }
  }

  for (const { table, constraint } of pendingConstraints) {
    const relation = relations.get(table);
    if (!relation) {
      warnings.add(
        `ALTER TABLE constraint refers to ${table}, which was not found in this DDL source.`,
      );
      continue;
    }
    attachConstraint(relation, constraint);
  }

  for (const { table, index } of pendingIndexes) {
    const relation = relations.get(table);
    if (!relation) {
      warnings.add(
        `Index ${index.name} refers to table ${table}, which was not found in this DDL source.`,
      );
      continue;
    }
    relation.indexes.push(index);
    for (const column of relation.columns) {
      if (index.columns.includes(column.name)) column.is_indexed = true;
    }
  }

  if (relations.size === 0) {
    warnings.add(
      "No supported CREATE TABLE or VIEW statement was found in this project SQL file.",
    );
  }
  return {
    dialect,
    relations: [...relations.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    schemaObjects: [...schemaObjects.values()].sort((left, right) =>
      `${left.objectType}\u0000${left.name}`.localeCompare(
        `${right.objectType}\u0000${right.name}`,
      ),
    ),
    warnings: [...warnings].sort(),
  };
}
