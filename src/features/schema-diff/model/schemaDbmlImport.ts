import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  SchemaObjectSnapshot,
  SchemaRelationSnapshot,
  SchemaSnapshot,
} from "@/services/tauri/types";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import { enumDescriptorDescription } from "./schemaEnumDescriptor";

export type SchemaDbmlParseResult = {
  relations: SchemaRelationSnapshot[];
  schemaObjects: SchemaObjectSnapshot[];
  warnings: string[];
};

const OFFLINE_DBML_WARNING = "OFFLINE_DBML_REVIEW_ONLY";
const MAX_DBML_ENUM_VALUES = 4_096;
const MAX_DBML_ENUM_VALUE_LENGTH = 4_096;
const MAX_DBML_PARTIAL_DEPTH = 32;
const MAX_DBML_PARTIAL_INJECTIONS = 256;
const MAX_DBML_EXPANDED_TABLE_LENGTH = 2 * 1_024 * 1_024;
const MAX_DBML_PARTIAL_CACHE_LENGTH = 8 * 1_024 * 1_024;

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
    const schemaName = path.length > 1 ? path[path.length - 2] || "" : targetSchema;
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
      warnings.add(`Duplicate Enum ${enumName}; the later definition was ignored.`);
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
    const schemaName = path.length > 1 ? path[path.length - 2] || "" : targetSchema;
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
      warnings.add(`Duplicate Table ${tableName}; the later definition was ignored.`);
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
      left.name.localeCompare(right.name)
    ),
    warnings: [...warnings].sort(),
  };
}

export function createSchemaDbmlSnapshot(
  identity: SchemaSnapshotIdentity,
  sourceName: string,
  dbml: string,
  capturedAt = Date.now(),
): SchemaSnapshot {
  const parsed = parseSchemaDbml(dbml, identity.schemaName);
  const fingerprint = stableFingerprint(
    identity,
    sourceName,
    parsed.relations,
    parsed.schemaObjects,
  );
  return {
    version: 1,
    id: `dbml-${capturedAt}-${fingerprint.slice(-8)}`,
    fingerprint,
    projectId: identity.projectId,
    connectionId: identity.connectionId,
    connectionName: identity.connectionName,
    driver: identity.driver,
    databaseName: identity.databaseName || null,
    schemaName: identity.schemaName,
    capturedAt,
    relations: parsed.relations,
    schemaObjects: parsed.schemaObjects,
    warnings: [
      OFFLINE_DBML_WARNING,
      `Source: ${sourceName.trim() || "Imported DBML"}`,
      ...parsed.warnings,
    ],
  };
}

export function isSchemaDbmlSnapshot(snapshot: SchemaSnapshot) {
  return snapshot.warnings.includes(OFFLINE_DBML_WARNING);
}

type TablePartialDefinition = {
  name: string;
  body: string;
};

function parseTablePartials(
  blocks: ExtractedBlock[],
  targetSchema: string,
  warnings: Set<string>,
) {
  const partials = new Map<string, TablePartialDefinition>();
  for (const block of blocks) {
    const bareHeader = removeTrailingSettings(block.header);
    const path = parseIdentifierPath(bareHeader);
    const name = path[path.length - 1] || "";
    const schemaName = path.length > 1 ? path[path.length - 2] || "" : targetSchema;
    if (!name || path.length > 2) {
      warnings.add("A TablePartial block with an unsupported identifier was ignored.");
      continue;
    }
    if (schemaName && targetSchema && schemaName !== targetSchema) {
      warnings.add(
        `${schemaName}.${name}: skipped because a schema snapshot can only contain ${targetSchema}.`,
      );
      continue;
    }
    if (partials.has(name)) {
      warnings.add(`Duplicate TablePartial ${name}; the later definition was ignored.`);
      continue;
    }
    if (bareHeader !== block.header.trim()) {
      warnings.add(
        `${name}: TablePartial table settings are review-only and were omitted.`,
      );
    }
    partials.set(name, { name, body: block.body });
  }
  return partials;
}

function createTablePartialExpander(
  partials: Map<string, TablePartialDefinition>,
  warnings: Set<string>,
) {
  const cache = new Map<string, string>();
  let cachedLength = 0;

  const expandPartial = (name: string, stack: string[]): string => {
    const cached = cache.get(name);
    if (cached != null) return cached;
    const partial = partials.get(name);
    if (!partial) return "";
    if (cachedLength >= MAX_DBML_PARTIAL_CACHE_LENGTH) {
      warnings.add(
        `TablePartial expansion cache was limited to ${MAX_DBML_PARTIAL_CACHE_LENGTH} characters.`,
      );
      cache.set(name, "");
      return "";
    }
    if (stack.includes(name)) {
      warnings.add(`TablePartial cycle was ignored: ${[...stack, name].join(" -> ")}.`);
      return "";
    }
    if (stack.length >= MAX_DBML_PARTIAL_DEPTH) {
      warnings.add(`TablePartial ${name} exceeded the ${MAX_DBML_PARTIAL_DEPTH}-level expansion limit.`);
      return "";
    }
    const expanded = expandBody(partial.body, partial.name, [...stack, name]);
    if (cachedLength + expanded.length > MAX_DBML_PARTIAL_CACHE_LENGTH) {
      warnings.add(
        `TablePartial ${name} exceeded the remaining bounded expansion cache and was ignored.`,
      );
      cache.set(name, "");
      return "";
    }
    cachedLength += expanded.length;
    cache.set(name, expanded);
    return expanded;
  };

  const expandBody = (body: string, owner: string, stack: string[]) => {
    const localLines: string[] = [];
    const injectedBodies: string[] = [];
    let injectionCount = 0;
    let expandedLength = body.length;
    for (const line of body.split(/\r?\n/u)) {
      const injection = parsePartialInjection(line);
      if (!injection) {
        localLines.push(line);
        continue;
      }
      injectionCount += 1;
      if (injectionCount > MAX_DBML_PARTIAL_INJECTIONS) {
        warnings.add(
          `${owner}: TablePartial injections were limited to ${MAX_DBML_PARTIAL_INJECTIONS}.`,
        );
        continue;
      }
      if (!partials.has(injection)) {
        warnings.add(`${owner}: TablePartial ${injection} was not found.`);
        continue;
      }
      const expanded = expandPartial(injection, stack);
      if (expandedLength + expanded.length > MAX_DBML_EXPANDED_TABLE_LENGTH) {
        warnings.add(
          `${owner}: expanded TablePartial content exceeded ${MAX_DBML_EXPANDED_TABLE_LENGTH} characters and was truncated.`,
        );
        continue;
      }
      expandedLength += expanded.length;
      injectedBodies.push(expanded);
    }
    // DBML conflict priority is independent of injection position: local table
    // definitions override every partial, and the last injected partial wins.
    return [...injectedBodies, localLines.join("\n")].filter(Boolean).join("\n");
  };

  return (body: string, tableName: string) => expandBody(body, tableName, []);
}

function parsePartialInjection(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("~")) return "";
  const source = removeTrailingSettings(trimmed.slice(1).trim());
  const path = parseIdentifierPath(source);
  return path.length === 1 ? path[0] || "" : "";
}

function parseTableBlock(
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
    const existingColumn = columns.findIndex((candidate) => candidate.name === column.name);
    if (existingColumn >= 0) {
      warnings.add(`${tableName}.${column.name}: later definition overrides an earlier column.`);
      columns[existingColumn] = column;
      for (let index = inlineReferences.length - 1; index >= 0; index -= 1) {
        if (inlineReferences[index]?.originColumn === column.name) {
          inlineReferences.splice(index, 1);
        }
      }
    } else {
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
      const existingIndex = indexes.findIndex((candidate) => candidate.name === index.name);
      if (existingIndex >= 0) {
        warnings.add(`${tableName}.${index.name}: later definition overrides an earlier index.`);
        indexes[existingIndex] = index;
      } else {
        indexes.push(index);
      }
    }
  }

  for (const column of columns) {
    if (column.is_primary_key) {
      constraints.push({
        name: uniqueConstraintName(constraints, `${tableName}_pkey`),
        constraint_type: "PRIMARY KEY",
        columns: [column.name],
        referenced_columns: [],
      });
    } else if (column.is_unique) {
      constraints.push({
        name: uniqueConstraintName(constraints, `${tableName}_${column.name}_key`),
        constraint_type: "UNIQUE",
        columns: [column.name],
        referenced_columns: [],
      });
    }
  }
  for (const index of indexes) {
    if (index.is_primary || index.is_unique) {
      constraints.push({
        name: uniqueConstraintName(constraints, index.name),
        constraint_type: index.is_primary ? "PRIMARY KEY" : "UNIQUE",
        columns: index.columns,
        referenced_columns: [],
      });
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
    column.is_indexed ||= indexedColumns.has(column.name) || column.is_primary_key;
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

function parseStandaloneNote(value: string) {
  const separator = findTopLevel(value, ":");
  if (separator < 0) return null;
  const note = value.slice(separator + 1).trim();
  if (!note) return null;
  return unquote(note);
}

function parseEnumValues(
  body: string,
  enumName: string,
  warnings: Set<string>,
) {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const line of body.split(/\r?\n/u)) {
    const source = line.trim();
    if (!source || /^Note\s*:/iu.test(source)) continue;
    const valueSource = removeTrailingSettings(source);
    if (valueSource !== source) {
      warnings.add(`${enumName}: enum value settings and notes are review-only and were omitted.`);
    }
    const token = readEnumValue(valueSource);
    if (!token || token.end !== valueSource.length) {
      warnings.add(`${enumName}: unsupported enum value ${enumValuePreview(valueSource)} was ignored.`);
      continue;
    }
    if (token.value.length > MAX_DBML_ENUM_VALUE_LENGTH) {
      warnings.add(`${enumName}: an enum value exceeded ${MAX_DBML_ENUM_VALUE_LENGTH} characters and was ignored.`);
      continue;
    }
    if (seen.has(token.value)) {
      warnings.add(`${enumName}.${enumValuePreview(token.value)}: duplicate enum value was ignored.`);
      continue;
    }
    if (values.length >= MAX_DBML_ENUM_VALUES) {
      warnings.add(`${enumName}: enum values were limited to ${MAX_DBML_ENUM_VALUES} entries.`);
      break;
    }
    seen.add(token.value);
    values.push(token.value);
  }
  if (values.length === 0) {
    warnings.add(`Enum ${enumName} has no supported values and remains descriptor-only.`);
  }
  return values;
}

function enumValuePreview(value: string) {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= 120 ? compact : `${compact.slice(0, 117)}...`;
}

function readEnumValue(value: string) {
  const token = readIdentifier(value, 0);
  if (token) return token;
  if (!value.startsWith("'")) return null;
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === "'" && value[index - 1] !== "\\") {
      return { value: unquote(value.slice(0, index + 1)), end: index + 1 };
    }
  }
  return null;
}

function parseColumn(
  line: string,
  warnings: Set<string>,
  tableName: string,
): {
  column: ColumnInfo;
  reference?: string;
  referenceDelete?: string;
  referenceUpdate?: string;
} | null {
  const token = readIdentifier(line, 0);
  if (!token) {
    warnings.add(`${tableName}: an unsupported column definition was ignored.`);
    return null;
  }
  const rest = line.slice(token.end).trim();
  const settingsStart = findSettingsStart(rest);
  const dataType = (settingsStart >= 0 ? rest.slice(0, settingsStart) : rest).trim();
  if (!dataType) {
    warnings.add(`${tableName}.${token.value}: column type is required.`);
    return null;
  }
  const settings = settingsStart >= 0
    ? parseSettings(rest.slice(settingsStart), warnings)
    : new Map<string, string | true>();
  return {
    column: {
      name: token.value,
      data_type: dataType,
      is_nullable: !settings.has("not null") && !settings.has("pk"),
      is_primary_key: settings.has("pk"),
      is_unique: settings.has("unique") || settings.has("pk"),
      is_indexed: settings.has("pk") || settings.has("unique"),
      is_auto_increment: settings.has("increment"),
      default_value: settingText(settings.get("default")),
      comment: settingText(settings.get("note")),
    },
    reference: settingText(settings.get("ref")),
    referenceDelete: settingText(settings.get("delete")),
    referenceUpdate: settingText(settings.get("update")),
  };
}

function parseIndex(
  line: string,
  tableName: string,
  warnings: Set<string>,
): IndexInfo | null {
  if (!line || /^(?:Note)\s*:/iu.test(line)) return null;
  const opening = line.indexOf("(");
  const settingsStart = findSettingsStart(line);
  const closing = opening >= 0 ? matchingPair(line, opening, "(", ")") : -1;
  if (opening >= 0 && closing < 0) {
    warnings.add(`${tableName}: unbalanced DBML index definition was ignored.`);
    return null;
  }
  const columnSource = opening >= 0
    ? line.slice(opening + 1, closing)
    : (settingsStart >= 0 ? line.slice(0, settingsStart) : line);
  const columns = splitTopLevel(columnSource, ",")
    .map((value) => {
      const candidate = value.trim();
      if (candidate.includes("(") || candidate.includes(")")) {
        warnings.add(
          `${tableName}: expression index ${candidate} requires manual review and was ignored.`,
        );
        return "";
      }
      const path = parseIdentifierPath(candidate);
      return path[path.length - 1] || "";
    })
    .filter(Boolean);
  if (columns.length === 0) {
    warnings.add(`${tableName}: an index without columns was ignored.`);
    return null;
  }
  const settings = parseSettings(
    opening >= 0
      ? line.slice(closing + 1)
      : settingsStart >= 0
        ? line.slice(settingsStart)
        : "",
    warnings,
  );
  const explicitName = settingText(settings.get("name"));
  return {
    name: explicitName || `${tableName}_${columns.join("_")}_idx`,
    columns,
    is_unique: settings.has("unique") || settings.has("pk"),
    is_primary: settings.has("pk"),
    index_type: settingText(settings.get("type")),
    comment: settingText(settings.get("note")),
  };
}

type ParsedRef = {
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

function parseInlineReferenceSetting(
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

function attachReference(
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
  const existingReference = relation.constraints.find((constraint) =>
    constraint.constraint_type === "FOREIGN KEY"
      && constraint.columns.join("\u0000") === parsed.sourceColumns.join("\u0000")
      && constraint.referenced_schema === referencedSchema
      && constraint.referenced_table === parsed.targetTable
      && constraint.referenced_columns.join("\u0000") === parsed.targetColumns.join("\u0000")
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

function parseRef(
  line: string,
  fallbackSchema: string,
  warnings: Set<string>,
): ParsedRef | null {
  const match = line.match(/^\s*Ref(?:\s+(.+?))?\s*:\s*(.+?)\s*([><-])\s*(.+?)(\s+\[[^\]]*\])?\s*$/iu);
  if (!match) return null;
  const left = parseRefSide(match[2] || "", fallbackSchema);
  const right = parseRefSide(match[4] || "", fallbackSchema);
  if (!left || !right || left.columns.length !== right.columns.length) {
    warnings.add(`Unsupported or mismatched DBML Ref was ignored: ${line.trim()}`);
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

function referenceActionDefinition(
  deleteAction: string | undefined,
  updateAction: string | undefined,
) {
  const actions = [
    deleteAction ? `ON DELETE ${deleteAction}` : "",
    updateAction ? `ON UPDATE ${updateAction}` : "",
  ].filter(Boolean);
  return actions.length > 0 ? actions.join(" ") : undefined;
}

function parseRefSide(value: string, fallbackSchema: string) {
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

function parseSettings(value: string, warnings: Set<string>) {
  const settings = new Map<string, string | true>();
  const opening = value.indexOf("[");
  if (opening < 0) return settings;
  const closing = matchingPair(value, opening, "[", "]");
  if (closing < 0) {
    warnings.add("An unbalanced DBML settings list was ignored.");
    return settings;
  }
  for (const part of splitTopLevel(value.slice(opening + 1, closing), ",")) {
    const separator = findTopLevel(part, ":");
    const key = (separator >= 0 ? part.slice(0, separator) : part)
      .trim()
      .toLowerCase();
    if (!key) continue;
    settings.set(
      key,
      separator >= 0
        ? key === "default"
          ? parseDefaultSetting(part.slice(separator + 1).trim())
          : unquote(part.slice(separator + 1).trim())
        : true,
    );
  }
  return settings;
}

function parseDefaultSetting(value: string) {
  if (value.startsWith("`") && value.endsWith("`")) return unquote(value);
  if (
    (value.startsWith("'") && value.endsWith("'"))
    || (value.startsWith('"') && value.endsWith('"'))
  ) {
    return `'${unquote(value).replace(/'/gu, "''")}'`;
  }
  return value;
}

function settingText(value: string | true | undefined) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type ExtractedBlock = {
  header: string;
  body: string;
  start: number;
  end: number;
};

function extractBlocks(
  source: string,
  keyword: string,
  warnings: Set<string>,
): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  // Keep indentation separate from the keyword position. `\\s*` is not safe
  // here because it also consumes newlines and can make the calculated block
  // start point land in the preceding blank line.
  const pattern = new RegExp(`(^|\\n)([\\t ]*)${keyword}\\b`, "giu");
  for (const match of source.matchAll(pattern)) {
    const start =
      (match.index || 0) +
      (match[1]?.length || 0) +
      (match[2]?.length || 0);
    const opening = findTopLevel(source, "{", start + keyword.length);
    if (opening < 0) {
      warnings.add(`${keyword} block is missing an opening brace.`);
      continue;
    }
    const closing = matchingPair(source, opening, "{", "}");
    if (closing < 0) {
      warnings.add(`${keyword} block is missing a closing brace.`);
      continue;
    }
    blocks.push({
      header: source.slice(start + keyword.length, opening).trim(),
      body: source.slice(opening + 1, closing),
      start,
      end: closing + 1,
    });
  }
  return blocks.filter(
    (block, index) => !blocks.some((parent, parentIndex) =>
      parentIndex < index && block.start > parent.start && block.end < parent.end),
  );
}

function replaceRangesWithWhitespace(
  source: string,
  ranges: Array<[number, number]>,
) {
  if (ranges.length === 0) return source;
  // Block offsets are UTF-16 string indices. Keep code units here so an emoji
  // before an indexes block cannot shift the replacement range.
  const characters = source.split("");
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index += 1) {
      if (characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
      }
    }
  }
  return characters.join("");
}

function stripComments(source: string, warnings: Set<string>) {
  return source
    .replace(/^\s*\/\/\s*WARNING:\s*(.+)$/gimu, (_match, warning: string) => {
      warnings.add(`Source warning: ${warning.trim()}`);
      return "";
    })
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/\/\/[^\r\n]*/gu, "");
}

function removeTrailingSettings(value: string) {
  const start = findSettingsStart(value);
  return (start >= 0 ? value.slice(0, start) : value).trim();
}

function findSettingsStart(value: string) {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] || "";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "[" && (index === 0 || /\s/u.test(value[index - 1] || ""))) {
      return index;
    }
  }
  return -1;
}

function parseIdentifierPath(value: string) {
  const result: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    while (/\s/u.test(value[cursor] || "")) cursor += 1;
    const token = readIdentifier(value, cursor);
    if (!token) break;
    result.push(token.value);
    cursor = token.end;
    while (/\s/u.test(value[cursor] || "")) cursor += 1;
    if (value[cursor] !== ".") break;
    cursor += 1;
  }
  return result;
}

function readIdentifier(value: string, start: number) {
  let cursor = start;
  while (/\s/u.test(value[cursor] || "")) cursor += 1;
  const quote = value[cursor];
  if (quote === '"' || quote === "`") {
    let result = "";
    for (let index = cursor + 1; index < value.length; index += 1) {
      if (value[index] === quote) {
        if (value[index + 1] === quote) {
          result += quote;
          index += 1;
          continue;
        }
        return { value: result, end: index + 1 };
      }
      result += value[index];
    }
    return null;
  }
  const match = value.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_$-]*/u);
  return match
    ? { value: match[0], end: cursor + match[0].length }
    : null;
}

function unquote(value: string) {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("`") && value.endsWith("`"))
  ) {
    return value
      .slice(1, -1)
      .replace(/\\'/gu, "'")
      .replace(/\\`/gu, "`")
      .replace(/\\\\/gu, "\\");
  }
  return value;
}

function splitTopLevel(value: string, delimiter: string) {
  const parts: string[] = [];
  let start = 0;
  let roundDepth = 0;
  let squareDepth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] || "";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") roundDepth += 1;
    if (character === ")") roundDepth = Math.max(0, roundDepth - 1);
    if (character === "[") squareDepth += 1;
    if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
    if (
      character === delimiter &&
      roundDepth === 0 &&
      squareDepth === 0
    ) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function findTopLevel(value: string, needle: string, start = 0) {
  let quote = "";
  for (let index = start; index < value.length; index += 1) {
    const character = value[index] || "";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === needle) return index;
  }
  return -1;
}

function matchingPair(
  value: string,
  opening: number,
  open: string,
  close: string,
) {
  let depth = 0;
  let quote = "";
  for (let index = opening; index < value.length; index += 1) {
    const character = value[index] || "";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function uniqueConstraintName(constraints: ConstraintInfo[], preferred: string) {
  if (!constraints.some((constraint) => constraint.name === preferred)) return preferred;
  let suffix = 2;
  while (constraints.some((constraint) => constraint.name === `${preferred}_${suffix}`)) {
    suffix += 1;
  }
  return `${preferred}_${suffix}`;
}

function stableFingerprint(
  identity: SchemaSnapshotIdentity,
  sourceName: string,
  relations: SchemaRelationSnapshot[],
  schemaObjects: SchemaObjectSnapshot[],
) {
  const payload: unknown[] = [
    identity.driver,
    identity.databaseName || null,
    identity.schemaName,
    sourceName,
    relations,
  ];
  if (schemaObjects.length > 0) payload.push(schemaObjects);
  const input = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `offline-dbml-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
