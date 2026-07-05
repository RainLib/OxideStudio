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
  targetSchema?: string | null;
  schemaName?: string | null;
  tableName?: string | null;
  sql?: string | null;
};

export type LspSyncPlan = {
  defaultSchema: string;
  connectionTabs: LspSyncTab[];
  queryTabs: LspSyncTab[];
  targetSchemas: string[];
  preferredTablesBySchema: Map<string, Set<string>>;
  schemaByTabId: Record<string, string>;
};

export type LspFileMappings = {
  fileSchemas: Record<string, string>;
  fileDialects: Record<string, string>;
};

export type LspConfigKeyInput = LspFileMappings & {
  connectionId: string;
  driver: DatabaseDriver;
  lspDialect: string;
  schemaDefinitions: LspSchemaDefinition[];
};

export function createLspSyncPlan(options: {
  activeConnectionId: string;
  connection: LspSyncConnection;
  schemas: string[];
  currentSchema?: string | null;
  tabs: LspSyncTab[];
}): LspSyncPlan | null {
  const { activeConnectionId, connection, schemas, currentSchema, tabs } = options;
  const defaultSchema = selectPreferredNamespace(connection.driver, schemas, [
    currentSchema,
    connection.database,
  ]);
  if (!defaultSchema) return null;

  const connectionTabs = tabs.filter(
    (tab) => (tab.connectionId || activeConnectionId) === activeConnectionId
  );
  const queryTabs = connectionTabs.filter((tab) => tab.type === "query");
  const preferredTablesBySchema = new Map<string, Set<string>>();
  const referencedSchemas = new Set<string>();
  const schemaByTabId: Record<string, string> = {};

  for (const tab of queryTabs) {
    schemaByTabId[tab.id] = schemaForLspTab(tab, defaultSchema);
  }

  for (const tab of connectionTabs) {
    addPreferredTable(
      preferredTablesBySchema,
      normalizeSchemaName(tab.schemaName) ||
        normalizeSchemaName(tab.targetSchema) ||
        defaultSchema,
      tab.tableName
    );
  }

  for (const tab of queryTabs) {
    const tabSchema = schemaByTabId[tab.id] || defaultSchema;
    for (const reference of extractRelationReferences(
      tab.sql || "",
      connection.driver
    )) {
      const qualifiedSchema = findKnownSchemaName(schemas, reference.schema);
      const schemaName = qualifiedSchema || tabSchema;
      referencedSchemas.add(schemaName);
      addPreferredTable(preferredTablesBySchema, schemaName, reference.table);
    }
  }

  const targetSchemas = Array.from(
    new Set(
      [
        defaultSchema,
        ...referencedSchemas,
        ...connectionTabs.flatMap((tab) => [
          tab.targetSchema || null,
          tab.schemaName || null,
        ]),
      ]
        .map(normalizeSchemaName)
        .filter((schemaName): schemaName is string => Boolean(schemaName))
    )
  );

  return {
    defaultSchema,
    connectionTabs,
    queryTabs,
    targetSchemas,
    preferredTablesBySchema,
    schemaByTabId,
  };
}

export function buildLspFileMappings(options: {
  queryTabs: LspSyncTab[];
  schemaByTabId: Record<string, string>;
  defaultSchema: string;
  driver: DatabaseDriver;
  lspDialect: string;
  getSchemaId: (schemaName: string) => string;
}): LspFileMappings {
  const {
    queryTabs,
    schemaByTabId,
    defaultSchema,
    driver,
    lspDialect,
    getSchemaId,
  } = options;

  const fileSchemas = Object.fromEntries(
    queryTabs.map((tab) => {
      const schemaName = schemaByTabId[tab.id] || schemaForLspTab(tab, defaultSchema);
      return [
        getLspDocumentUri(tab.id, driver, lspDialect),
        getSchemaId(schemaName),
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
    fileSchemas: input.fileSchemas,
    fileDialects: input.fileDialects,
    schemaSignature: lspSchemaSignature(input.schemaDefinitions),
  });
}

function schemaForLspTab(tab: LspSyncTab, defaultSchema: string) {
  return normalizeSchemaName(tab.targetSchema) || defaultSchema;
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
