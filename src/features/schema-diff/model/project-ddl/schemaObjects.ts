import {
  normalizeRelationName,
  parenthesizedContent,
} from "@/features/schema-diff/model/project-ddl/identifiers";
import {
  leadingWords,
  splitTopLevel,
} from "@/features/schema-diff/model/project-ddl/lexical";
import type { SchemaObjectSnapshot } from "@/services/tauri/types";

export function parseCreateSchemaObject(
  statement: string,
  fallbackSchema: string,
  warnings: Set<string>,
): SchemaObjectSnapshot | null {
  const sequence = statement.match(
    /^CREATE\s+(?:OR\s+REPLACE\s+)?SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;]+)/i,
  );
  if (sequence) {
    const name = normalizeRelationName(sequence[1] || "", fallbackSchema);
    if (!name) {
      warnings.add(
        `CREATE SEQUENCE has an unsupported identifier: ${leadingWords(statement)}.`,
      );
      return null;
    }
    return { name, objectType: "SEQUENCE" };
  }

  const type = statement.match(
    /^CREATE\s+(?:OR\s+REPLACE\s+)?TYPE\s+([^\s]+)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\b/is,
  );
  if (!type) return null;
  const name = normalizeRelationName(type[1] || "", fallbackSchema);
  if (!name) {
    warnings.add(
      `CREATE TYPE has an unsupported identifier: ${leadingWords(statement)}.`,
    );
    return null;
  }
  const typeKind = (type[2] || "TYPE").toUpperCase();
  const description =
    typeKind === "ENUM" ? enumTypeDescription(statement) : undefined;
  return {
    name,
    objectType: typeKind === "ENUM" ? "ENUM TYPE" : "TYPE",
    ...(description ? { description } : {}),
  };
}

export function enumTypeDescription(statement: string) {
  const enumOffset = statement.search(/\bENUM\b/i);
  if (enumOffset < 0) return undefined;
  const group = parenthesizedContent(statement.slice(enumOffset + 4));
  if (!group) return undefined;
  const values = splitTopLevel(group.content, ",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) return undefined;
  const description = `Values: ${values.join(", ")}`;
  return description.length <= 2_048
    ? description
    : `${description.slice(0, 2_045)}...`;
}
