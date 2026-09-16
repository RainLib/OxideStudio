import {
  extractBlocks,
  replaceRangesWithWhitespace,
} from "@/features/schema-diff/model/dbml-import/blocks";
import { uniqueName } from "@/features/schema-diff/model/dbml-import/constraintNames";
import {
  parseColumn,
  parseIndex,
} from "@/features/schema-diff/model/dbml-import/fields";
import {
  findTopLevel,
  unquote,
} from "@/features/schema-diff/model/dbml-import/lexical";
import {
  type ParsedRef,
  parseInlineReferenceSetting,
} from "@/features/schema-diff/model/dbml-import/references";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  SchemaRelationSnapshot,
} from "@/services/tauri/types";

export function parseTableBlock(
  tableName: string,
  schemaName: string,
  body: string,
  warnings: Set<string>,
): {
  relation: SchemaRelationSnapshot;
  inlineReferences: ParsedRef[];
} {
  const columns: ColumnInfo[] = [];
  const constraints: ConstraintInfo[] = [];
  const indexes: IndexInfo[] = [];
  const columnPositions = new Map<string, number>();
  const indexPositions = new Map<string, number>();
  const constraintNames = new Set<string>();
  const inlineReferences: ParsedRef[] = [];
  let comment: string | undefined;
  const indexBlocks = extractBlocks(body, "indexes", warnings);
  const bodyWithoutIndexes = replaceRangesWithWhitespace(
    body,
    indexBlocks.map((block) => [block.start, block.end]),
  );

  for (const line of bodyWithoutIndexes.split(/\r?\n/u)) {
    const value = line.trim();
    if (!value || /^HeaderColor\s*:/iu.test(value)) continue;
    if (/^Note\s*:/iu.test(value)) {
      const parsedComment = parseStandaloneNote(value);
      if (parsedComment == null) {
        warnings.add(`${tableName}: unsupported table Note was ignored.`);
      } else if (comment == null) {
        comment = parsedComment;
      } else {
        warnings.add(`${tableName}: duplicate table Note was ignored.`);
      }
      continue;
    }
    const parsedColumn = parseColumn(value, warnings, tableName);
    if (!parsedColumn) continue;
    const { column } = parsedColumn;
    const existingColumn = columnPositions.get(column.name);
    if (existingColumn != null) {
      warnings.add(
        `${tableName}.${column.name}: later definition overrides an earlier column.`,
      );
      columns[existingColumn] = column;
      for (let index = inlineReferences.length - 1; index >= 0; index -= 1) {
        if (inlineReferences[index]?.originColumn === column.name) {
          inlineReferences.splice(index, 1);
        }
      }
    } else {
      columnPositions.set(column.name, columns.length);
      columns.push(column);
    }
    const inlineReference = parseInlineReferenceSetting(
      schemaName,
      tableName,
      column.name,
      parsedColumn.reference,
      parsedColumn.referenceDelete,
      parsedColumn.referenceUpdate,
      warnings,
    );
    if (inlineReference) inlineReferences.push(inlineReference);
  }

  for (const block of indexBlocks) {
    for (const line of block.body.split(/\r?\n/u)) {
      const index = parseIndex(line.trim(), tableName, warnings);
      if (!index) continue;
      const existingIndex = indexPositions.get(index.name);
      if (existingIndex != null) {
        warnings.add(
          `${tableName}.${index.name}: later definition overrides an earlier index.`,
        );
        indexes[existingIndex] = index;
      } else {
        indexPositions.set(index.name, indexes.length);
        indexes.push(index);
      }
    }
  }

  for (const column of columns) {
    if (column.is_primary_key) {
      const name = uniqueName(constraintNames, `${tableName}_pkey`);
      constraints.push({
        name,
        constraint_type: "PRIMARY KEY",
        columns: [column.name],
        referenced_columns: [],
      });
      constraintNames.add(name);
    } else if (column.is_unique) {
      const name = uniqueName(
        constraintNames,
        `${tableName}_${column.name}_key`,
      );
      constraints.push({
        name,
        constraint_type: "UNIQUE",
        columns: [column.name],
        referenced_columns: [],
      });
      constraintNames.add(name);
    }
  }
  for (const index of indexes) {
    if (index.is_primary || index.is_unique) {
      const name = uniqueName(constraintNames, index.name);
      constraints.push({
        name,
        constraint_type: index.is_primary ? "PRIMARY KEY" : "UNIQUE",
        columns: index.columns,
        referenced_columns: [],
      });
      constraintNames.add(name);
    }
  }

  const primaryColumns = new Set(
    constraints
      .filter((constraint) => constraint.constraint_type === "PRIMARY KEY")
      .flatMap((constraint) => constraint.columns),
  );
  const uniqueColumns = new Set(
    constraints
      .filter((constraint) => constraint.constraint_type === "UNIQUE")
      .flatMap((constraint) => constraint.columns),
  );
  const indexedColumns = new Set(indexes.flatMap((index) => index.columns));
  for (const column of columns) {
    column.is_primary_key ||= primaryColumns.has(column.name);
    column.is_unique ||= uniqueColumns.has(column.name);
    column.is_indexed ||=
      indexedColumns.has(column.name) || column.is_primary_key;
  }

  return {
    relation: {
      name: tableName,
      objectType: "BASE TABLE",
      comment,
      columns,
      indexes,
      constraints,
    },
    inlineReferences,
  };
}

export function parseStandaloneNote(value: string) {
  const separator = findTopLevel(value, ":");
  if (separator < 0) return null;
  const note = value.slice(separator + 1).trim();
  if (!note) return null;
  return unquote(note);
}
