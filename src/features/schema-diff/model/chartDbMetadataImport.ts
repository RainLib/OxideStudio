import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  SchemaRelationSnapshot,
  SchemaSnapshot,
} from "@/services/tauri/types";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";

export type ChartDbMetadataParseResult = {
  relations: SchemaRelationSnapshot[];
  warnings: string[];
  databaseName?: string;
  version?: string;
};

const OFFLINE_METADATA_WARNING = "OFFLINE_METADATA_JSON_REVIEW_ONLY";

/** Converts ChartDB's documented metadata-query JSON into an Oxide snapshot. */
export function parseChartDbMetadataJson(
  content: string,
  targetSchema: string,
): ChartDbMetadataParseResult {
  const warnings = new Set<string>();
  const root = unwrapMetadataJson(parseMetadataInput(content));
  const metadata = record(root, "Metadata JSON root");
  const tables = records(metadata.tables, "tables");
  const views = records(metadata.views, "views");
  const columns = records(metadata.columns, "columns");
  const primaryKeys = records(metadata.pk_info, "pk_info");
  const foreignKeys = records(metadata.fk_info, "fk_info");
  const rawIndexes = records(metadata.indexes, "indexes");
  const checks = records(metadata.check_constraints ?? [], "check_constraints");
  const relations = new Map<string, SchemaRelationSnapshot>();

  const includeSchema = (value: unknown) => {
    const schema = text(value);
    return !schema || !targetSchema || schema === targetSchema;
  };
  for (const table of tables) {
    if (!includeSchema(table.schema)) continue;
    const name = requiredText(table.table, "tables[].table");
    relations.set(name, {
      name,
      objectType: text(table.type) || "BASE TABLE",
      columns: [],
      indexes: [],
      constraints: [],
    });
  }
  for (const view of views) {
    if (!includeSchema(view.schema)) continue;
    const name = requiredText(view.view_name ?? view.table, "views[].view_name");
    if (!relations.has(name)) {
      relations.set(name, {
        name,
        objectType: "VIEW",
        columns: [],
        indexes: [],
        constraints: [],
      });
    }
  }

  for (const rawColumn of columns
    .filter((column) => includeSchema(column.schema))
    .sort((left, right) => number(left.ordinal_position) - number(right.ordinal_position))) {
    const tableName = requiredText(rawColumn.table, "columns[].table");
    const relation = ensureRelation(relations, tableName, warnings);
    const column = chartDbColumn(rawColumn);
    if (relation.columns.some((candidate) => candidate.name === column.name)) {
      warnings.add(`${tableName}.${column.name}: duplicate metadata column was ignored.`);
      continue;
    }
    relation.columns.push(column);
  }

  const indexGroups = groupBy(rawIndexes.filter((item) => includeSchema(item.schema)), (item) =>
    [text(item.table), text(item.name)].join("\u0000"),
  );
  for (const group of indexGroups.values()) {
    const first = group[0]!;
    const tableName = requiredText(first.table, "indexes[].table");
    const relation = ensureRelation(relations, tableName, warnings);
    const columnsInOrder = group
      .sort((left, right) => number(left.column_position) - number(right.column_position))
      .map((item) => text(item.column))
      .filter(Boolean);
    if (columnsInOrder.length === 0) continue;
    const index: IndexInfo = {
      name: requiredText(first.name, "indexes[].name"),
      columns: columnsInOrder,
      is_unique: truthy(first.unique),
      is_primary: false,
      index_type: text(first.index_type) || undefined,
    };
    relation.indexes.push(index);
  }

  const primaryKeyGroups = groupBy(
    primaryKeys.filter((item) => includeSchema(item.schema)),
    (item) => text(item.table),
  );
  for (const group of primaryKeyGroups.values()) {
    const rawPrimary = group[0]!;
    const tableName = requiredText(rawPrimary.table, "pk_info[].table");
    const relation = ensureRelation(relations, tableName, warnings);
    const columns = [...new Set(group.flatMap((item) => commaList(item.column)))];
    if (columns.length === 0) continue;
    const name = `${tableName}_pkey`;
    addConstraint(relation, {
      name,
      constraint_type: "PRIMARY KEY",
      columns,
      referenced_columns: [],
      definition: text(rawPrimary.pk_def) || undefined,
    });
    if (!relation.indexes.some((index) => index.name === name)) {
      relation.indexes.push({ name, columns, is_unique: true, is_primary: true });
    }
  }

  const foreignKeyGroups = groupBy(
    foreignKeys.filter((item) => includeSchema(item.schema)),
    (item) => [text(item.table), text(item.foreign_key_name)].join("\u0000"),
  );
  for (const group of foreignKeyGroups.values()) {
    const first = group[0]!;
    const tableName = requiredText(first.table, "fk_info[].table");
    const relation = ensureRelation(relations, tableName, warnings);
    const sourceColumns = group.flatMap((item) => commaList(item.column));
    const targetColumns = group.flatMap((item) => commaList(item.reference_column));
    if (sourceColumns.length === 0 || sourceColumns.length !== targetColumns.length) {
      warnings.add(`${text(first.foreign_key_name) || tableName}: incomplete foreign key was ignored.`);
      continue;
    }
    addConstraint(relation, {
      name: requiredText(first.foreign_key_name, "fk_info[].foreign_key_name"),
      constraint_type: "FOREIGN KEY",
      columns: sourceColumns,
      referenced_schema: text(first.reference_schema) || targetSchema,
      referenced_table: requiredText(first.reference_table, "fk_info[].reference_table"),
      referenced_columns: targetColumns,
      definition: text(first.fk_def) || undefined,
    });
  }

  for (const rawCheck of checks.filter((item) => includeSchema(item.schema))) {
    const tableName = requiredText(rawCheck.table, "check_constraints[].table");
    const relation = ensureRelation(relations, tableName, warnings);
    addConstraint(relation, {
      name: text(rawCheck.constraint_name ?? rawCheck.name) || `${tableName}_check`,
      constraint_type: "CHECK",
      columns: commaList(rawCheck.column),
      referenced_columns: [],
      definition: text(rawCheck.check_clause ?? rawCheck.definition) || undefined,
    });
    warnings.add(`${tableName}: imported CHECK metadata remains review-only.`);
  }

  for (const relation of relations.values()) {
    const primary = new Set(
      relation.constraints
        .filter((constraint) => constraint.constraint_type === "PRIMARY KEY")
        .flatMap((constraint) => constraint.columns),
    );
    const unique = new Set(
      relation.indexes
        .filter((index) => index.is_unique)
        .flatMap((index) => index.columns),
    );
    const indexed = new Set(relation.indexes.flatMap((index) => index.columns));
    for (const column of relation.columns) {
      column.is_primary_key = primary.has(column.name);
      column.is_unique = primary.has(column.name) || unique.has(column.name);
      column.is_indexed = primary.has(column.name) || indexed.has(column.name);
    }
  }
  if (Array.isArray(metadata.custom_types) && metadata.custom_types.length > 0) {
    warnings.add(`${metadata.custom_types.length} custom type descriptor(s) require manual review.`);
  }
  if (relations.size === 0) warnings.add("No target-schema relation metadata was found.");

  return {
    relations: [...relations.values()].sort((left, right) => left.name.localeCompare(right.name)),
    warnings: [...warnings].sort(),
    databaseName: text(metadata.database_name) || undefined,
    version: text(metadata.version) || undefined,
  };
}

export function createChartDbMetadataSnapshot(
  identity: SchemaSnapshotIdentity,
  sourceName: string,
  content: string,
  capturedAt = Date.now(),
): SchemaSnapshot {
  const parsed = parseChartDbMetadataJson(content, identity.schemaName);
  const fingerprint = stableFingerprint(identity, sourceName, parsed.relations);
  return {
    version: 1,
    id: `metadata-json-${capturedAt}-${fingerprint.slice(-8)}`,
    fingerprint,
    projectId: identity.projectId,
    connectionId: identity.connectionId,
    connectionName: identity.connectionName,
    driver: identity.driver,
    databaseName: identity.databaseName || parsed.databaseName || null,
    schemaName: identity.schemaName,
    capturedAt,
    relations: parsed.relations,
    warnings: [
      OFFLINE_METADATA_WARNING,
      `Source: ${sourceName.trim() || "Imported metadata JSON"}`,
      ...(parsed.version ? [`Source database version: ${parsed.version}`] : []),
      ...parsed.warnings,
    ],
  };
}

export function isChartDbMetadataSnapshot(snapshot: SchemaSnapshot) {
  return snapshot.warnings.includes(OFFLINE_METADATA_WARNING);
}

function chartDbColumn(raw: Record<string, unknown>): ColumnInfo {
  const baseType = requiredText(raw.type, "columns[].type");
  const precision = raw.precision && typeof raw.precision === "object"
    ? raw.precision as Record<string, unknown>
    : null;
  const precisionValue = precision ? finiteNumber(precision.precision) : null;
  const scaleValue = precision ? finiteNumber(precision.scale) : null;
  const length = text(raw.character_maximum_length);
  const dataType = truthy(raw.is_array)
    ? `${baseType}[]`
    : precisionValue != null
      ? `${baseType}(${precisionValue}${scaleValue != null ? `,${scaleValue}` : ""})`
      : length && /^\d+$/u.test(length)
        ? `${baseType}(${length})`
        : baseType;
  return {
    name: requiredText(raw.name, "columns[].name"),
    data_type: dataType,
    is_nullable: truthy(raw.nullable),
    is_primary_key: false,
    is_auto_increment: truthy(raw.is_identity),
    default_value: text(raw.default) || undefined,
    comment: text(raw.comment) || undefined,
  };
}

function ensureRelation(
  relations: Map<string, SchemaRelationSnapshot>,
  name: string,
  warnings: Set<string>,
) {
  let relation = relations.get(name);
  if (!relation) {
    relation = { name, objectType: "BASE TABLE", columns: [], indexes: [], constraints: [] };
    relations.set(name, relation);
    warnings.add(`${name}: inferred from metadata rows because tables[] omitted it.`);
  }
  return relation;
}

function addConstraint(relation: SchemaRelationSnapshot, constraint: ConstraintInfo) {
  if (!relation.constraints.some((candidate) => candidate.name === constraint.name)) {
    relation.constraints.push(constraint);
  }
}

function unwrapMetadataJson(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) return unwrapMetadataJson(value[0]);
  if (value && typeof value === "object" && "metadata_json_to_import" in value) {
    const wrapped = (value as Record<string, unknown>).metadata_json_to_import;
    return typeof wrapped === "string" ? JSON.parse(wrapped) : wrapped;
  }
  return value;
}

function parseMetadataInput(content: string): unknown {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  const direct = parseJsonCandidate(trimmed);
  if (direct.ok) return direct.value;

  // Some database clients emit an invalid wrapper where the inner JSON value
  // is quoted but its property quotes are not escaped. Extract only the inner
  // balanced object after the documented wrapper key and parse it strictly.
  const wrapped = extractInvalidMetadataWrapper(trimmed);
  if (wrapped) {
    const parsed = parseJsonCandidate(wrapped);
    if (parsed.ok) return parsed.value;
  }

  // CSV exports (notably Snowflake Snowsight) encode a single JSON field by
  // surrounding it with quotes and doubling every internal quote. Ignore any
  // header/prefix around the outermost JSON object, then undo CSV quote
  // escaping. Legitimate JSON backslash escapes remain untouched.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const csvCandidate = trimmed.slice(firstBrace, lastBrace + 1).replace(/""/g, '"');
    const parsed = parseJsonCandidate(csvCandidate);
    if (parsed.ok) return parsed.value;
  }

  throw new Error("Metadata input must contain valid JSON or a single-field CSV JSON export.");
}

function parseJsonCandidate(content: string):
  | { ok: true; value: unknown }
  | { ok: false } {
  if (!content) return { ok: false };
  try {
    let value: unknown = JSON.parse(content);
    // Database consoles sometimes return the entire JSON document as a JSON
    // string. Decode at most two transport layers to keep work bounded.
    for (let depth = 0; depth < 2 && typeof value === "string"; depth += 1) {
      value = JSON.parse(value);
    }
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function extractInvalidMetadataWrapper(content: string): string | null {
  const key = "metadata_json_to_import";
  const keyIndex = content.indexOf(key);
  if (keyIndex < 0) return null;
  const start = content.indexOf("{", keyIndex + key.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) {
      return content.slice(start, index + 1);
    }
  }
  return null;
}

function records(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => record(item, `${field}[${index}]`));
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string) {
  const result = text(value);
  if (!result) throw new Error(`${field} must be a non-empty string.`);
  return result;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function number(value: unknown) {
  return finiteNumber(value) || 0;
}

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function commaList(value: unknown) {
  return text(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function groupBy(
  values: Record<string, unknown>[],
  key: (value: Record<string, unknown>) => string,
) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const value of values) {
    const name = key(value);
    const group = groups.get(name) || [];
    group.push(value);
    groups.set(name, group);
  }
  return groups;
}

function stableFingerprint(
  identity: SchemaSnapshotIdentity,
  sourceName: string,
  relations: SchemaRelationSnapshot[],
) {
  const input = JSON.stringify([identity.driver, identity.databaseName || null, identity.schemaName, sourceName, relations]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `offline-metadata-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
