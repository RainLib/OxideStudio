import type {
  CollectionInfo,
  ColumnInfo,
  DatabaseCapabilities,
  IndexInfo,
} from "@/services/tauri";
import type { LspSourceLocation, LspTableDefinition } from "./types";

export function classifyLspColumnOwnership(
  column: ColumnInfo,
  options: {
    hasExactGeneratedColumnFallback: boolean;
    generatedColumnNames: ReadonlySet<string> | null;
  },
) {
  const generated =
    typeof column.is_generated === "boolean"
      ? column.is_generated
      : options.hasExactGeneratedColumnFallback
        ? options.generatedColumnNames === null ||
          options.generatedColumnNames.has(column.name)
        : true;

  return {
    generated,
    // Unknown visibility remains selectable, but never becomes an affirmative
    // hidden classification. INSERT safety is already provided by generated.
    hidden: column.is_hidden === true,
  };
}

export function emptyLspTableDetails(
  sourceLocation: LspSourceLocation = null,
): Pick<LspTableDefinition, "source_location" | "indexes" | "constraints"> {
  return { source_location: sourceLocation, indexes: [], constraints: [] };
}

export function assignLspObjectSourceLocations(
  definition: LspTableDefinition,
  options: { tableUri: string; columnUri: (columnName: string) => string },
): LspTableDefinition {
  return {
    ...definition,
    source_location: [options.tableUri, 1],
    columns: definition.columns.map((column) => ({
      ...column,
      source_location: [options.columnUri(column.name), 1],
    })),
  };
}

export function collectionToLspTableDefinition(
  capabilities: DatabaseCapabilities,
  collection: CollectionInfo,
  columns: ColumnInfo[] = [],
  indexes: IndexInfo[] = [],
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
  count: number,
) {
  if (capabilities.dataModel === "keyValue") return `${count} value item(s)`;
  if (capabilities.dataModel === "search") return `${count} indexed document(s)`;
  return `${count} document(s)`;
}

function lspColumn(
  name: string,
  dataType: string,
  comment: string | null = null,
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
    generated: false,
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
  columns: ColumnInfo[] = [],
): LspTableDefinition["columns"] {
  if (capabilities.dataModel === "keyValue") {
    return [
      lspColumn("key", "string", "Redis key"),
      lspColumn("type", collection.type || "string", "Redis key type"),
      lspColumn("value", "json", "Redis value preview"),
    ];
  }
  if (capabilities.dataModel === "search") {
    return columns.length > 0
      ? columns.map(lspColumnFromColumnInfo)
      : [
          lspColumn("id", "keyword", "Document id"),
          lspColumn("score", "double", "Search score"),
          lspColumn("source", "object", "Document source"),
        ];
  }
  if (capabilities.dataModel === "document") {
    return columns.length > 0
      ? columns.map(lspColumnFromColumnInfo)
      : [
          lspColumn("_id", "objectId", "Document id"),
          lspColumn("document", "object", "Document body"),
        ];
  }
  return [lspColumn("value", "json", "Object value")];
}

function lspColumnFromColumnInfo(
  column: ColumnInfo,
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
    generated: false,
    comment: column.comment || null,
    source_location: null,
  };
}
