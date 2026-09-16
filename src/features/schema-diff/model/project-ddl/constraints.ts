import {
  columnList,
  normalizeIdentifier,
  normalizeReferencedRelation,
  normalizeRelationName,
} from "@/features/schema-diff/model/project-ddl/identifiers";
import { leadingWords } from "@/features/schema-diff/model/project-ddl/lexical";
import type {
  ConstraintInfo,
  SchemaRelationSnapshot,
} from "@/services/tauri/types";

export function parseAlterTableConstraint(
  statement: string,
  fallbackSchema: string,
  warnings: Set<string>,
) {
  const match = statement.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s]+)\s+ADD\s+(.+)$/is,
  );
  if (!match) return null;
  const table = normalizeRelationName(match[1] || "", fallbackSchema);
  if (!table) {
    warnings.add(
      `ALTER TABLE has an unsupported identifier: ${leadingWords(statement)}.`,
    );
    return null;
  }
  const constraint = parseConstraint(match[2] || "", table, warnings);
  if (!constraint) {
    warnings.add(
      `Unsupported ALTER TABLE clause was ignored: ${leadingWords(statement)}.`,
    );
    return null;
  }
  return { table, constraint };
}

export function attachConstraint(
  relation: SchemaRelationSnapshot,
  constraint: ConstraintInfo,
) {
  if (
    relation.constraints.some(
      (candidate) =>
        candidate.name === constraint.name ||
        (candidate.constraint_type === constraint.constraint_type &&
          candidate.columns.join("\u0000") ===
            constraint.columns.join("\u0000")),
    )
  ) {
    return;
  }
  relation.constraints.push(constraint);
  if (constraint.constraint_type === "PRIMARY KEY") {
    relation.indexes.push({
      name: constraint.name,
      columns: constraint.columns,
      is_unique: true,
      is_primary: true,
    });
  }
  for (const column of relation.columns) {
    if (
      constraint.constraint_type === "PRIMARY KEY" &&
      constraint.columns.includes(column.name)
    ) {
      column.is_primary_key = true;
      column.is_unique = true;
      column.is_indexed = true;
    }
    if (
      constraint.constraint_type === "UNIQUE" &&
      constraint.columns.includes(column.name)
    ) {
      column.is_unique = true;
      column.is_indexed = true;
    }
  }
}

export function parseConstraint(
  entry: string,
  table: string,
  warnings: Set<string>,
): ConstraintInfo | null {
  const value = entry.replace(/^CONSTRAINT\s+([^\s]+)\s+/i, "");
  const named = entry.match(/^CONSTRAINT\s+([^\s]+)\s+/i)?.[1];
  const name =
    normalizeIdentifier(named || "") ||
    `${table.replace(/\./g, "_")}_constraint`;
  const primary = value.match(/^PRIMARY\s+KEY\s*\(([^)]*)\)/i);
  if (primary)
    return {
      name,
      constraint_type: "PRIMARY KEY",
      columns: columnList(primary[1] || ""),
      referenced_columns: [],
    };
  const unique = value.match(/^UNIQUE\s*(?:KEY\s*)?\(([^)]*)\)/i);
  if (unique)
    return {
      name,
      constraint_type: "UNIQUE",
      columns: columnList(unique[1] || ""),
      referenced_columns: [],
    };
  const foreign = value.match(
    /^FOREIGN\s+KEY\s*\(([^)]*)\)\s+REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i,
  );
  if (foreign) {
    const reference = normalizeReferencedRelation(foreign[2] || "");
    const [referencedSchema, referencedTable] = reference?.includes(".")
      ? reference.split(/\.(?=[^.]+$)/)
      : [undefined, reference];
    return {
      name,
      constraint_type: "FOREIGN KEY",
      columns: columnList(foreign[1] || ""),
      referenced_schema: referencedSchema,
      referenced_table: referencedTable || undefined,
      referenced_columns: columnList(foreign[3] || ""),
    };
  }
  if (/^(CHECK|EXCLUDE)\b/i.test(value))
    warnings.add(
      `Unsupported constraint preserved as review warning on ${table}.`,
    );
  return null;
}

export function parseInlineReference(
  entry: string,
  table: string,
  column: string,
): ConstraintInfo | null {
  const foreign = entry.match(
    /(?:CONSTRAINT\s+([^\s]+)\s+)?REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i,
  );
  if (!foreign) return null;
  const reference = normalizeReferencedRelation(foreign[2] || "");
  if (!reference) return null;
  const [referencedSchema, referencedTable] = reference.includes(".")
    ? reference.split(/\.(?=[^.]+$)/)
    : [undefined, reference];
  const explicitName = normalizeIdentifier(foreign[1] || "");
  return {
    name: explicitName || `${table.replace(/\./g, "_")}_${column}_fkey`,
    constraint_type: "FOREIGN KEY",
    columns: [column],
    referenced_schema: referencedSchema,
    referenced_table: referencedTable || undefined,
    referenced_columns: columnList(foreign[3] || ""),
    definition: entry.trim(),
  };
}
