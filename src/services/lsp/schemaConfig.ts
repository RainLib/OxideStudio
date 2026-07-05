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
  }>;
  return_type: string;
  description: string | null;
};

export type LspSchemaDefinition = {
  id: string;
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
  return schemaDefinitions
    .map((schema) => {
      const tableSignature = schema.tables
        .map((table) => {
          const columnSignature = table.columns
            .map(
              (column) =>
                `${column.name}:${column.data_type}:${column.nullable ? "1" : "0"}:${
                  column.primary_key ? "1" : "0"
                }:${column.indexed ? "1" : "0"}`
            )
            .join(",");
          return `${table.name}:${table.object_type || ""}:${
            table.comment || ""
          }:${columnSignature}:${table.indexes.length}:${
            table.constraints.length
          }`;
        })
        .join("|");
      const functionSignature = schema.functions
        .map(
          (fn) =>
            `${fn.name}:${fn.routine_type || ""}:${fn.parameters.length}:${
              fn.return_type
            }`
        )
        .join("|");
      return `${schema.id}:${schema.database}:${tableSignature}:${functionSignature}`;
    })
    .join(";");
}

export function selectLspTablesForSchema<T extends { name: string }>(
  schemaTables: T[],
  preferredTableNames: Iterable<string> | undefined,
  maxTables: number
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

  for (const preferredName of preferredTableNames || []) {
    if (selected.length >= maxTables) break;
    pushTable(
      byExactName.get(preferredName) || byLowerName.get(preferredName.toLowerCase())
    );
  }

  for (const table of schemaTables) {
    if (selected.length >= maxTables) break;
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
    comment: column.comment || null,
    source_location: null,
  };
}
