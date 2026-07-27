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
  assignLspObjectSourceLocations,
  collectionToLspTableDefinition,
  emptyLspTableDetails,
  selectLspTablesForSchema,
  type LspFunctionDefinition,
  type LspSchemaDefinition,
  type LspTableDefinition,
} from "@/services/lsp/schemaConfig";
import { getLspDatabaseObjectUri } from "@/services/lsp/objectUri";
import {
  getCachedLspMetadata,
  type CachedLspMetadata,
} from "@/services/lsp/metadataCache";
import { dispatchLspConfiguration } from "@/services/lsp/configDispatch";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import {
  buildLspFileMappings,
  createLspSyncPlan,
  lspCatalogKey,
  type LspCatalogTarget,
} from "@/services/lsp/syncPlan";
import {
  DEFAULT_LSP_METADATA_BATCHING,
  loadLspMetadataInBatches,
} from "@/services/lsp/schemaBatching";
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

const LSP_METADATA_CACHE_TTL_MS = 60_000;
const LSP_PROGRESS_PUBLISH_INTERVAL_MS = 1_000;
const LSP_PROGRESS_PUBLISH_BATCHES = 8;

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

export function LspConnectionSyncer() {
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId
  );
  const connections = useConnectionStore((state) => state.connections);
  const schemas = useSchemaStore((state) => state.schemas);
  const tables = useSchemaStore((state) => state.tables);
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const metadataVersion = useSchemaStore((state) => state.metadataVersion);
  const tabs = useTabStore((state) => state.tabs);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const supportsMetadataSync = Boolean(activeConnection);
  const hasConnectionQueryTab = tabs.some(
    (tab) =>
      tab.type === "query" &&
      (tab.connectionId || activeConnectionId) === activeConnectionId
  );
  const {
    isReady,
    client: lspClient,
  } = useLspClient({
    connectionId: activeConnectionId,
    driver: activeConnection?.driver,
    enabled: Boolean(
      activeConnectionId &&
        activeConnection &&
        supportsMetadataSync &&
        hasConnectionQueryTab &&
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

    if (!supportsMetadataSync) {
      lastConfigRef.current = null;
      return;
    }

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
      activeTabId,
      tabs,
    });
    if (!syncPlan) return;

    const {
      defaultSchema,
      defaultCatalog,
      queryTabs,
      schemaByTabId,
      catalogByTabId,
      targetCatalogs,
      preferredTablesByCatalog,
    } = syncPlan;

    // Do not introspect a newly selected data source solely for LSP setup.
    // Once a query tab actually targets it, the dependency change schedules a
    // bounded sync. This keeps connection selection itself lightweight.
    if (queryTabs.length === 0) {
      lastConfigRef.current = null;
      return;
    }

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

    const getSchemaId = (
      schemaName: string,
      catalogName: string | null = null
    ) => {
      const schemaKey = `oxide-lsp-schema-id:v2:${encodeURIComponent(
        JSON.stringify([
          activeConnectionId,
          connection.driver,
          catalogName || "",
          schemaName,
        ])
      )}`;
      let schemaId = localStorage.getItem(schemaKey);
      if (!schemaId) {
        schemaId = uuidv4();
        localStorage.setItem(schemaKey, schemaId);
      }
      return schemaId;
    };

    const objectSourceUri = (
      catalog: LspCatalogTarget,
      objectName?: string | null,
      objectType?: string | null,
      columnName?: string | null
    ) =>
      getLspDatabaseObjectUri({
        connectionId: activeConnectionId,
        databaseName: catalog.databaseName,
        schemaName: catalog.schemaName,
        objectName,
        objectType,
        columnName,
      });

    const assignSourceLocations = (
      catalog: LspCatalogTarget,
      definition: LspTableDefinition
    ) =>
      assignLspObjectSourceLocations(definition, {
        tableUri: objectSourceUri(
          catalog,
          definition.name,
          definition.object_type
        ),
        columnUri: (columnName) =>
          objectSourceUri(
            catalog,
            definition.name,
            definition.object_type,
            columnName
          ),
      });

    const buildTableDefinition = async (
      catalog: LspCatalogTarget,
      table: { name: string; type?: string | null; comment?: string | null }
    ): Promise<LspTableDefinition> => {
      try {
        const capabilities = await capabilitiesPromise;
        const metadata = await loadTableMetadata({
          connectionId: activeConnectionId,
          driver: connection.driver,
          databaseName: catalog.databaseName || undefined,
          schema: catalog.schemaName,
          table: table.name,
          includeIndexes: capabilities.supportsTableIndexes,
          includeConstraints: capabilities.supportsTableConstraints,
        });
        const { columns, indexes, constraints } = metadata;

        return assignSourceLocations(catalog, {
          name: table.name,
          object_type: table.type || null,
          comment: table.comment || null,
          ...emptyLspTableDetails(
            [
              objectSourceUri(catalog, table.name, table.type || null),
              1,
            ]
          ),
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
            default_value: col.default_value ?? null,
            auto_increment: !!col.is_auto_increment,
            comment: col.comment || null,
            source_location: [
              objectSourceUri(
                catalog,
                table.name,
                table.type || null,
                col.name
              ),
              1,
            ],
          })),
        });
      } catch (error) {
        console.error(
          `[LSP] Failed to fetch metadata for ${[
            catalog.catalogName,
            catalog.schemaName,
            table.name,
          ]
            .filter(Boolean)
            .join(".")}:`,
          error
        );
        return assignSourceLocations(catalog, {
          name: table.name,
          object_type: table.type || null,
          comment: table.comment || null,
          ...emptyLspTableDetails(
            [
              objectSourceUri(catalog, table.name, table.type || null),
              1,
            ]
          ),
          columns: [],
        });
      }
    };

    const getCachedTableDefinition = (
      catalog: LspCatalogTarget,
      table: { name: string; type?: string | null; comment?: string | null }
    ) => {
      const cacheKey = `${activeConnectionId}:${connection.driver}:${lspCatalogKey(
        catalog
      )}:${table.name}`;
      return getCachedLspMetadata(
        tableMetadataCacheRef.current,
        cacheKey,
        LSP_METADATA_CACHE_TTL_MS,
        () => buildTableDefinition(catalog, table)
      );
    };

    const scheduledSync = scheduleDebouncedLspSync({
      timerRef: debounceTimerRef,
      delayMs: 500,
      generation: syncGeneration,
      run: ({ isCancelled }) => {
        console.log("[LSP] Building schema configuration for:", connection.name);
        console.log(
          "[LSP] Target catalogs:",
          targetCatalogs
            .map((catalog) =>
              [catalog.catalogName, catalog.schemaName].filter(Boolean).join(".")
            )
            .join(", ")
        );

        // Build tables array with columns
        // tables is an ARRAY: TableInfo[]
        const buildTableDefinitions = async () => {
          const capabilities = await capabilitiesPromise;
          const isStale = () =>
            isCancelled() || syncGenerationRef.current !== syncGeneration;
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
            catalogByTabId,
            defaultSchema,
            defaultCatalog,
            driver: connection.driver,
            lspDialect,
            getSchemaId,
          });
          const catalogs = await Promise.all(
            targetCatalogs.map(async (catalog) => {
              const { databaseName, schemaName } = catalog;
              const [schemaTables, schemaCollections, schemaFunctions] =
                await Promise.all([
                  canSyncTableMetadata
                    ? (databaseName
                        ? schemaService.getDatabaseTables(
                            activeConnectionId,
                            databaseName,
                            schemaName
                          )
                        : schemaService.getTables(activeConnectionId, schemaName))
                        .catch((error) => {
                          console.error(
                            `[LSP] Failed to fetch tables for ${schemaName}:`,
                            error
                          );
                          return [];
                        })
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
                    ? (databaseName
                        ? schemaService.getDatabaseFunctions(
                            activeConnectionId,
                            databaseName,
                            schemaName
                          )
                        : schemaService.getFunctions(activeConnectionId, schemaName))
                        .catch((error) => {
                          console.error(
                            `[LSP] Failed to fetch functions for ${schemaName}:`,
                            error
                          );
                          return [];
                        })
                    : Promise.resolve([]),
                ]);
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

              return {
                ...catalog,
                tables: selectLspTablesForSchema(
                  schemaTables,
                  preferredTablesByCatalog.get(lspCatalogKey(catalog))
                ),
                collections: selectLspTablesForSchema(
                  schemaCollections,
                  preferredTablesByCatalog.get(lspCatalogKey(catalog))
                ),
                functions: lspFunctions,
              };
            })
          );

          if (isStale()) {
            console.log("[LSP] Cancelled stale metadata sync");
            return;
          }

          const schemaDefinitions: LspSchemaDefinition[] = catalogs.map(
            (catalog) => ({
              id: getSchemaId(catalog.schemaName, catalog.catalogName),
              catalog: catalog.catalogName,
              database: catalog.schemaName,
              source_uri: objectSourceUri(catalog),
              tables: canSyncTableMetadata
                ? catalog.tables.map((table) =>
                    assignSourceLocations(catalog, {
                      name: table.name,
                      object_type: table.type || null,
                      comment: table.comment || null,
                      ...emptyLspTableDetails(
                        [
                          objectSourceUri(
                            catalog,
                            table.name,
                            table.type || null
                          ),
                          1,
                        ]
                      ),
                      columns: [],
                    })
                  )
                : catalog.collections.map((collection) =>
                    assignSourceLocations(
                      catalog,
                      collectionToLspTableDefinition(capabilities, collection)
                    )
                  ),
              functions: catalog.functions,
            })
          );
          const metadataWork: Array<{
            schemaIndex: number;
            objectIndex: number;
            load: () => Promise<LspTableDefinition>;
          }> = [];

          catalogs.forEach((catalog, schemaIndex) => {
            if (canSyncTableMetadata) {
              catalog.tables.forEach((table, objectIndex) => {
                metadataWork.push({
                  schemaIndex,
                  objectIndex,
                  load: () =>
                    getCachedTableDefinition(catalog, table),
                });
              });
              return;
            }

            if (
              capabilities.dataModel !== "document" &&
              capabilities.dataModel !== "search"
            ) {
              return;
            }

            catalog.collections.forEach((collection, objectIndex) => {
              metadataWork.push({
                schemaIndex,
                objectIndex,
                load: () =>
                  collectionToLspTableDefinitionWithMetadata(
                    activeConnectionId,
                    catalog.schemaName,
                    capabilities,
                    collection
                  ).then((definition) =>
                    assignSourceLocations(catalog, definition)
                  ),
              });
            });
          });

          console.log(
            `[LSP] Loading complete metadata for ${metadataWork.length} objects in batches of ${DEFAULT_LSP_METADATA_BATCHING.batchSize}`
          );
          const publishConfiguration = async () => {
            try {
              const dispatchResult = await dispatchLspConfiguration({
                connectionId: activeConnectionId,
                driver: connection.driver,
                lspDialect,
                config: {
                  defaultDialect: lspDialect,
                  schemas: schemaDefinitions.map((schema) => ({
                    ...schema,
                    tables: [...schema.tables],
                    functions: [...schema.functions],
                  })),
                  fileSchemas,
                  fileDialects,
                },
                lastConfigKey: lastConfigRef.current,
                syncGeneration,
                getCurrentGeneration: () => syncGenerationRef.current,
                isCancelled: isStale,
                updateConfiguration: (nextConfig) =>
                  lspClient.updateConfiguration(nextConfig),
              });

              if (dispatchResult.status === "sent") {
                lastConfigRef.current = dispatchResult.lastConfigKey;
              }
              return (
                dispatchResult.status !== "stale" &&
                dispatchResult.status !== "sent-stale"
              );
            } catch (error) {
              console.error("[LSP] Failed to sync schema:", error);
              return !isStale();
            }
          };

          // Publish every object and routine name before slower per-object
          // enrichment starts. No catalog entry is omitted from this payload.
          if (
            metadataWork.length > DEFAULT_LSP_METADATA_BATCHING.batchSize &&
            !(await publishConfiguration())
          ) {
            return;
          }

          let lastPublishedAt = Date.now();
          let batchesSincePublish = 0;
          const batchResult = await loadLspMetadataInBatches({
            items: metadataWork,
            batchSize: DEFAULT_LSP_METADATA_BATCHING.batchSize,
            concurrency: DEFAULT_LSP_METADATA_BATCHING.concurrency,
            isCancelled: isStale,
            load: (work) => work.load(),
            onBatch: async (definitions, startIndex) => {
              definitions.forEach((definition, resultIndex) => {
                const work = metadataWork[startIndex + resultIndex]!;
                schemaDefinitions[work.schemaIndex]!.tables[
                  work.objectIndex
                ] = definition;
              });

              batchesSincePublish += 1;
              const now = Date.now();
              if (
                now - lastPublishedAt >= LSP_PROGRESS_PUBLISH_INTERVAL_MS ||
                batchesSincePublish >= LSP_PROGRESS_PUBLISH_BATCHES
              ) {
                await publishConfiguration();
                lastPublishedAt = Date.now();
                batchesSincePublish = 0;
              }
            },
          });

          if (batchResult.status === "cancelled" || isStale()) {
            console.log(
              `[LSP] Cancelled stale metadata sync after ${batchResult.processed}/${batchResult.total} objects`
            );
            return;
          }

          // Build configuration matching Python script format
          const config = {
            defaultDialect: lspDialect,
            schemas: schemaDefinitions,
            // Map document URIs to schema ID
            fileSchemas,
            fileDialects,
          };

          console.log("[LSP] Sending schema configuration:");
          console.log(
            "[LSP] - Catalogs:",
            targetCatalogs
              .map((catalog) =>
                [catalog.catalogName, catalog.schemaName]
                  .filter(Boolean)
                  .join(".")
              )
              .join(", ")
          );
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
              isCancelled: isStale,
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
    activeTabId,
    isReady,
    lspClient,
    schemas,
    tables,
    currentSchema,
    metadataVersion,
    supportsMetadataSync,
  ]);

  return null;
}
