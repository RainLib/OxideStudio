import {
  connectionDatabaseNamespacePreference,
  isFileBasedDatabaseDriver,
  selectPreferredNamespace,
} from "@/lib/databaseDialect";
import type {
  LspCatalogTarget,
  LspSyncConnection,
  LspSyncTab,
} from "./types";

export function selectDefaultLspSchema(
  connection: LspSyncConnection,
  schemas: string[],
  currentSchema?: string | null,
) {
  return selectPreferredNamespace(connection.driver, schemas, [
    currentSchema,
    connectionDatabaseNamespacePreference(connection.driver, connection.database),
  ]);
}

export function normalizeLspSchemaName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeLspDatabaseName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function lspSchemaForTab(tab: LspSyncTab, defaultSchema: string) {
  return (
    normalizeLspSchemaName(tab.targetSchema) ||
    normalizeLspSchemaName(tab.schemaName) ||
    defaultSchema
  );
}

export function supportsLspConnectionCatalogs(connection: LspSyncConnection) {
  if (connection.supportsDatabaseCatalogs !== undefined) {
    return connection.supportsDatabaseCatalogs === true;
  }
  if (connection.driver === "duckdb") return true;
  if (isFileBasedDatabaseDriver(connection.driver)) return false;
  return connection.driver === "postgres";
}

export function defaultLspCatalogName(connection: LspSyncConnection) {
  // DuckDB's main database is a file path; only attached databases are catalogs.
  if (connection.driver === "duckdb") return null;
  if (!supportsLspConnectionCatalogs(connection)) return null;
  return normalizeLspDatabaseName(connection.database);
}

export function catalogForLspTab(
  tab: LspSyncTab,
  defaultCatalog: LspCatalogTarget,
  connection: LspSyncConnection,
): LspCatalogTarget {
  const databaseName = supportsLspConnectionCatalogs(connection)
    ? normalizeLspDatabaseName(tab.databaseName)
    : null;
  return {
    catalogName:
      databaseName || defaultCatalog.catalogName || defaultLspCatalogName(connection),
    databaseName,
    schemaName: lspSchemaForTab(tab, defaultCatalog.schemaName),
  };
}

export function lspCatalogKey(catalog: LspCatalogTarget) {
  return JSON.stringify([
    catalog.catalogName || "",
    catalog.schemaName.toLowerCase(),
  ]);
}

export function findKnownLspSchemaName(
  schemaNames: string[],
  schemaName?: string | null,
) {
  const normalized = schemaName?.trim().toLowerCase();
  if (!normalized) return null;
  return schemaNames.find((candidate) => candidate.toLowerCase() === normalized) || null;
}

export function addPreferredLspTable(
  preferredTables: Map<string, Set<string>>,
  scope: string | null,
  tableName: string | null | undefined,
) {
  const normalizedScope = scope?.trim();
  const table = tableName?.trim();
  if (!normalizedScope || !table) return;
  const tables = preferredTables.get(normalizedScope) || new Set<string>();
  tables.add(table);
  preferredTables.set(normalizedScope, tables);
}
