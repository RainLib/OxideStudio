import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  SchemaRelationSnapshot,
  SchemaSnapshot,
} from "@/services/tauri/types";

const OFFLINE_DIAGRAM_DRAFT_WARNING = "OFFLINE_DIAGRAM_DRAFT_REVIEW_ONLY";
const MAX_DRAFT_HISTORY = 100;

export type SchemaDiagramDraftHistory = {
  past: SchemaRelationSnapshot[][];
  present: SchemaRelationSnapshot[];
  future: SchemaRelationSnapshot[][];
};

export type SchemaDiagramDraftColumnInput = {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  autoIncrement?: boolean;
  defaultValue?: string;
  comment?: string;
};

export function createSchemaDiagramDraftHistory(
  snapshot: SchemaSnapshot,
): SchemaDiagramDraftHistory {
  return { past: [], present: snapshot.relations, future: [] };
}

export function commitSchemaDiagramDraft(
  history: SchemaDiagramDraftHistory,
  next: SchemaRelationSnapshot[],
): SchemaDiagramDraftHistory {
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_DRAFT_HISTORY),
    present: next,
    future: [],
  };
}

export function undoSchemaDiagramDraft(
  history: SchemaDiagramDraftHistory,
): SchemaDiagramDraftHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, MAX_DRAFT_HISTORY),
  };
}

export function redoSchemaDiagramDraft(
  history: SchemaDiagramDraftHistory,
): SchemaDiagramDraftHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_DRAFT_HISTORY),
    present: next,
    future: history.future.slice(1),
  };
}

export function addSchemaDraftRelation(
  relations: SchemaRelationSnapshot[],
  name: string,
) {
  const normalized = validatedIdentifier(name, "Relation name");
  assertUniqueRelation(relations, normalized);
  return [
    ...relations,
    {
      name: normalized,
      objectType: "BASE TABLE",
      columns: [],
      indexes: [],
      constraints: [],
    },
  ].sort((left, right) => left.name.localeCompare(right.name));
}

export function renameSchemaDraftRelation(
  relations: SchemaRelationSnapshot[],
  currentName: string,
  nextName: string,
) {
  const normalized = validatedIdentifier(nextName, "Relation name");
  if (normalized === currentName) return relations;
  relationByName(relations, currentName);
  assertUniqueRelation(relations, normalized);
  return relations
    .map((relation) => {
      const ownName = relation.name === currentName ? normalized : relation.name;
      const constraints = relation.constraints.map((constraint) =>
        constraint.referenced_table === currentName
          ? {
              ...constraint,
              referenced_table: normalized,
              definition: undefined,
            }
          : constraint,
      );
      return ownName !== relation.name || constraints.some(
        (constraint, index) => constraint !== relation.constraints[index],
      )
        ? { ...relation, name: ownName, constraints }
        : relation;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function removeSchemaDraftRelation(
  relations: SchemaRelationSnapshot[],
  name: string,
) {
  relationByName(relations, name);
  return relations
    .filter((relation) => relation.name !== name)
    .map((relation) => {
      const constraints = relation.constraints.filter(
        (constraint) => constraint.referenced_table !== name,
      );
      return constraints.length === relation.constraints.length
        ? relation
        : { ...relation, constraints };
    });
}

export function addSchemaDraftColumn(
  relations: SchemaRelationSnapshot[],
  relationName: string,
  input: SchemaDiagramDraftColumnInput,
) {
  const relation = relationByName(relations, relationName);
  const column = columnFromInput(input);
  if (relation.columns.some((candidate) => candidate.name === column.name)) {
    throw new Error(`Column ${relationName}.${column.name} already exists.`);
  }
  let constraints = relation.constraints;
  let indexes = relation.indexes;
  if (column.is_primary_key) {
    if (constraints.some((constraint) => constraint.constraint_type === "PRIMARY KEY")) {
      throw new Error(`${relationName} already has a primary key.`);
    }
    const name = uniqueObjectName(
      [...constraints.map((item) => item.name), ...indexes.map((item) => item.name)],
      `${relationName}_pkey`,
    );
    constraints = [...constraints, keyConstraint(name, "PRIMARY KEY", column.name)];
    indexes = [...indexes, keyIndex(name, column.name, true)];
  } else if (column.is_unique) {
    const name = uniqueObjectName(
      [...constraints.map((item) => item.name), ...indexes.map((item) => item.name)],
      `${relationName}_${column.name}_key`,
    );
    constraints = [...constraints, keyConstraint(name, "UNIQUE", column.name)];
    indexes = [...indexes, keyIndex(name, column.name, false)];
  }
  return replaceRelation(relations, relationName, {
    ...relation,
    columns: [...relation.columns, column],
    constraints,
    indexes,
  });
}

export function updateSchemaDraftColumn(
  relations: SchemaRelationSnapshot[],
  relationName: string,
  currentName: string,
  input: Omit<SchemaDiagramDraftColumnInput, "primaryKey" | "unique" | "autoIncrement">,
) {
  const relation = relationByName(relations, relationName);
  const current = relation.columns.find((column) => column.name === currentName);
  if (!current) throw new Error(`Column ${relationName}.${currentName} was not found.`);
  const nextName = validatedIdentifier(input.name, "Column name");
  if (
    nextName !== currentName &&
    relation.columns.some((column) => column.name === nextName)
  ) {
    throw new Error(`Column ${relationName}.${nextName} already exists.`);
  }
  const dataType = input.dataType.trim();
  if (!dataType) throw new Error("Column type is required.");
  const nextColumn: ColumnInfo = {
    ...current,
    name: nextName,
    data_type: dataType,
    is_nullable: input.nullable,
    default_value: optionalText(input.defaultValue),
    comment: optionalText(input.comment),
  };

  return relations.map((candidate) => {
    const isSource = candidate.name === relationName;
    const columns = isSource
      ? candidate.columns.map((column) =>
          column.name === currentName ? nextColumn : column,
        )
      : candidate.columns;
    const indexes = isSource
      ? candidate.indexes.map((index) => ({
          ...index,
          columns: replaceName(index.columns, currentName, nextName),
          definition: index.columns.includes(currentName)
            ? undefined
            : index.definition,
        }))
      : candidate.indexes;
    const constraints = candidate.constraints.map((constraint) => {
      const columns = isSource
        ? replaceName(constraint.columns, currentName, nextName)
        : constraint.columns;
      const referencedColumns = constraint.referenced_table === relationName
        ? replaceName(constraint.referenced_columns, currentName, nextName)
        : constraint.referenced_columns;
      return columns !== constraint.columns || referencedColumns !== constraint.referenced_columns
        ? {
            ...constraint,
            columns,
            referenced_columns: referencedColumns,
            definition: undefined,
          }
        : constraint;
    });
    return columns !== candidate.columns || indexes !== candidate.indexes || constraints.some(
      (constraint, index) => constraint !== candidate.constraints[index],
    )
      ? { ...candidate, columns, indexes, constraints }
      : candidate;
  });
}

export function removeSchemaDraftColumn(
  relations: SchemaRelationSnapshot[],
  relationName: string,
  columnName: string,
) {
  const relation = relationByName(relations, relationName);
  if (!relation.columns.some((column) => column.name === columnName)) {
    throw new Error(`Column ${relationName}.${columnName} was not found.`);
  }
  return relations.map((candidate) => {
    if (candidate.name === relationName) {
      return {
        ...candidate,
        columns: candidate.columns.filter((column) => column.name !== columnName),
        indexes: candidate.indexes.filter((index) => !index.columns.includes(columnName)),
        constraints: candidate.constraints.filter(
          (constraint) => !constraint.columns.includes(columnName)
            && !(constraint.referenced_table === relationName
              && constraint.referenced_columns.includes(columnName)),
        ),
      };
    }
    const constraints = candidate.constraints.filter(
      (constraint) => !(constraint.referenced_table === relationName
        && constraint.referenced_columns.includes(columnName)),
    );
    return constraints.length === candidate.constraints.length
      ? candidate
      : { ...candidate, constraints };
  });
}

export function addSchemaDraftIndex(
  relations: SchemaRelationSnapshot[],
  relationName: string,
  index: Pick<IndexInfo, "name" | "columns" | "is_unique"> & Partial<IndexInfo>,
) {
  const relation = relationByName(relations, relationName);
  const name = validatedIdentifier(index.name, "Index name");
  if (relation.indexes.some((candidate) => candidate.name === name)) {
    throw new Error(`Index ${relationName}.${name} already exists.`);
  }
  const columns = validatedColumns(relation, index.columns, "Index");
  return replaceRelation(relations, relationName, {
    ...relation,
    columns: relation.columns.map((column) =>
      columns.includes(column.name)
        ? {
            ...column,
            is_indexed: true,
            is_unique: column.is_unique || (Boolean(index.is_unique) && columns.length === 1),
          }
        : column,
    ),
    indexes: [
      ...relation.indexes,
      {
        name,
        columns,
        is_unique: Boolean(index.is_unique),
        is_primary: Boolean(index.is_primary),
        index_type: optionalText(index.index_type),
      },
    ],
  });
}

export function addSchemaDraftForeignKey(
  relations: SchemaRelationSnapshot[],
  relationName: string,
  input: {
    name: string;
    columns: string[];
    referencedSchema?: string;
    referencedTable: string;
    referencedColumns: string[];
  },
) {
  const relation = relationByName(relations, relationName);
  const target = relationByName(relations, input.referencedTable);
  const name = validatedIdentifier(input.name, "Foreign key name");
  if (relation.constraints.some((constraint) => constraint.name === name)) {
    throw new Error(`Constraint ${relationName}.${name} already exists.`);
  }
  const columns = validatedColumns(relation, input.columns, "Foreign key");
  const referencedColumns = validatedColumns(
    target,
    input.referencedColumns,
    "Referenced foreign key",
  );
  if (columns.length !== referencedColumns.length) {
    throw new Error("Foreign key source and target column counts must match.");
  }
  return replaceRelation(relations, relationName, {
    ...relation,
    constraints: [
      ...relation.constraints,
      {
        name,
        constraint_type: "FOREIGN KEY",
        columns,
        referenced_schema: optionalText(input.referencedSchema),
        referenced_table: target.name,
        referenced_columns: referencedColumns,
      },
    ],
  });
}

export function addSchemaDraftCheckConstraint(
  relations: SchemaRelationSnapshot[],
  relationName: string,
  name: string,
  definition: string,
) {
  const relation = relationByName(relations, relationName);
  const normalizedName = validatedIdentifier(name, "Constraint name");
  const normalizedDefinition = definition.trim();
  if (!normalizedDefinition) throw new Error("CHECK definition is required.");
  if (relation.constraints.some((constraint) => constraint.name === normalizedName)) {
    throw new Error(`Constraint ${relationName}.${normalizedName} already exists.`);
  }
  return replaceRelation(relations, relationName, {
    ...relation,
    constraints: [
      ...relation.constraints,
      {
        name: normalizedName,
        constraint_type: "CHECK",
        columns: [],
        referenced_columns: [],
        definition: normalizedDefinition,
      },
    ],
  });
}

export function removeSchemaDraftIndex(
  relations: SchemaRelationSnapshot[],
  relationName: string,
  name: string,
) {
  const relation = relationByName(relations, relationName);
  const removed = relation.indexes.find((index) => index.name === name);
  if (!removed) return relations;
  const indexes = relation.indexes.filter((index) => index.name !== name);
  const constraints = removed.is_primary
    ? relation.constraints.filter(
        (constraint) => !(constraint.name === name && constraint.constraint_type === "PRIMARY KEY"),
      )
    : relation.constraints;
  const primaryColumns = new Set([
    ...constraints
      .filter((constraint) => constraint.constraint_type === "PRIMARY KEY")
      .flatMap((constraint) => constraint.columns),
    ...indexes.filter((index) => index.is_primary).flatMap((index) => index.columns),
  ]);
  const indexedColumns = new Set(indexes.flatMap((index) => index.columns));
  const uniqueSingleColumns = new Set([
    ...constraints
      .filter((constraint) => constraint.constraint_type === "UNIQUE" && constraint.columns.length === 1)
      .flatMap((constraint) => constraint.columns),
    ...indexes
      .filter((index) => index.is_unique && index.columns.length === 1)
      .flatMap((index) => index.columns),
  ]);
  return replaceRelation(relations, relationName, {
    ...relation,
    columns: relation.columns.map((column) => ({
      ...column,
      is_primary_key: primaryColumns.has(column.name),
      is_indexed: primaryColumns.has(column.name) || indexedColumns.has(column.name),
      is_unique: primaryColumns.has(column.name) || uniqueSingleColumns.has(column.name),
    })),
    indexes,
    constraints,
  });
}

export function removeSchemaDraftConstraint(
  relations: SchemaRelationSnapshot[],
  relationName: string,
  name: string,
) {
  const relation = relationByName(relations, relationName);
  return replaceRelation(relations, relationName, {
    ...relation,
    constraints: relation.constraints.filter((constraint) => constraint.name !== name),
  });
}

export function createSchemaDiagramDraftSnapshot(
  base: SchemaSnapshot,
  relations: SchemaRelationSnapshot[],
  capturedAt = Date.now(),
): SchemaSnapshot {
  const fingerprint = draftFingerprint(base, relations);
  return {
    ...base,
    id: `diagram-draft-${capturedAt}-${fingerprint.slice(-8)}`,
    fingerprint,
    capturedAt,
    relations,
    warnings: [
      OFFLINE_DIAGRAM_DRAFT_WARNING,
      "Source: Structured diagram draft",
      ...base.warnings.filter((warning) => warning !== OFFLINE_DIAGRAM_DRAFT_WARNING),
    ],
  };
}

export function isSchemaDiagramDraftSnapshot(snapshot: SchemaSnapshot) {
  return snapshot.warnings.includes(OFFLINE_DIAGRAM_DRAFT_WARNING);
}

function columnFromInput(input: SchemaDiagramDraftColumnInput): ColumnInfo {
  const name = validatedIdentifier(input.name, "Column name");
  const dataType = input.dataType.trim();
  if (!dataType) throw new Error("Column type is required.");
  return {
    name,
    data_type: dataType,
    is_nullable: input.nullable,
    is_primary_key: Boolean(input.primaryKey),
    is_unique: Boolean(input.primaryKey || input.unique),
    is_indexed: Boolean(input.primaryKey || input.unique),
    is_auto_increment: Boolean(input.autoIncrement),
    default_value: optionalText(input.defaultValue),
    comment: optionalText(input.comment),
  };
}

function relationByName(relations: SchemaRelationSnapshot[], name: string) {
  const relation = relations.find((candidate) => candidate.name === name);
  if (!relation) throw new Error(`Relation ${name} was not found.`);
  return relation;
}

function replaceRelation(
  relations: SchemaRelationSnapshot[],
  name: string,
  replacement: SchemaRelationSnapshot,
) {
  return relations.map((relation) => relation.name === name ? replacement : relation);
}

function assertUniqueRelation(relations: SchemaRelationSnapshot[], name: string) {
  if (relations.some((relation) => relation.name === name)) {
    throw new Error(`Relation ${name} already exists.`);
  }
}

function validatedIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.includes("\u0000")) throw new Error(`${label} contains an invalid character.`);
  return normalized;
}

function validatedColumns(
  relation: SchemaRelationSnapshot,
  values: string[],
  label: string,
) {
  const columns = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (columns.length === 0) throw new Error(`${label} columns are required.`);
  const known = new Set(relation.columns.map((column) => column.name));
  const missing = columns.filter((column) => !known.has(column));
  if (missing.length > 0) {
    throw new Error(`${label} references missing column(s): ${missing.join(", ")}.`);
  }
  return columns;
}

function replaceName(values: string[], current: string, next: string) {
  if (current === next || !values.includes(current)) return values;
  return values.map((value) => value === current ? next : value);
}

function optionalText(value: string | undefined) {
  return value?.trim() || undefined;
}

function uniqueObjectName(existing: string[], preferred: string) {
  const names = new Set(existing);
  if (!names.has(preferred)) return preferred;
  let sequence = 2;
  while (names.has(`${preferred}_${sequence}`)) sequence += 1;
  return `${preferred}_${sequence}`;
}

function keyConstraint(
  name: string,
  constraintType: "PRIMARY KEY" | "UNIQUE",
  column: string,
): ConstraintInfo {
  return {
    name,
    constraint_type: constraintType,
    columns: [column],
    referenced_columns: [],
  };
}

function keyIndex(name: string, column: string, primary: boolean): IndexInfo {
  return {
    name,
    columns: [column],
    is_unique: true,
    is_primary: primary,
  };
}

function draftFingerprint(base: SchemaSnapshot, relations: SchemaRelationSnapshot[]) {
  const input = JSON.stringify([
    base.driver,
    base.databaseName || null,
    base.schemaName,
    relations,
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `offline-diagram-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
