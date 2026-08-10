import type {
  ConstraintInfo,
  SchemaSnapshot,
} from "@/services/tauri/types";
import { enumDescriptorValues } from "./schemaEnumDescriptor";

export type SchemaDbmlArtifact = {
  content: string;
  warnings: string[];
};

function identifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function qualifiedRelation(schema: string, relation: string) {
  return `${identifier(schema)}.${identifier(relation)}`;
}

function quotedText(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[\r\n]+/g, " ")}'`;
}

function expression(value: string) {
  return `\`${value.replace(/`/g, "\\`")}\``;
}

function enumValue(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function isEnumObject(object: NonNullable<SchemaSnapshot["schemaObjects"]>[number]) {
  return /\benum\b/iu.test(object.objectType);
}

function isForeignKey(constraint: ConstraintInfo) {
  return /foreign\s+key|^fk$/iu.test(constraint.constraint_type.trim());
}

function isUnsupportedConstraint(constraint: ConstraintInfo) {
  return !/^(?:primary\s+key|unique|foreign\s+key|pk|fk)$/iu.test(
    constraint.constraint_type.trim(),
  );
}

function columnSettings(column: SchemaSnapshot["relations"][number]["columns"][number]) {
  const settings: string[] = [];
  if (column.is_primary_key) settings.push("pk");
  if (!column.is_nullable) settings.push("not null");
  if (column.is_unique && !column.is_primary_key) settings.push("unique");
  if (column.is_auto_increment) settings.push("increment");
  if (column.default_value != null) {
    settings.push(`default: ${expression(column.default_value)}`);
  }
  if (column.comment) settings.push(`note: ${quotedText(column.comment)}`);
  return settings.length > 0 ? ` [${settings.join(", ")}]` : "";
}

function indexColumns(columns: string[]) {
  return columns
    .map((column) =>
      /^[A-Za-z_][A-Za-z0-9_$]*$/u.test(column)
        ? identifier(column)
        : expression(column),
    )
    .join(", ");
}

/**
 * Exports a captured snapshot as a review artifact. DBML is never treated as
 * executable migration SQL; importing it later must still flow through schema
 * diff, preflight and confirmation.
 */
export function serializeSchemaSnapshotToDbml(
  snapshot: SchemaSnapshot,
): SchemaDbmlArtifact {
  const warnings = new Set<string>();
  const lines = [
    `Project ${identifier(`${snapshot.connectionName}-${snapshot.schemaName}`)} {`,
    `  database_type: ${quotedText(snapshot.driver)}`,
    `  Note: ${quotedText("Generated from an OxideStudio read-only schema snapshot. Review through schema diff before applying changes.")}`,
    `}`,
    "",
  ];

  const schemaObjects = snapshot.schemaObjects || [];
  const enumObjects = schemaObjects.filter(isEnumObject);
  for (const enumObject of enumObjects) {
    const values = enumDescriptorValues(enumObject.description);
    if (!values) {
      warnings.add(
        `${enumObject.name}: enum values are unavailable; exported as an empty review-only Enum block.`,
      );
    }
    lines.push(
      `Enum ${qualifiedRelation(snapshot.schemaName, enumObject.name)} {`,
      ...(values || []).map((value) => `  ${enumValue(value)}`),
      "}",
      "",
    );
  }

  for (const relation of snapshot.relations) {
    lines.push(
      `Table ${qualifiedRelation(snapshot.schemaName, relation.name)} {`,
    );
    if (relation.comment) {
      lines.push(`  Note: ${quotedText(relation.comment)}`);
    }
    if (
      relation.objectType &&
      !/^(?:base\s+table|table)$/iu.test(relation.objectType)
    ) {
      warnings.add(
        `${relation.name}: ${relation.objectType} semantics are not representable as an editable DBML table.`,
      );
    }
    for (const column of relation.columns) {
      lines.push(
        `  ${identifier(column.name)} ${column.data_type}${columnSettings(column)}`,
      );
    }
    if (relation.indexes.length > 0) {
      lines.push("", "  indexes {");
      for (const index of relation.indexes) {
        const settings = [
          index.name ? `name: ${quotedText(index.name)}` : "",
          index.is_primary ? "pk" : "",
          index.is_unique && !index.is_primary ? "unique" : "",
          index.index_type ? `type: ${index.index_type}` : "",
          index.comment ? `note: ${quotedText(index.comment)}` : "",
        ].filter(Boolean);
        lines.push(
          `    (${indexColumns(index.columns)})${
            settings.length > 0 ? ` [${settings.join(", ")}]` : ""
          }`,
        );
      }
      lines.push("  }");
    }
    lines.push("}", "");

    for (const constraint of relation.constraints) {
      if (isUnsupportedConstraint(constraint)) {
        warnings.add(
          `${relation.name}.${constraint.name}: ${constraint.constraint_type} requires manual review because DBML has no lossless representation.`,
        );
      }
    }
  }

  for (const relation of snapshot.relations) {
    for (const constraint of relation.constraints.filter(isForeignKey)) {
      if (
        !constraint.referenced_table ||
        constraint.columns.length === 0 ||
        constraint.columns.length !== constraint.referenced_columns.length
      ) {
        warnings.add(
          `${relation.name}.${constraint.name}: incomplete foreign key was not exported.`,
        );
        continue;
      }
      const sourceColumns = constraint.columns
        .map(identifier)
        .join(", ");
      const targetColumns = constraint.referenced_columns
        .map(identifier)
        .join(", ");
      const source = qualifiedRelation(snapshot.schemaName, relation.name);
      const target = qualifiedRelation(
        constraint.referenced_schema || snapshot.schemaName,
        constraint.referenced_table,
      );
      lines.push(
        `Ref ${identifier(constraint.name)}: ${source}.(${sourceColumns}) > ${target}.(${targetColumns})`,
      );
    }
  }

  const routineCount = snapshot.routines?.length || 0;
  if (routineCount > 0) {
    warnings.add(
      `${routineCount} routine signature(s) are excluded from DBML.`,
    );
  }
  const schemaObjectCount = schemaObjects.length - enumObjects.length;
  if (schemaObjectCount > 0) {
    warnings.add(
      `${schemaObjectCount} non-enum schema object descriptor(s) are excluded from DBML.`,
    );
  }

  const warningList = [...warnings];
  const warningHeader = warningList.length
    ? [
        ...warningList.map((warning) => `// WARNING: ${warning}`),
        "",
      ]
    : [];
  return {
    content: `${[...warningHeader, ...lines].join("\n").trimEnd()}\n`,
    warnings: warningList,
  };
}
