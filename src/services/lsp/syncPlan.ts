import { selectPreferredNamespace } from "@/lib/databaseDialect";
import { extractRelationReferences } from "@/lib/sqlAnalysis";
import type { DatabaseDriver } from "@/services/tauri/types";
import { getLspDocumentUri } from "./document";
import { lspSchemaSignature, type LspSchemaDefinition } from "./schemaConfig";

export type LspSyncConnection = {
  id: string;
  driver: DatabaseDriver;
  database?: string | null;
};

export type LspSyncTab = {
  id: string;
  type: string;
  connectionId?: string | null;
  databaseName?: string | null;
  targetSchema?: string | null;
  schemaName?: string | null;
  tableName?: string | null;
  sql?: string | null;
};

export type LspCatalogTarget = {
  /** The catalog name used for identity and completion provenance. */
  catalogName: string | null;
  /**
   * An explicitly selected server database. When present, metadata must use
   * the database-scoped Tauri commands instead of the saved connection's
   * primary database.
   */
  databaseName: string | null;
  schemaName: string;
};

export type LspSyncPlan = {
  defaultSchema: string;
  defaultCatalog: LspCatalogTarget;
  connectionTabs: LspSyncTab[];
  queryTabs: LspSyncTab[];
  targetSchemas: string[];
  targetCatalogs: LspCatalogTarget[];
  preferredTablesBySchema: Map<string, Set<string>>;
  preferredTablesByCatalog: Map<string, Set<string>>;
  schemaByTabId: Record<string, string>;
  catalogByTabId: Record<string, LspCatalogTarget>;
};

export type LspFileMappings = {
  fileSchemas: Record<string, string>;
  fileDialects: Record<string, string>;
};

export type LspCompletionPreferences = {
  keywordCase: "upper" | "lower" | "preserve";
  tableAlias: "none" | "initials";
};

export type LspConfigKeyInput = LspFileMappings & {
  connectionId: string;
  driver: DatabaseDriver;
  lspDialect: string;
  completionPreferences?: LspCompletionPreferences;
  schemaDefinitions: LspSchemaDefinition[];
};

export function createLspSyncPlan(options: {
  activeConnectionId: string;
  connection: LspSyncConnection;
  schemas: string[];
  currentSchema?: string | null;
  activeTabId?: string | null;
  tabs: LspSyncTab[];
}): LspSyncPlan | null {
  const {
    activeConnectionId,
    connection,
    schemas,
    currentSchema,
    activeTabId,
    tabs,
  } = options;
  const defaultSchema = selectPreferredNamespace(connection.driver, schemas, [
    currentSchema,
    connection.database,
  ]);
  if (!defaultSchema) return null;

  const defaultCatalog: LspCatalogTarget = {
    catalogName: defaultCatalogName(connection),
    databaseName: null,
    schemaName: defaultSchema,
  };

  const connectionTabs = tabs.filter(
    (tab) => (tab.connectionId || activeConnectionId) === activeConnectionId
  );
  // Table tabs own a virtual SELECT document for the compact WHERE editor.
  // Including them here gives that document the same schema binding as a full
  // query console without opening a hidden query tab.
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
    targetCatalogsByKey.set(lspCatalogKey(catalog), catalog);
    addPreferredTable(
      preferredTablesBySchema,
      catalog.schemaName,
      tab.tableName
    );
    addPreferredTable(
      preferredTablesByCatalog,
      lspCatalogKey(catalog),
      tab.tableName
    );
  }

  for (const tab of queryTabs) {
    const tabCatalog = catalogByTabId[tab.id] || defaultCatalog;
    for (const reference of extractRelationReferences(
      tab.sql || "",
      connection.driver
    )) {
      const qualifiedSchema = findKnownSchemaName(schemas, reference.schema);
      const schemaName = qualifiedSchema || tabCatalog.schemaName;
      const referencedCatalog = { ...tabCatalog, schemaName };
      targetCatalogsByKey.set(lspCatalogKey(referencedCatalog), referencedCatalog);
      addPreferredTable(preferredTablesBySchema, schemaName, reference.table);
      addPreferredTable(
        preferredTablesByCatalog,
        lspCatalogKey(referencedCatalog),
        reference.table
      );
    }
  }

  const targetCatalogs = Array.from(targetCatalogsByKey.values());
  const targetSchemas = Array.from(
    new Set(targetCatalogs.map((catalog) => catalog.schemaName))
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

export function buildLspFileMappings(options: {
  queryTabs: LspSyncTab[];
  schemaByTabId: Record<string, string>;
  catalogByTabId?: Record<string, LspCatalogTarget>;
  defaultSchema: string;
  defaultCatalog?: LspCatalogTarget;
  driver: DatabaseDriver;
  lspDialect: string;
  getSchemaId: (
    schemaName: string,
    catalogName?: string | null,
    databaseName?: string | null
  ) => string;
}): LspFileMappings {
  const {
    queryTabs,
    schemaByTabId,
    catalogByTabId = {},
    defaultSchema,
    defaultCatalog,
    driver,
    lspDialect,
    getSchemaId,
  } = options;

  const fileSchemas = Object.fromEntries(
    queryTabs.map((tab) => {
      const tabDatabaseName = normalizeDatabaseName(tab.databaseName);
      const fallbackCatalog: LspCatalogTarget = defaultCatalog || {
        catalogName: tabDatabaseName,
        databaseName: tabDatabaseName,
        schemaName: defaultSchema,
      };
      const schemaName =
        schemaByTabId[tab.id] || schemaForLspTab(tab, fallbackCatalog.schemaName);
      const catalog = catalogByTabId[tab.id] || {
        catalogName: tabDatabaseName || fallbackCatalog.catalogName,
        databaseName: tabDatabaseName,
        schemaName,
      };
      return [
        getLspDocumentUri(tab.id, driver, lspDialect),
        getSchemaId(schemaName, catalog.catalogName, catalog.databaseName),
      ];
    })
  );
  const fileDialects = Object.fromEntries(
    queryTabs.map((tab) => [
      getLspDocumentUri(tab.id, driver, lspDialect),
      lspDialect,
    ])
  );

  return { fileSchemas, fileDialects };
}

export function createLspConfigKey(input: LspConfigKeyInput) {
  return JSON.stringify({
    connectionId: input.connectionId,
    driver: input.driver,
    lspDialect: input.lspDialect,
    completionPreferences: input.completionPreferences || {
      keywordCase: "upper",
      tableAlias: "none",
    },
    fileSchemas: input.fileSchemas,
    fileDialects: input.fileDialects,
    schemaSignature: lspSchemaSignature(input.schemaDefinitions),
  });
}

function schemaForLspTab(tab: LspSyncTab, defaultSchema: string) {
  return (
    normalizeSchemaName(tab.targetSchema) ||
    normalizeSchemaName(tab.schemaName) ||
    defaultSchema
  );
}

function defaultCatalogName(connection: LspSyncConnection) {
  return connection.driver === "postgres"
    ? normalizeDatabaseName(connection.database)
    : null;
}

function catalogForLspTab(
  tab: LspSyncTab,
  defaultCatalog: LspCatalogTarget,
  connection: LspSyncConnection
): LspCatalogTarget {
  const databaseName = normalizeDatabaseName(tab.databaseName);
  return {
    catalogName:
      databaseName || defaultCatalog.catalogName || defaultCatalogName(connection),
    databaseName,
    schemaName: schemaForLspTab(tab, defaultCatalog.schemaName),
  };
}

export function lspCatalogKey(catalog: LspCatalogTarget) {
  return JSON.stringify([
    catalog.catalogName || "",
    catalog.schemaName.toLowerCase(),
  ]);
}

function findKnownSchemaName(schemaNames: string[], schemaName?: string | null) {
  const normalized = schemaName?.trim().toLowerCase();
  if (!normalized) return null;
  return (
    schemaNames.find((candidate) => candidate.toLowerCase() === normalized) ||
    null
  );
}

function normalizeSchemaName(schemaName: string | null | undefined) {
  const trimmed = schemaName?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDatabaseName(databaseName: string | null | undefined) {
  const trimmed = databaseName?.trim();
  return trimmed ? trimmed : null;
}

function addPreferredTable(
  preferredTablesBySchema: Map<string, Set<string>>,
  schemaName: string | null,
  tableName: string | null | undefined
) {
  const schema = schemaName?.trim();
  const table = tableName?.trim();
  if (!schema || !table) return;

  const tables = preferredTablesBySchema.get(schema) || new Set<string>();
  tables.add(table);
  preferredTablesBySchema.set(schema, tables);
}
