import type {
  CollectionInfo,
  ColumnInfo,
  DatabaseCapabilities,
  IndexInfo,
} from "@/services/tauri";

export type LspTableDefinition = {
  name: string;
  object_type: string | null;
  comment: string | null;
  source_location: null;
  indexes: Array<{
    name: string;
    columns: string[];
    is_unique: boolean;
    is_primary: boolean;
    index_type: string | null;
    definition: string | null;
  }>;
  constraints: Array<{
    name: string;
    constraint_type: string;
    columns: string[];
    referenced_schema: string | null;
    referenced_table: string | null;
    referenced_columns: string[];
    definition: string | null;
  }>;
  columns: Array<{
    name: string;
    data_type: string;
    nullable: boolean;
    primary_key: boolean;
    unique: boolean;
    indexed: boolean;
    default_value?: string | null;
    auto_increment?: boolean;
    comment: string | null;
    source_location: null;
  }>;
};

export type LspFunctionDefinition = {
  name: string;
  routine_type: string | null;
  parameters: Array<{
    name: string;
    data_type: string;
    optional: boolean;
    mode?: string | null;
  }>;
  return_type: string;
  description: string | null;
};

export type LspSchemaDefinition = {
  id: string;
  catalog?: string | null;
  database: string;
  source_uri: null;
  tables: LspTableDefinition[];
  functions: LspFunctionDefinition[];
};

export function emptyLspTableDetails(): Pick<
  LspTableDefinition,
  "source_location" | "indexes" | "constraints"
> {
  return {
    source_location: null,
    indexes: [],
    constraints: [],
  };
}

export function collectionToLspTableDefinition(
  capabilities: DatabaseCapabilities,
  collection: CollectionInfo,
  columns: ColumnInfo[] = [],
  indexes: IndexInfo[] = []
): LspTableDefinition {
  const objectType = collection.type || capabilities.dataModel;
  const countLabel =
    typeof collection.documentCount === "number"
      ? collectionCountLabel(capabilities, collection.documentCount)
      : null;

  return {
    name: collection.name,
    object_type: objectType,
    comment: countLabel,
    ...emptyLspTableDetails(),
    indexes: indexes.map(lspIndex),
    columns: lspColumnsForCollection(capabilities, collection, columns),
  };
}

export function collectionCountLabel(
  capabilities: DatabaseCapabilities,
  count: number
) {
  if (capabilities.dataModel === "keyValue") {
    return `${count} value item(s)`;
  }
  if (capabilities.dataModel === "search") {
    return `${count} indexed document(s)`;
  }
  return `${count} document(s)`;
}

export function lspSchemaSignature(schemaDefinitions: LspSchemaDefinition[]) {
  const canonicalSchemas = schemaDefinitions
    .map((schema) => ({
      id: schema.id,
      catalog: schema.catalog ?? null,
      database: schema.database,
      source_uri: schema.source_uri ?? null,
      tables: sortCanonical(
        schema.tables.map((table) => ({
          name: table.name,
          object_type: table.object_type ?? null,
          comment: table.comment ?? null,
          source_location: table.source_location ?? null,
          columns: sortCanonical(
            table.columns.map((column) => ({
              name: column.name,
              data_type: column.data_type,
              nullable: column.nullable,
              primary_key: column.primary_key,
              unique: column.unique,
              indexed: column.indexed,
              default_value: column.default_value ?? null,
              auto_increment: column.auto_increment ?? false,
              comment: column.comment ?? null,
              source_location: column.source_location ?? null,
            }))
          ),
          indexes: sortCanonical(
            table.indexes.map((index) => ({
              name: index.name,
              columns: [...index.columns],
              is_unique: index.is_unique,
              is_primary: index.is_primary,
              index_type: index.index_type ?? null,
              definition: index.definition ?? null,
            }))
          ),
          constraints: sortCanonical(
            table.constraints.map((constraint) => ({
              name: constraint.name,
              constraint_type: constraint.constraint_type,
              columns: [...constraint.columns],
              referenced_schema: constraint.referenced_schema ?? null,
              referenced_table: constraint.referenced_table ?? null,
              referenced_columns: [...constraint.referenced_columns],
              definition: constraint.definition ?? null,
            }))
          ),
        }))
      ),
      functions: sortCanonical(
        schema.functions.map((fn) => ({
          name: fn.name,
          routine_type: fn.routine_type ?? null,
          return_type: fn.return_type,
          description: fn.description ?? null,
          // Parameter order is part of a routine signature, so retain it while
          // canonicalizing the surrounding function collection.
          parameters: fn.parameters.map((parameter, position) => ({
            position,
            name: parameter.name,
            data_type: parameter.data_type,
            optional: parameter.optional,
            mode: parameter.mode ?? null,
          })),
        }))
      ),
    }))
    .sort(compareCanonical);

  return JSON.stringify(canonicalSchemas);
}

function sortCanonical<T>(values: T[]) {
  return values.sort(compareCanonical);
}

function compareCanonical(left: unknown, right: unknown) {
  const leftSignature = JSON.stringify(left);
  const rightSignature = JSON.stringify(right);
  if (leftSignature < rightSignature) return -1;
  if (leftSignature > rightSignature) return 1;
  return 0;
}

export function selectLspTablesForSchema<T extends { name: string }>(
  schemaTables: T[],
  preferredTableNames: Iterable<string> | undefined,
  maxTables = Number.POSITIVE_INFINITY
) {
  const selected: T[] = [];
  const selectedNames = new Set<string>();
  const byExactName = new Map(schemaTables.map((table) => [table.name, table]));
  const byLowerName = new Map(
    schemaTables.map((table) => [table.name.toLowerCase(), table])
  );

  const pushTable = (table: T | undefined) => {
    if (!table || selectedNames.has(table.name)) return;
    selected.push(table);
    selectedNames.add(table.name);
  };

  const selectionLimit = Number.isFinite(maxTables)
    ? Math.max(0, Math.floor(maxTables))
    : Number.POSITIVE_INFINITY;

  for (const preferredName of preferredTableNames || []) {
    if (selected.length >= selectionLimit) break;
    pushTable(
      byExactName.get(preferredName) || byLowerName.get(preferredName.toLowerCase())
    );
  }

  for (const table of schemaTables) {
    if (selected.length >= selectionLimit) break;
    pushTable(table);
  }

  return selected;
}

function lspColumn(
  name: string,
  dataType: string,
  comment: string | null = null
): LspTableDefinition["columns"][number] {
  return {
    name,
    data_type: dataType,
    nullable: true,
    primary_key: false,
    unique: false,
    indexed: false,
    default_value: null,
    auto_increment: false,
    comment,
    source_location: null,
  };
}

function lspIndex(index: IndexInfo): LspTableDefinition["indexes"][number] {
  return {
    name: index.name,
    columns: index.columns || [],
    is_unique: index.is_unique,
    is_primary: index.is_primary,
    index_type: index.index_type || null,
    definition: index.definition || null,
  };
}

function lspColumnsForCollection(
  capabilities: DatabaseCapabilities,
  collection: CollectionInfo,
  columns: ColumnInfo[] = []
): LspTableDefinition["columns"] {
  if (capabilities.dataModel === "keyValue") {
    return [
      lspColumn("key", "string", "Redis key"),
      lspColumn("type", collection.type || "string", "Redis key type"),
      lspColumn("value", "json", "Redis value preview"),
    ];
  }

  if (capabilities.dataModel === "search") {
    if (columns.length > 0) {
      return columns.map(lspColumnFromColumnInfo);
    }

    return [
      lspColumn("id", "keyword", "Document id"),
      lspColumn("score", "double", "Search score"),
      lspColumn("source", "object", "Document source"),
    ];
  }

  if (capabilities.dataModel === "document") {
    if (columns.length > 0) {
      return columns.map(lspColumnFromColumnInfo);
    }

    return [
      lspColumn("_id", "objectId", "Document id"),
      lspColumn("document", "object", "Document body"),
    ];
  }

  return [lspColumn("value", "json", "Object value")];
}

function lspColumnFromColumnInfo(
  column: ColumnInfo
): LspTableDefinition["columns"][number] {
  return {
    name: column.name,
    data_type: column.data_type || "json",
    nullable: column.is_nullable,
    primary_key: column.is_primary_key,
    unique: column.is_unique ?? false,
    indexed: column.is_indexed ?? false,
    default_value: column.default_value ?? null,
    auto_increment: column.is_auto_increment ?? false,
    comment: column.comment || null,
    source_location: null,
  };
}
