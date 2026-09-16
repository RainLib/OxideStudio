import {
  extractBlocks,
  stripComments,
} from "@/features/schema-diff/model/dbml-import/blocks";
import { parseEnumValues } from "@/features/schema-diff/model/dbml-import/enums";
import { parseIdentifierPath } from "@/features/schema-diff/model/dbml-import/lexical";
import {
  createTablePartialExpander,
  parseTablePartials,
} from "@/features/schema-diff/model/dbml-import/partials";
import {
  attachReference,
  type ParsedRef,
  parseRef,
} from "@/features/schema-diff/model/dbml-import/references";
import { removeTrailingSettings } from "@/features/schema-diff/model/dbml-import/settings";
import { parseTableBlock } from "@/features/schema-diff/model/dbml-import/tables";
import { type SchemaDbmlParseResult } from "@/features/schema-diff/model/dbml-import/types";
import { enumDescriptorDescription } from "@/features/schema-diff/model/schemaEnumDescriptor";
import type {
  SchemaObjectSnapshot,
  SchemaRelationSnapshot,
} from "@/services/tauri/types";

/**
 * Parses the portable DBML subset used by the OxideStudio exporter. The result
 * is deliberately review-only: it may be saved, diagrammed and compared, but
 * must never become executable migration input without a live/dialect preflight.
 */
export function parseSchemaDbml(
  dbml: string,
  targetSchema: string,
): SchemaDbmlParseResult {
  const warnings = new Set<string>();
  const source = stripComments(dbml, warnings);
  const relations = new Map<string, SchemaRelationSnapshot>();
  const schemaObjects = new Map<string, SchemaObjectSnapshot>();
  const pendingReferences: ParsedRef[] = [];
  const tableBlocks = extractBlocks(source, "Table", warnings);
  const enumBlocks = extractBlocks(source, "Enum", warnings);
  const partialBlocks = extractBlocks(source, "TablePartial", warnings);
  const partials = parseTablePartials(partialBlocks, targetSchema, warnings);
  const expandPartials = createTablePartialExpander(partials, warnings);

  for (const block of enumBlocks) {
    const path = parseIdentifierPath(removeTrailingSettings(block.header));
    const enumName = path[path.length - 1] || "";
    const schemaName =
      path.length > 1 ? path[path.length - 2] || "" : targetSchema;
    if (!enumName) {
      warnings.add("An Enum block with an unsupported identifier was ignored.");
      continue;
    }
    if (schemaName && targetSchema && schemaName !== targetSchema) {
      warnings.add(
        `${schemaName}.${enumName}: skipped because a schema snapshot can only contain ${targetSchema}.`,
      );
      continue;
    }
    const key = `ENUM TYPE:${enumName}`;
    if (schemaObjects.has(key)) {
      warnings.add(
        `Duplicate Enum ${enumName}; the later definition was ignored.`,
      );
      continue;
    }
    const values = parseEnumValues(block.body, enumName, warnings);
    schemaObjects.set(key, {
      name: enumName,
      objectType: "ENUM TYPE",
      description: enumDescriptorDescription(values),
    });
  }

  for (const block of tableBlocks) {
    const path = parseIdentifierPath(removeTrailingSettings(block.header));
    const tableName = path[path.length - 1] || "";
    const schemaName =
      path.length > 1 ? path[path.length - 2] || "" : targetSchema;
    if (!tableName) {
      warnings.add("A Table block with an unsupported identifier was ignored.");
      continue;
    }
    if (schemaName && targetSchema && schemaName !== targetSchema) {
      warnings.add(
        `${schemaName}.${tableName}: skipped because a schema snapshot can only contain ${targetSchema}.`,
      );
      continue;
    }
    if (relations.has(tableName)) {
      warnings.add(
        `Duplicate Table ${tableName}; the later definition was ignored.`,
      );
      continue;
    }
    const parsed = parseTableBlock(
      tableName,
      schemaName || targetSchema,
      expandPartials(block.body, tableName),
      warnings,
    );
    relations.set(tableName, parsed.relation);
    pendingReferences.push(...parsed.inlineReferences);
  }

  for (const line of source.split(/\r?\n/u)) {
    const parsed = parseRef(line, targetSchema, warnings);
    if (parsed) pendingReferences.push(parsed);
  }

  for (const reference of pendingReferences) {
    attachReference(reference, targetSchema, relations, warnings);
  }

  if (relations.size === 0) {
    warnings.add("No supported DBML Table block was found.");
  }
  return {
    relations: [...relations.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    schemaObjects: [...schemaObjects.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    warnings: [...warnings].sort(),
  };
}
