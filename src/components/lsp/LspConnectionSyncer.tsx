import { useEffect, useRef } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useLspClient } from "@/hooks/useLspClient";
import { getLspDocumentUri, lspClient } from "@/services/lsp";
import {
  databaseService,
  schemaService,
  type ColumnInfo,
  type CollectionInfo,
  type DatabaseCapabilities,
  type IndexInfo,
} from "@/services/tauri";
import {
  defaultDatabaseCapabilities,
  normalizeLspDialect,
  selectPreferredNamespace,
  supportsLspLanguageId,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import { extractRelationReferences } from "@/lib/sqlAnalysis";
import { v4 as uuidv4 } from "uuid";

const MAX_LSP_TABLES_PER_SCHEMA = 200;
const MAX_LSP_COLLECTIONS_PER_SCHEMA = 500;
const LSP_METADATA_CONCURRENCY = 8;
const LSP_METADATA_CACHE_TTL_MS = 60_000;

type LspTableDefinition = {
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

type CachedLspTableDefinition = {
  expiresAt: number;
  promise: Promise<LspTableDefinition>;
};

type LspFunctionDefinition = {
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

type LspSchemaDefinition = {
  id: string;
  database: string;
  source_uri: null;
  tables: LspTableDefinition[];
  functions: LspFunctionDefinition[];
};

function emptyLspTableDetails(): Pick<
  LspTableDefinition,
  "source_location" | "indexes" | "constraints"
> {
  return {
    source_location: null,
    indexes: [],
    constraints: [],
  };
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

function collectionToLspTableDefinition(
  capabilities: DatabaseCapabilities,
  collection: CollectionInfo,
  columns: ColumnInfo[] = [],
  indexes: IndexInfo[] = []
): LspTableDefinition {
  const objectType = collection.type || capabilities.dataModel;
  const countLabel =
    typeof collection.documentCount === "number"
      ? `${collection.documentCount} document(s)`
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
      return columns.map((column) => ({
        name: column.name,
        data_type: column.data_type || "json",
        nullable: column.is_nullable,
        primary_key: column.is_primary_key,
        unique: column.is_unique ?? false,
        indexed: column.is_indexed ?? false,
        comment: column.comment || null,
        source_location: null,
      }));
    }

    return [
      lspColumn("id", "keyword", "Document id"),
      lspColumn("score", "double", "Search score"),
      lspColumn("source", "object", "Document source"),
    ];
  }

  if (capabilities.dataModel === "document") {
    if (columns.length > 0) {
      return columns.map((column) => ({
        name: column.name,
        data_type: column.data_type || "json",
        nullable: column.is_nullable,
        primary_key: column.is_primary_key,
        unique: column.is_unique ?? false,
        indexed: column.is_indexed ?? false,
        comment: column.comment || null,
        source_location: null,
      }));
    }

    return [
      lspColumn("_id", "objectId", "Document id"),
      lspColumn("document", "object", "Document body"),
    ];
  }

  return [lspColumn("value", "json", "Object value")];
}

async function collectionToLspTableDefinitionWithMetadata(
  connectionId: string,
  namespace: string,
  capabilities: DatabaseCapabilities,
  collection: CollectionInfo
): Promise<LspTableDefinition> {
  if (
    capabilities.dataModel !== "document" &&
    capabilities.dataModel !== "search"
  ) {
    return collectionToLspTableDefinition(capabilities, collection);
  }

  try {
    const [columns, indexes] = await Promise.all([
      schemaService.getColumns(connectionId, namespace, collection.name),
      capabilities.dataModel === "document"
        ? schemaService
            .getIndexes(connectionId, namespace, collection.name)
            .catch((error) => {
              console.error(
                `[LSP] Failed to fetch indexes for ${namespace}.${collection.name}:`,
                error
              );
              return [];
            })
        : Promise.resolve([]),
    ]);
    return collectionToLspTableDefinition(
      capabilities,
      collection,
      columns,
      indexes
    );
  } catch (error) {
    console.error(
      `[LSP] Failed to fetch object fields for ${namespace}.${collection.name}:`,
      error
    );
    return collectionToLspTableDefinition(capabilities, collection);
  }
}

function findKnownSchemaName(schemaNames: string[], schemaName?: string | null) {
  const normalized = schemaName?.trim().toLowerCase();
  if (!normalized) return null;
  return (
    schemaNames.find((candidate) => candidate.toLowerCase() === normalized) ||
    null
  );
}

function lspSchemaSignature(schemaDefinitions: LspSchemaDefinition[]) {
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

function selectLspTablesForSchema<T extends { name: string }>(
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

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex]!);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

export function LspConnectionSyncer() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { schemas, tables, currentSchema, metadataVersion } = useSchemaStore();
  const { tabs } = useTabStore();
  const { isReady } = useLspClient();

  // Track if we've already sent config for this connection+schema
  const lastConfigRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const syncGenerationRef = useRef(0);
  const tableMetadataCacheRef = useRef<Map<string, CachedLspTableDefinition>>(
    new Map()
  );

  useEffect(() => {
    tableMetadataCacheRef.current.clear();
    lastConfigRef.current = null;
  }, [activeConnectionId, metadataVersion]);

  useEffect(() => {
    // Clear any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!isReady || !activeConnectionId) return;

    const connection = connections.find((c) => c.id === activeConnectionId);
    if (!connection) return;

    if (!supportsLspLanguageId(connection.driver)) {
      lastConfigRef.current = null;
      console.log(`[LSP] Skipping unsupported driver: ${connection.driver}`);
      return;
    }

    // Wait for schemas to be loaded
    if (!schemas || schemas.length === 0) {
      console.log("[LSP] Waiting for schemas to load...");
      return;
    }

    const defaultSchema = selectPreferredNamespace(connection.driver, schemas, [
      currentSchema,
      connection.database,
    ]);
    if (!defaultSchema) return;

    const syncGeneration = syncGenerationRef.current + 1;
    syncGenerationRef.current = syncGeneration;
    let cancelled = false;
    const capabilitiesPromise: Promise<DatabaseCapabilities> = databaseService
      .getDatabaseCapabilities(connection.driver)
      .catch((error) => {
        console.warn(
          `[LSP] Failed to load capabilities for ${connection.driver}:`,
          error
        );
        return defaultDatabaseCapabilities(connection.driver);
      });

    const getSchemaId = (schemaName: string) => {
      const schemaKey = `oxide-lsp-schema-id:${activeConnectionId}:${connection.driver}:${schemaName}`;
      let schemaId = localStorage.getItem(schemaKey);
      if (!schemaId) {
        schemaId = uuidv4();
        localStorage.setItem(schemaKey, schemaId);
      }
      return schemaId;
    };

    const buildTableDefinition = async (
      schemaName: string,
      table: { name: string; type?: string | null; comment?: string | null }
    ): Promise<LspTableDefinition> => {
      try {
        const capabilities = await capabilitiesPromise;
        const [columns, indexes, constraints] = await Promise.all([
          schemaService
            .getColumns(activeConnectionId, schemaName, table.name)
            .catch((error) => {
              console.error(
                `[LSP] Failed to fetch columns for ${schemaName}.${table.name}:`,
                error
              );
              return [];
            }),
          capabilities.supportsTableIndexes
            ? schemaService
                .getIndexes(activeConnectionId, schemaName, table.name)
                .catch((error) => {
                  console.error(
                    `[LSP] Failed to fetch indexes for ${schemaName}.${table.name}:`,
                    error
                  );
                  return [];
                })
            : Promise.resolve([]),
          capabilities.supportsTableConstraints
            ? schemaService
                .getConstraints(activeConnectionId, schemaName, table.name)
                .catch((error) => {
                  console.error(
                    `[LSP] Failed to fetch constraints for ${schemaName}.${table.name}:`,
                    error
                  );
                  return [];
                })
            : Promise.resolve([]),
        ]);

        return {
          name: table.name,
          object_type: table.type || null,
          comment: table.comment || null,
          ...emptyLspTableDetails(),
          indexes: indexes.map((index) => ({
            name: index.name,
            columns: index.columns || [],
            is_unique: index.is_unique,
            is_primary: index.is_primary,
            index_type: index.index_type || null,
            definition: index.definition || null,
          })),
          constraints: constraints.map((constraint) => ({
            name: constraint.name,
            constraint_type: constraint.constraint_type,
            columns: constraint.columns || [],
            referenced_schema: constraint.referenced_schema || null,
            referenced_table: constraint.referenced_table || null,
            referenced_columns: constraint.referenced_columns || [],
            definition: constraint.definition || null,
          })),
          columns: columns.map((col) => ({
            name: col.name,
            data_type: col.data_type || "VARCHAR",
            nullable: col.is_nullable,
            primary_key: !!col.is_primary_key,
            unique: !!col.is_unique,
            indexed: !!col.is_indexed,
            comment: col.comment || null,
            source_location: null,
          })),
        };
      } catch (error) {
        console.error(
          `[LSP] Failed to fetch metadata for ${schemaName}.${table.name}:`,
          error
        );
        return {
          name: table.name,
          object_type: table.type || null,
          comment: table.comment || null,
          ...emptyLspTableDetails(),
          columns: [],
        };
      }
    };

    const getCachedTableDefinition = (
      schemaName: string,
      table: { name: string; type?: string | null; comment?: string | null }
    ) => {
      const now = Date.now();
      const cache = tableMetadataCacheRef.current;
      const cacheKey = `${activeConnectionId}:${connection.driver}:${schemaName}:${table.name}`;

      for (const [key, cached] of cache) {
        if (cached.expiresAt <= now) {
          cache.delete(key);
        }
      }

      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.promise;
      }

      const promise = buildTableDefinition(schemaName, table);
      cache.set(cacheKey, {
        expiresAt: now + LSP_METADATA_CACHE_TTL_MS,
        promise,
      });
      return promise;
    };

    const connectionTabs = tabs.filter(
      (tab) => (tab.connectionId || activeConnectionId) === activeConnectionId
    );
    const queryTabs = connectionTabs.filter((tab) => tab.type === "query");
    const schemaForTab = (tab: (typeof queryTabs)[number]) =>
      tab.targetSchema || defaultSchema;
    const normalizeSchemaName = (schemaName: string | null | undefined) => {
      const trimmed = schemaName?.trim();
      return trimmed ? trimmed : null;
    };
    const preferredTablesBySchema = new Map<string, Set<string>>();
    const referencedSchemas = new Set<string>();

    for (const tab of connectionTabs) {
      addPreferredTable(
        preferredTablesBySchema,
        normalizeSchemaName(tab.schemaName || tab.targetSchema || defaultSchema),
        tab.tableName
      );
    }

    for (const tab of queryTabs) {
      const tabSchema = normalizeSchemaName(schemaForTab(tab)) || defaultSchema;
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

    // Debounce: wait 500ms before sending
    debounceTimerRef.current = setTimeout(() => {
      console.log("[LSP] Building schema configuration for:", connection.name);
      console.log("[LSP] Target schemas:", targetSchemas.join(", "));

      // Build tables array with columns
      // tables is an ARRAY: TableInfo[]
      const buildTableDefinitions = async () => {
        const capabilities = await capabilitiesPromise;
        const canSyncTableMetadata = supportsTableWorkspace(capabilities);
        const canSyncCollectionMetadata =
          !canSyncTableMetadata &&
          (capabilities.supportsCollectionBrowsing ||
            capabilities.supportsKeyValueBrowsing);
        const lspDialect = normalizeLspDialect(
          capabilities.lspLanguageId || connection.driver
        );
        const fileSchemas = Object.fromEntries(
          queryTabs.map((tab) => [
            getLspDocumentUri(tab.id, connection.driver, lspDialect),
            getSchemaId(schemaForTab(tab)),
          ])
        );
        const fileDialects = Object.fromEntries(
          queryTabs.map((tab) => [
            getLspDocumentUri(tab.id, connection.driver, lspDialect),
            lspDialect,
          ])
        );
        const schemaDefinitions: LspSchemaDefinition[] = await Promise.all(
          targetSchemas.map(async (schemaName) => {
            const [schemaTables, schemaCollections, schemaFunctions] =
              await Promise.all([
                canSyncTableMetadata
                  ? schemaService.getTables(activeConnectionId, schemaName)
                  : Promise.resolve([]),
                canSyncCollectionMetadata
                  ? schemaService
                      .getCollections(activeConnectionId, schemaName)
                      .catch((error) => {
                        console.error(
                          `[LSP] Failed to fetch objects for ${schemaName}:`,
                          error
                        );
                        return [];
                      })
                  : Promise.resolve([]),
                canSyncTableMetadata && capabilities.supportsFunctions
                  ? schemaService
                      .getFunctions(activeConnectionId, schemaName)
                      .catch((error) => {
                        console.error(
                          `[LSP] Failed to fetch functions for ${schemaName}:`,
                          error
                        );
                        return [];
                      })
                  : Promise.resolve([]),
              ]);
            const boundedTables = selectLspTablesForSchema(
              schemaTables,
              preferredTablesBySchema.get(schemaName),
              MAX_LSP_TABLES_PER_SCHEMA
            );
            const lspTables = await mapWithConcurrency(
              boundedTables,
              LSP_METADATA_CONCURRENCY,
              async (table) => getCachedTableDefinition(schemaName, table)
            );
            const boundedCollections = schemaCollections.slice(
              0,
              MAX_LSP_COLLECTIONS_PER_SCHEMA
            );
            const lspCollections = await mapWithConcurrency(
              boundedCollections,
              LSP_METADATA_CONCURRENCY,
              async (collection) =>
                collectionToLspTableDefinitionWithMetadata(
                  activeConnectionId,
                  schemaName,
                  capabilities,
                  collection
                )
            );
            const lspObjects = canSyncTableMetadata ? lspTables : lspCollections;
            const lspFunctions: LspFunctionDefinition[] = schemaFunctions.map(
              (func) => ({
                name: func.name,
                routine_type: func.routine_type || null,
                parameters: (func.parameters || []).map((parameter) => ({
                  name: parameter.name,
                  data_type: parameter.data_type || "unknown",
                  optional: !!parameter.optional,
                })),
                return_type: func.return_type || "unknown",
                description: func.description || null,
              })
            );
            console.log(
              canSyncTableMetadata
                ? `[LSP] Built ${lspTables.length}/${schemaTables.length} tables and ${lspFunctions.length} functions for ${schemaName}`
                : `[LSP] Built ${lspCollections.length}/${schemaCollections.length} objects for ${schemaName}`
            );

            return {
              id: getSchemaId(schemaName),
              database: schemaName,
              source_uri: null,
              tables: lspObjects,
              functions: lspFunctions,
            };
          })
        );

        // Build configuration matching Python script format
        const config = {
          defaultDialect: lspDialect,
          schemas: schemaDefinitions,
          // Map document URIs to schema ID
          fileSchemas,
          fileDialects,
        };

        console.log("[LSP] Sending schema configuration:");
        console.log("[LSP] - Schemas:", targetSchemas.join(", "));
        console.log("[LSP] - Files:", Object.keys(fileSchemas).length);

        try {
          if (cancelled || syncGeneration !== syncGenerationRef.current) {
            console.log("[LSP] Skipping stale schema configuration");
            return;
          }

          const configKey = JSON.stringify({
            connectionId: activeConnectionId,
            driver: connection.driver,
            lspDialect,
            fileSchemas,
            fileDialects,
            schemaSignature: lspSchemaSignature(schemaDefinitions),
          });
          if (lastConfigRef.current === configKey) {
            console.log("[LSP] Skipping duplicate configuration send");
            return;
          }

          await lspClient.updateConfiguration(config);
          // Mark this configuration as sent
          lastConfigRef.current = configKey;
          console.log("[LSP] ✅ Configuration sent and cached");
        } catch (err) {
          console.error("[LSP] Failed to sync schema:", err);
        }
      };

      buildTableDefinitions();
    }, 500); // 500ms debounce

    // Cleanup function
    return () => {
      cancelled = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    activeConnectionId,
    connections,
    tabs,
    isReady,
    schemas,
    tables,
    currentSchema,
    metadataVersion,
  ]);

  return null;
}
