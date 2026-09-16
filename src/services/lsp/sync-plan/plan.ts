import { extractRelationReferences } from "@/lib/sqlAnalysis";
import {
  addPreferredLspTable,
  catalogForLspTab,
  defaultLspCatalogName,
  findKnownLspSchemaName,
  lspCatalogKey,
  normalizeLspDatabaseName,
  selectDefaultLspSchema,
  supportsLspConnectionCatalogs,
} from "./catalog";
import type {
  LspCatalogTarget,
  LspSyncConnection,
  LspSyncPlan,
  LspSyncTab,
} from "./types";

export function createLspSyncPlan(options: {
  activeConnectionId: string;
  connection: LspSyncConnection;
  schemas: string[];
  currentSchema?: string | null;
  activeTabId?: string | null;
  tabs: LspSyncTab[];
}): LspSyncPlan | null {
  const { activeConnectionId, connection, schemas, currentSchema, activeTabId, tabs } = options;
  const defaultSchema = selectDefaultLspSchema(connection, schemas, currentSchema);
  if (!defaultSchema) return null;

  const defaultCatalog: LspCatalogTarget = {
    catalogName: defaultLspCatalogName(connection),
    databaseName: null,
    schemaName: defaultSchema,
  };
  const connectionTabs = tabs.filter(
    (tab) => (tab.connectionId || activeConnectionId) === activeConnectionId,
  );
  // Table tabs own virtual SELECT documents for their compact WHERE editors.
  const queryTabs = connectionTabs.filter(
    (tab) => tab.type === "query" || tab.type === "table",
  );
  const preferredTablesBySchema = new Map<string, Set<string>>();
  const preferredTablesByCatalog = new Map<string, Set<string>>();
  const targetCatalogsByKey = new Map<string, LspCatalogTarget>();
  const schemaByTabId: Record<string, string> = {};
  const catalogByTabId: Record<string, LspCatalogTarget> = {};

  for (const tab of queryTabs) {
    const catalog = catalogForLspTab(tab, defaultCatalog, connection);
    schemaByTabId[tab.id] = catalog.schemaName;
    catalogByTabId[tab.id] = catalog;
    targetCatalogsByKey.set(lspCatalogKey(catalog), catalog);
  }

  const preferredTabs = activeTabId
    ? [
        ...connectionTabs.filter((tab) => tab.id === activeTabId),
        ...connectionTabs.filter((tab) => tab.id !== activeTabId),
      ]
    : connectionTabs;
  for (const tab of preferredTabs) {
    const catalog = catalogForLspTab(tab, defaultCatalog, connection);
    const catalogKey = lspCatalogKey(catalog);
    targetCatalogsByKey.set(catalogKey, catalog);
    addPreferredLspTable(preferredTablesBySchema, catalog.schemaName, tab.tableName);
    addPreferredLspTable(preferredTablesByCatalog, catalogKey, tab.tableName);
  }

  for (const tab of queryTabs) {
    const tabCatalog = catalogByTabId[tab.id] || defaultCatalog;
    for (const reference of extractRelationReferences(tab.sql || "", connection.driver)) {
      const schemaName =
        findKnownLspSchemaName(schemas, reference.schema) || tabCatalog.schemaName;
      const referencedDatabase =
        supportsLspConnectionCatalogs(connection) && reference.database
          ? normalizeLspDatabaseName(reference.database)
          : null;
      const referencedCatalog: LspCatalogTarget = {
        catalogName: referencedDatabase || tabCatalog.catalogName,
        databaseName: referencedDatabase || tabCatalog.databaseName,
        schemaName,
      };
      const catalogKey = lspCatalogKey(referencedCatalog);
      targetCatalogsByKey.set(catalogKey, referencedCatalog);
      addPreferredLspTable(preferredTablesBySchema, schemaName, reference.table);
      addPreferredLspTable(preferredTablesByCatalog, catalogKey, reference.table);
    }
  }

  const targetCatalogs = Array.from(targetCatalogsByKey.values());
  const targetSchemas = Array.from(
    new Set(targetCatalogs.map((catalog) => catalog.schemaName)),
  );
  return {
    defaultSchema,
    defaultCatalog,
    connectionTabs,
    queryTabs,
    targetSchemas,
    targetCatalogs,
    preferredTablesBySchema,
    preferredTablesByCatalog,
    schemaByTabId,
    catalogByTabId,
  };
}
