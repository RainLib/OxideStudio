import { uniqueConstraintName } from "@/features/schema-diff/model/dbml-import/constraintNames";
import {
  parseIdentifierPath,
  splitTopLevel,
} from "@/features/schema-diff/model/dbml-import/lexical";
import {
  parseSettings,
  settingText,
} from "@/features/schema-diff/model/dbml-import/settings";
import type { SchemaRelationSnapshot } from "@/services/tauri/types";

export type ParsedRef = {
  name: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumns: string[];
  targetSchema: string;
  targetTable: string;
  targetColumns: string[];
  originColumn?: string;
  definition?: string;
};

export function parseInlineReferenceSetting(
  schemaName: string,
  tableName: string,
  columnName: string,
  setting: string | undefined,
  deleteAction: string | undefined,
  updateAction: string | undefined,
  warnings: Set<string>,
): ParsedRef | null {
  if (!setting) return null;
  const match = setting.match(/^\s*([><-])\s*(.+?)\s*$/u);
  const target = match ? parseRefSide(match[2] || "", schemaName) : null;
  if (!match || !target) {
    warnings.add(
      `${tableName}.${columnName}: unsupported inline DBML ref was ignored: ${setting}`,
    );
    return null;
  }
  const current = {
    schema: schemaName,
    table: tableName,
    columns: [columnName],
  };
  const source = match[1] === "<" ? target : current;
  const referenced = match[1] === "<" ? current : target;
  return {
    name: `${source.table}_${source.columns.join("_")}_${referenced.table}_fk`,
    sourceSchema: source.schema,
    sourceTable: source.table,
    sourceColumns: source.columns,
    targetSchema: referenced.schema,
    targetTable: referenced.table,
    targetColumns: referenced.columns,
    originColumn: columnName,
    definition: referenceActionDefinition(deleteAction, updateAction),
  };
}

export function attachReference(
  parsed: ParsedRef,
  targetSchema: string,
  relations: Map<string, SchemaRelationSnapshot>,
  warnings: Set<string>,
) {
  if (parsed.sourceSchema && parsed.sourceSchema !== targetSchema) {
    warnings.add(
      `${parsed.name}: skipped because its source belongs to schema ${parsed.sourceSchema}.`,
    );
    return;
  }
  const relation = relations.get(parsed.sourceTable);
  if (!relation) {
    warnings.add(
      `${parsed.name}: source table ${parsed.sourceTable} was not found in the imported DBML.`,
    );
    return;
  }
  const sourceColumns = new Set(relation.columns.map((column) => column.name));
  const missingSourceColumns = parsed.sourceColumns.filter(
    (column) => !sourceColumns.has(column),
  );
  if (missingSourceColumns.length > 0) {
    warnings.add(
      `${parsed.name}: source column(s) ${missingSourceColumns.join(", ")} were not found on ${parsed.sourceTable}.`,
    );
    return;
  }
  const referencedSchema = parsed.targetSchema || targetSchema;
  if (!referencedSchema || referencedSchema === targetSchema) {
    const referenced = relations.get(parsed.targetTable);
    if (!referenced) {
      warnings.add(
        `${parsed.name}: referenced table ${parsed.targetTable} was not found in the imported DBML.`,
      );
      return;
    }
    const referencedColumns = new Set(
      referenced.columns.map((column) => column.name),
    );
    const missingReferencedColumns = parsed.targetColumns.filter(
      (column) => !referencedColumns.has(column),
    );
    if (missingReferencedColumns.length > 0) {
      warnings.add(
        `${parsed.name}: referenced column(s) ${missingReferencedColumns.join(", ")} were not found on ${parsed.targetTable}.`,
      );
      return;
    }
  }
  const existingReference = relation.constraints.find(
    (constraint) =>
      constraint.constraint_type === "FOREIGN KEY" &&
      constraint.columns.join("\u0000") ===
        parsed.sourceColumns.join("\u0000") &&
      constraint.referenced_schema === referencedSchema &&
      constraint.referenced_table === parsed.targetTable &&
      constraint.referenced_columns.join("\u0000") ===
        parsed.targetColumns.join("\u0000"),
  );
  if (existingReference) {
    warnings.add(
      existingReference.definition === parsed.definition
        ? `${parsed.name}: duplicate foreign key definition was ignored.`
        : `${parsed.name}: conflicting foreign key actions were ignored; the first definition was preserved.`,
    );
    return;
  }
  relation.constraints.push({
    name: uniqueConstraintName(relation.constraints, parsed.name),
    constraint_type: "FOREIGN KEY",
    columns: parsed.sourceColumns,
    referenced_schema: referencedSchema,
    referenced_table: parsed.targetTable,
    referenced_columns: parsed.targetColumns,
    definition: parsed.definition,
  });
}

export function parseRef(
  line: string,
  fallbackSchema: string,
  warnings: Set<string>,
): ParsedRef | null {
  const match = line.match(
    /^\s*Ref(?:\s+(.+?))?\s*:\s*(.+?)\s*([><-])\s*(.+?)(\s+\[[^\]]*\])?\s*$/iu,
  );
  if (!match) return null;
  const left = parseRefSide(match[2] || "", fallbackSchema);
  const right = parseRefSide(match[4] || "", fallbackSchema);
  if (!left || !right || left.columns.length !== right.columns.length) {
    warnings.add(
      `Unsupported or mismatched DBML Ref was ignored: ${line.trim()}`,
    );
    return null;
  }
  const source = match[3] === "<" ? right : left;
  const target = match[3] === "<" ? left : right;
  const namePath = parseIdentifierPath((match[1] || "").trim());
  const settings = parseSettings(match[5] || "", warnings);
  return {
    name:
      namePath[namePath.length - 1] ||
      `${source.table}_${source.columns.join("_")}_${target.table}_fk`,
    sourceSchema: source.schema,
    sourceTable: source.table,
    sourceColumns: source.columns,
    targetSchema: target.schema,
    targetTable: target.table,
    targetColumns: target.columns,
    definition: referenceActionDefinition(
      settingText(settings.get("delete")),
      settingText(settings.get("update")),
    ),
  };
}

export function referenceActionDefinition(
  deleteAction: string | undefined,
  updateAction: string | undefined,
) {
  const actions = [
    deleteAction ? `ON DELETE ${deleteAction}` : "",
    updateAction ? `ON UPDATE ${updateAction}` : "",
  ].filter(Boolean);
  return actions.length > 0 ? actions.join(" ") : undefined;
}

export function parseRefSide(value: string, fallbackSchema: string) {
  const composite = value.match(/^(.+?)\.\s*\((.*)\)$/u);
  if (composite) {
    const relation = parseIdentifierPath(composite[1] || "");
    const columns = splitTopLevel(composite[2] || "", ",")
      .map((column) => {
        const path = parseIdentifierPath(column);
        return path[path.length - 1] || "";
      })
      .filter(Boolean);
    const table = relation[relation.length - 1] || "";
    return table && columns.length > 0
      ? {
          schema:
            relation.length > 1
              ? relation[relation.length - 2] || ""
              : fallbackSchema,
          table,
          columns,
        }
      : null;
  }
  const path = parseIdentifierPath(value);
  if (path.length < 2) return null;
  return {
    schema: path.length > 2 ? path[path.length - 3] || "" : fallbackSchema,
    table: path[path.length - 2] || "",
    columns: [path[path.length - 1] || ""],
  };
}
