import { useEffect, useRef } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useLspClient } from "@/hooks/useLspClient";
import {
  databaseService,
  schemaService,
  type CollectionInfo,
  type DatabaseCapabilities,
} from "@/services/tauri";
import {
  collectionToLspTableDefinition,
  emptyLspTableDetails,
  selectLspTablesForSchema,
  type LspFunctionDefinition,
  type LspSchemaDefinition,
  type LspTableDefinition,
} from "@/services/lsp/schemaConfig";
import {
  getCachedLspMetadata,
  type CachedLspMetadata,
} from "@/services/lsp/metadataCache";
import { dispatchLspConfiguration } from "@/services/lsp/configDispatch";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import {
  buildLspFileMappings,
  createLspSyncPlan,
} from "@/services/lsp/syncPlan";
import {
  cancelScheduledLspSync,
  scheduleDebouncedLspSync,
  type LspSyncTimer,
} from "@/services/lsp/syncScheduler";
import {
  defaultDatabaseCapabilities,
  normalizeLspDialect,
  supportsLspLanguageId,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import { v4 as uuidv4 } from "uuid";

const MAX_LSP_TABLES_PER_SCHEMA = 200;
const MAX_LSP_COLLECTIONS_PER_SCHEMA = 500;
const LSP_METADATA_CONCURRENCY = 8;
const LSP_METADATA_CACHE_TTL_MS = 60_000;

type CachedLspTableDefinition = CachedLspMetadata<LspTableDefinition>;

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
    const metadata = await loadTableMetadata({
      connectionId,
      driver: capabilities.driver,
      schema: namespace,
      table: collection.name,
      includeIndexes: capabilities.dataModel === "document",
      includeConstraints: false,
    });
    return collectionToLspTableDefinition(
      capabilities,
      collection,
      metadata.columns,
      metadata.indexes
    );
  } catch (error) {
    console.error(
      `[LSP] Failed to fetch object fields for ${namespace}.${collection.name}:`,
      error
    );
    return collectionToLspTableDefinition(capabilities, collection);
  }
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
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const {
    isReady,
    client: lspClient,
  } = useLspClient({
    connectionId: activeConnectionId,
    driver: activeConnection?.driver,
    enabled: Boolean(
      activeConnectionId &&
        activeConnection &&
        supportsLspLanguageId(activeConnection.driver)
    ),
  });

  // Track if we've already sent config for this connection+schema
  const lastConfigRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<LspSyncTimer | null>(null);
  const syncGenerationRef = useRef(0);
  const tableMetadataCacheRef = useRef<Map<string, CachedLspTableDefinition>>(
    new Map()
  );

  useEffect(() => {
    tableMetadataCacheRef.current.clear();
    lastConfigRef.current = null;
  }, [activeConnectionId, metadataVersion]);

  useEffect(() => {
    cancelScheduledLspSync(debounceTimerRef);

    if (!isReady || !activeConnectionId) return;

    const connection = activeConnection;
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

    const syncPlan = createLspSyncPlan({
      activeConnectionId,
      connection,
      schemas,
      currentSchema,
      tabs,
    });
    if (!syncPlan) return;

    const {
      defaultSchema,
      queryTabs,
      schemaByTabId,
      targetSchemas,
      preferredTablesBySchema,
    } = syncPlan;

    const syncGeneration = syncGenerationRef.current + 1;
    syncGenerationRef.current = syncGeneration;
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
        const metadata = await loadTableMetadata({
          connectionId: activeConnectionId,
          driver: connection.driver,
          schema: schemaName,
          table: table.name,
          includeIndexes: capabilities.supportsTableIndexes,
          includeConstraints: capabilities.supportsTableConstraints,
        });
        const { columns, indexes, constraints } = metadata;

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
      const cacheKey = `${activeConnectionId}:${connection.driver}:${schemaName}:${table.name}`;
      return getCachedLspMetadata(
        tableMetadataCacheRef.current,
        cacheKey,
        LSP_METADATA_CACHE_TTL_MS,
        () => buildTableDefinition(schemaName, table)
      );
    };

    const scheduledSync = scheduleDebouncedLspSync({
      timerRef: debounceTimerRef,
      delayMs: 500,
      generation: syncGeneration,
      run: ({ isCancelled }) => {
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
          const { fileSchemas, fileDialects } = buildLspFileMappings({
            queryTabs,
            schemaByTabId,
            defaultSchema,
            driver: connection.driver,
            lspDialect,
            getSchemaId,
          });
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
              const lspObjects = canSyncTableMetadata
                ? lspTables
                : lspCollections;
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
            const dispatchResult = await dispatchLspConfiguration({
              connectionId: activeConnectionId,
              driver: connection.driver,
              lspDialect,
              config,
              lastConfigKey: lastConfigRef.current,
              syncGeneration,
              getCurrentGeneration: () => syncGenerationRef.current,
              isCancelled,
              updateConfiguration: (nextConfig) =>
                lspClient.updateConfiguration(nextConfig),
            });

            if (dispatchResult.status === "stale") {
              console.log("[LSP] Skipping stale schema configuration");
              return;
            }

            if (dispatchResult.status === "duplicate") {
              console.log("[LSP] Skipping duplicate configuration send");
              return;
            }

            if (dispatchResult.status === "sent-stale") {
              console.log(
                "[LSP] Configuration sent, but not cached because a newer sync started"
              );
              return;
            }

            lastConfigRef.current = dispatchResult.lastConfigKey;
            console.log("[LSP] ✅ Configuration sent and cached");
          } catch (err) {
            console.error("[LSP] Failed to sync schema:", err);
          }
        };

        void buildTableDefinitions();
      },
    });

    return scheduledSync.cleanup;
  }, [
    activeConnectionId,
    activeConnection,
    connections,
    tabs,
    isReady,
    lspClient,
    schemas,
    tables,
    currentSchema,
    metadataVersion,
  ]);

  return null;
}
