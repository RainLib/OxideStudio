import {
  parseConstraint,
  parseInlineReference,
} from "@/features/schema-diff/model/project-ddl/constraints";
import {
  normalizeIdentifier,
  normalizeRelationName,
} from "@/features/schema-diff/model/project-ddl/identifiers";
import { parseCreateTableIndex } from "@/features/schema-diff/model/project-ddl/indexes";
import {
  leadingWords,
  matchingParen,
  splitTopLevel,
} from "@/features/schema-diff/model/project-ddl/lexical";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  SchemaRelationSnapshot,
} from "@/services/tauri/types";

export const CONSTRAINT_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "UNIQUE",
  "FOREIGN",
  "CHECK",
  "EXCLUDE",
  "KEY",
]);

export function parseCreateTable(
  statement: string,
  fallbackSchema: string,
  warnings: Set<string>,
): SchemaRelationSnapshot | null {
  const match = statement.match(
    /^CREATE\s+(?:TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i,
  );
  if (!match) return null;
  const rest = statement.slice(match[0].length).trimStart();
  const opening = rest.indexOf("(");
  if (opening < 0) {
    warnings.add(
      `CREATE TABLE without a column list was ignored: ${leadingWords(statement)}.`,
    );
    return null;
  }
  const close = matchingParen(rest, opening);
  if (close < 0) {
    warnings.add(
      `CREATE TABLE has unbalanced parentheses: ${leadingWords(statement)}.`,
    );
    return null;
  }
  const tableName = normalizeRelationName(
    rest.slice(0, opening),
    fallbackSchema,
  );
  if (!tableName) {
    warnings.add("CREATE TABLE has an unsupported identifier.");
    return null;
  }

  const columns: ColumnInfo[] = [];
  const indexes: IndexInfo[] = [];
  const constraints: ConstraintInfo[] = [];
  for (const item of splitTopLevel(rest.slice(opening + 1, close), ",")) {
    const entry = item.trim();
    if (!entry) continue;
    const tableIndex = parseCreateTableIndex(entry, tableName);
    if (tableIndex) {
      indexes.push(tableIndex);
      if (tableIndex.is_unique) {
        constraints.push({
          name: tableIndex.name,
          constraint_type: "UNIQUE",
          columns: tableIndex.columns,
          referenced_columns: [],
        });
      }
      continue;
    }
    const constraint = parseConstraint(entry, tableName, warnings);
    if (constraint) {
      constraints.push(constraint);
      if (constraint.constraint_type === "PRIMARY KEY") {
        indexes.push({
          name: constraint.name,
          columns: constraint.columns,
          is_unique: true,
          is_primary: true,
        });
      }
      continue;
    }
    const column = parseColumn(entry, tableName, warnings);
    if (!column) continue;
    columns.push(column);
    const inlineReference = parseInlineReference(entry, tableName, column.name);
    if (inlineReference) constraints.push(inlineReference);
    if (column.is_primary_key) {
      const name = `${tableName.replace(/\./g, "_")}_pkey`;
      constraints.push({
        name,
        constraint_type: "PRIMARY KEY",
        columns: [column.name],
        referenced_columns: [],
      });
      indexes.push({
        name,
        columns: [column.name],
        is_unique: true,
        is_primary: true,
      });
    } else if (column.is_unique) {
      constraints.push({
        name: `${tableName.replace(/\./g, "_")}_${column.name}_key`,
        constraint_type: "UNIQUE",
        columns: [column.name],
        referenced_columns: [],
      });
    }
  }
  const primaryColumns = new Set(
    constraints
      .filter((item) => item.constraint_type === "PRIMARY KEY")
      .flatMap((item) => item.columns),
  );
  const uniqueColumns = new Set(
    constraints
      .filter((item) => item.constraint_type === "UNIQUE")
      .flatMap((item) => item.columns),
  );
  const indexedColumns = new Set(indexes.flatMap((item) => item.columns));
  for (const column of columns) {
    column.is_primary_key ||= primaryColumns.has(column.name);
    column.is_unique ||= uniqueColumns.has(column.name);
    column.is_indexed ||=
      column.is_primary_key ||
      column.is_unique ||
      indexedColumns.has(column.name);
  }
  return {
    name: tableName,
    objectType: "BASE TABLE",
    columns,
    indexes,
    constraints,
  };
}

export function parseColumn(
  entry: string,
  table: string,
  warnings: Set<string>,
): ColumnInfo | null {
  const parts = entry.match(/^([^\s]+)\s+(.+)$/s);
  if (!parts) {
    warnings.add(`Unsupported table item was ignored: ${leadingWords(entry)}.`);
    return null;
  }
  const name = normalizeIdentifier(parts[1] || "");
  if (!name || CONSTRAINT_WORDS.has(name.toUpperCase())) return null;
  const definition = parts[2] || "";
  const type = definition
    .match(
      /^(.+?)(?=\s+(?:DEFAULT|NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED|IDENTITY|AUTO_INCREMENT|AUTOINCREMENT|CONSTRAINT)\b|$)/is,
    )?.[1]
    ?.trim();
  if (!type) {
    warnings.add(`Column ${name} has no supported type and was ignored.`);
    return null;
  }
  const defaultValue = definition
    .match(
      /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED|IDENTITY|AUTO_INCREMENT|AUTOINCREMENT|CONSTRAINT)\b|$)/i,
    )?.[1]
    ?.trim();
  if (
    /\bGENERATED\b/i.test(definition) &&
    !/\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i.test(definition)
  ) {
    warnings.add(
      `Generated expression on ${table}.${name} was recognized but omitted because snapshots cannot preserve executable expressions safely.`,
    );
  }
  return {
    name,
    data_type: type,
    is_nullable:
      !/\bNOT\s+NULL\b/i.test(definition) &&
      !/\bPRIMARY\s+KEY\b/i.test(definition),
    is_primary_key: /\bPRIMARY\s+KEY\b/i.test(definition),
    is_unique: /\bUNIQUE\b/i.test(definition),
    is_auto_increment:
      /\b(?:AUTO_INCREMENT|AUTOINCREMENT|SERIAL|IDENTITY)\b/i.test(definition),
    default_value: defaultValue,
  };
}
