import { useEffect, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useLspSemanticStatusStore } from "@/store/useLspSemanticStatusStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useLspClient } from "@/hooks/useLspClient";
import {
  databaseService,
  projectFilesService,
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
import { usesOnDemandOnlyLspColumnMetadata } from "@/services/lsp/metadataPolicy";
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
import { getLspProjectDocumentUri } from "@/services/lsp/document";
import type { LspClient } from "@/services/lsp/client";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  lspLanguageIdForCapabilities,
  lspServerDialectForCapabilities,
  supportsLspCapabilities,
  supportsSqlRelationMetadataLsp,
} from "@/lib/databaseDialect";
import { v4 as uuidv4 } from "uuid";

const LSP_METADATA_CACHE_TTL_MS = 60_000;
const LSP_PROGRESS_PUBLISH_INTERVAL_MS = 1_000;
const LSP_PROGRESS_PUBLISH_BATCHES = 8;

type CachedLspTableDefinition = CachedLspMetadata<LspTableDefinition>;

type OpenProjectLspDocument = {
  client: LspClient;
  sessionKey: string;
  content: string;
  version: number;
};

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
  // A package activation can add a new LSP dialect/capability at runtime.
  // Subscribe so the normal sync effect publishes a fresh configuration.
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );
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
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProjectRoot = useProjectStore((state) =>
    state.projects.find((project) => project.id === state.activeProjectId)
      ?.root_path || null,
  );
  const projectDocuments = useProjectFilesStore((state) => state.documents);
  const projectFileOperations = useProjectFilesStore(
    (state) => state.pendingOperations,
  );
  const projectDocumentRevisionKey = useMemo(
    () =>
      `${projectFileOperations}:${Object.entries(projectDocuments)
        .map(([path, document]) => `${path}:${document.revision}`)
        .sort()
        .join("|")}`,
    [projectDocuments, projectFileOperations],
  );
  const keywordCase = useSettingsStore(
    (state) => state.settings.editor.sqlCompletion.keywordCase
  );
  const tableAlias = useSettingsStore(
    (state) => state.settings.editor.sqlCompletion.tableAlias
  );
  const completionPreferences = { keywordCase, tableAlias } as const;
  const setSemanticStatus = useLspSemanticStatusStore(
    (state) => state.setStatus,
  );
  const clearSemanticStatus = useLspSemanticStatusStore(
    (state) => state.clearStatus,
  );
  const recordSemanticTelemetry = useLspSemanticStatusStore(
    (state) => state.recordTelemetry,
  );
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const [resolvedCapabilityContext, setResolvedCapabilityContext] = useState<{
    connectionId: string;
    capabilities: DatabaseCapabilities;
    serverVersion: string | null;
  } | null>(null);
  useEffect(() => {
    if (!activeConnection) {
      setResolvedCapabilityContext(null);
      return;
    }
    let cancelled = false;
    setResolvedCapabilityContext(null);
    void databaseService
      .getConnectionDatabaseCapabilityContext(activeConnection.id)
      .then((context) => {
        if (!cancelled) {
          setResolvedCapabilityContext({
            connectionId: activeConnection.id,
            capabilities: context.capabilities,
            serverVersion: context.serverVersion || null,
          });
        }
      })
      .catch(async (error) => {
        console.warn(
          `[LSP] Failed to resolve live capability context for ${activeConnection.name}:`,
          error,
        );
        let capabilities: DatabaseCapabilities;
        try {
          capabilities = await databaseService.getDatabaseCapabilities(
            activeConnection.driver,
            activeConnection.driverPackageVersion,
          );
        } catch {
          capabilities = defaultDatabaseCapabilities(activeConnection.driver);
        }
        if (!cancelled) {
          setResolvedCapabilityContext({
            connectionId: activeConnection.id,
            capabilities,
            serverVersion: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeConnection?.driver,
    activeConnection?.driverPackageVersion,
    activeConnection?.id,
    driverCatalogStatus,
  ]);
  const lspCapabilities = useMemo<DatabaseCapabilities>(() => {
    const resolvedForActiveConnection =
      resolvedCapabilityContext &&
      activeConnection &&
      resolvedCapabilityContext.connectionId === activeConnection.id
        ? resolvedCapabilityContext.capabilities
        : null;
    if (resolvedForActiveConnection) {
      return resolvedForActiveConnection;
    }
    return defaultDatabaseCapabilities(
      activeConnection?.driver || DEFAULT_DATABASE_DRIVER,
    );
  }, [activeConnection?.driver, activeConnection?.id, resolvedCapabilityContext]);
  const supportsMetadataSync = Boolean(activeConnection);
  const hasConnectionLspTab = tabs.some(
    (tab) =>
      (tab.type === "query" || tab.type === "table") &&
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
        hasConnectionLspTab &&
        supportsLspCapabilities(lspCapabilities)
    ),
    capabilities: lspCapabilities,
  });

  // Track if we've already sent config for this connection+schema
  const lastConfigRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<LspSyncTimer | null>(null);
  const syncGenerationRef = useRef(0);
  const tableMetadataCacheRef = useRef<Map<string, CachedLspTableDefinition>>(
    new Map()
  );
  const openedProjectDocumentsRef = useRef<
    Map<string, OpenProjectLspDocument>
  >(new Map());

  useEffect(() => {
    tableMetadataCacheRef.current.clear();
    lastConfigRef.current = null;
  }, [activeConnectionId, metadataVersion]);

  useEffect(() => {
    return () => {
      for (const [uri, document] of openedProjectDocumentsRef.current) {
        void document.client.didClose(uri);
      }
      openedProjectDocumentsRef.current.clear();
    };
  }, []);

  // A project document is bound to the same connection-scoped semantic
  // configuration as a console. Do not let an old virtual SQL file survive
  // while that context is unavailable (for example after disconnecting,
  // removing the project root, or closing the last query tab). The normal
  // synchronization path handles content changes; this effect covers the
  // early-return paths before a full metadata sync can run.
  useEffect(() => {
    const canKeepProjectDocumentsOpen = Boolean(
      isReady &&
        activeConnectionId &&
        activeConnection &&
        activeProjectRoot &&
        hasConnectionLspTab &&
        supportsLspCapabilities(lspCapabilities),
    );
    if (canKeepProjectDocumentsOpen) return;

    const openedDocuments = Array.from(
      openedProjectDocumentsRef.current.entries(),
    );
    if (openedDocuments.length === 0) return;

    openedProjectDocumentsRef.current.clear();
    void Promise.allSettled(
      openedDocuments.map(([uri, document]) => document.client.didClose(uri)),
    );
  }, [
    activeConnection,
    activeConnectionId,
    activeProjectRoot,
    hasConnectionLspTab,
    isReady,
    lspCapabilities,
  ]);

  useEffect(() => {
    cancelScheduledLspSync(debounceTimerRef);

    if (!isReady || !activeConnectionId) return;

    const connection = activeConnection;
    if (!connection) return;

    if (!supportsMetadataSync) {
      lastConfigRef.current = null;
      clearSemanticStatus(activeConnectionId);
      return;
    }

    if (resolvedCapabilityContext?.connectionId !== activeConnectionId) {
      setSemanticStatus(activeConnectionId, {
        state: "syncing",
        totalObjects: 0,
        cacheHits: 0,
        cacheMisses: 0,
        failedObjects: 0,
        message: "Resolving the live driver package and server capability contract.",
      });
      return;
    }

    if (!supportsLspCapabilities(lspCapabilities)) {
      lastConfigRef.current = null;
      clearSemanticStatus(activeConnectionId);
      console.log(`[LSP] Skipping unsupported driver: ${connection.driver}`);
      return;
    }

    // Wait for schemas to be loaded
    if (!schemas || schemas.length === 0) {
      setSemanticStatus(activeConnectionId, {
        state: "syncing",
        totalObjects: 0,
        cacheHits: 0,
        cacheMisses: 0,
        failedObjects: 0,
        message: "Waiting for the database schema before semantic completion can be synchronized.",
      });
      console.log("[LSP] Waiting for schemas to load...");
      return;
    }

    const syncPlan = createLspSyncPlan({
      activeConnectionId,
      connection: {
        ...connection,
        supportsDatabaseCatalogs: lspCapabilities.supportsDatabaseCatalogs,
      },
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
      clearSemanticStatus(activeConnectionId);
      return;
    }

    const syncGeneration = syncGenerationRef.current + 1;
    syncGenerationRef.current = syncGeneration;
    const metadataStats = {
      cacheHits: 0,
      cacheMisses: 0,
      failedObjects: 0,
    };
    const recordMetadataCacheStatus = (status: "hit" | "miss") => {
      if (syncGenerationRef.current !== syncGeneration) return;
      if (status === "hit") metadataStats.cacheHits += 1;
      else metadataStats.cacheMisses += 1;
    };
    const capabilitiesPromise: Promise<DatabaseCapabilities> = Promise.resolve(
      lspCapabilities,
    );
    const serverVersionPromise = Promise.resolve(
      resolvedCapabilityContext?.connectionId === activeConnectionId
        ? resolvedCapabilityContext.serverVersion
        : null,
    );

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

    const synchronizeProjectDocuments = async (
      documents: Array<{ relativePath: string; content: string }>,
      lspDialect: string,
    ) => {
      const nextDocuments = new Map(
        documents.map((document) => [
          getLspProjectDocumentUri(activeProjectId, document.relativePath, lspDialect),
          document,
        ]),
      );
      const sessionKey = lspClient.getSessionKey();

      for (const [uri, previous] of openedProjectDocumentsRef.current) {
        if (
          previous.sessionKey === sessionKey &&
          nextDocuments.has(uri)
        ) {
          continue;
        }
        openedProjectDocumentsRef.current.delete(uri);
        await previous.client.didClose(uri);
      }

      for (const [uri, document] of nextDocuments) {
        const previous = openedProjectDocumentsRef.current.get(uri);
        if (
          previous &&
          previous.sessionKey === sessionKey &&
          previous.content === document.content
        ) {
          continue;
        }
        const version = (previous?.version || 0) + 1;
        if (previous?.sessionKey === sessionKey) {
          await lspClient.didChange(uri, document.content, version);
        } else {
          await lspClient.didOpen(uri, document.content, version, lspDialect);
        }
        openedProjectDocumentsRef.current.set(uri, {
          client: lspClient,
          sessionKey,
          content: document.content,
          version,
        });
      }
    };

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
        if (syncGenerationRef.current === syncGeneration) {
          metadataStats.failedObjects += 1;
        }
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
        () => buildTableDefinition(catalog, table),
        undefined,
        recordMetadataCacheStatus,
      );
    };

    const scheduledSync = scheduleDebouncedLspSync({
      timerRef: debounceTimerRef,
      delayMs: 500,
      generation: syncGeneration,
      run: ({ isCancelled }) => {
        setSemanticStatus(activeConnectionId, {
          state: "syncing",
          totalObjects: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedObjects: 0,
        });
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
          const [capabilities, serverVersion] = await Promise.all([
            capabilitiesPromise,
            serverVersionPromise,
          ]);
          const isStale = () =>
            isCancelled() || syncGenerationRef.current !== syncGeneration;
          if (!supportsLspCapabilities(capabilities)) {
            if (!isStale()) {
              setSemanticStatus(activeConnectionId, {
                state: "error",
                totalObjects: 0,
                cacheHits: 0,
                cacheMisses: 0,
                failedObjects: 0,
                message: `${capabilities.displayName} does not declare a compatible language-service capability for this driver package.`,
              });
            }
            return;
          }
          const canSyncTableMetadata = supportsSqlRelationMetadataLsp(capabilities);
          const useOnDemandColumnMetadata =
            canSyncTableMetadata &&
            usesOnDemandOnlyLspColumnMetadata(connection.driver);
          const canSyncCollectionMetadata =
            !canSyncTableMetadata &&
            (capabilities.supportsCollectionBrowsing ||
              capabilities.supportsKeyValueBrowsing);
          // Keep the editor's generic `sql` URI/language while explicitly
          // mapping it to the concrete reviewed server baseline. This makes
          // an installed SQL-family package (for example Trino or Doris)
          // retain its schema binding instead of letting the server infer a
          // dialect from a different connection or from an unsupported `sql`
          // config value.
          const documentLanguageId = lspLanguageIdForCapabilities(capabilities);
          const lspDialect = lspServerDialectForCapabilities(capabilities);
          const projectLspDocuments = activeProjectRoot
            ? await projectFilesService
                .getLspDocuments({
                  projectId: activeProjectId,
                  expectedRoot: activeProjectRoot,
                })
                .catch((error) => {
                  console.warn(
                    "[LSP] Project SQL documents could not be synchronized:",
                    error,
                  );
                  return [];
                })
            : [];
          const { fileSchemas, fileDialects } = buildLspFileMappings({
            queryTabs,
            schemaByTabId,
            catalogByTabId,
            defaultSchema,
            defaultCatalog,
            driver: connection.driver,
            lspDialect,
            documentLanguageId,
            getSchemaId,
          });
          const projectSchemaId = getSchemaId(
            defaultSchema,
            defaultCatalog.catalogName,
          );
          for (const document of projectLspDocuments) {
            const uri = getLspProjectDocumentUri(
              activeProjectId,
              document.relativePath,
              lspDialect,
            );
            fileSchemas[uri] = projectSchemaId;
            fileDialects[uri] = lspDialect;
          }
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

              const tables = selectLspTablesForSchema(
                schemaTables,
                preferredTablesByCatalog.get(lspCatalogKey(catalog)),
              );
              const preferredTables = useOnDemandColumnMetadata
                ? selectLspTablesForSchema(
                    tables,
                    preferredTablesByCatalog.get(lspCatalogKey(catalog)),
                    preferredTablesByCatalog.get(lspCatalogKey(catalog))?.size || 0,
                  )
                : tables;

              return {
                ...catalog,
                tables,
                metadataTableIndexes: preferredTables
                  .map((table) => tables.indexOf(table))
                  .filter((index) => index >= 0),
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
              driver: connection.driver,
              server_version: serverVersion,
              snapshot_revision: metadataVersion,
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
              catalog.metadataTableIndexes.forEach((objectIndex) => {
                const table = catalog.tables[objectIndex]!;
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
                  completionPreferences,
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
              if (
                dispatchResult.status !== "stale" &&
                dispatchResult.status !== "sent-stale"
              ) {
                await synchronizeProjectDocuments(projectLspDocuments, documentLanguageId);
              }
              return (
                dispatchResult.status !== "stale" &&
                dispatchResult.status !== "sent-stale"
              );
            } catch (error) {
              console.error("[LSP] Failed to sync schema:", error);
              if (!isStale()) {
                recordSemanticTelemetry(activeConnectionId, "syncFailure");
                setSemanticStatus(activeConnectionId, {
                  state: "error",
                  totalObjects: metadataWork.length,
                  ...metadataStats,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Schema configuration could not be sent to the language service.",
                });
              }
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
            completionPreferences,
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

          const publishSemanticCompletionStatus = () => {
            setSemanticStatus(activeConnectionId, {
              state:
                metadataStats.failedObjects > 0
                  ? "limited"
                  : metadataStats.cacheHits > 0 && metadataStats.cacheMisses === 0
                    ? "cached"
                    : "full",
              totalObjects: metadataWork.length,
              ...metadataStats,
              ...(metadataStats.failedObjects > 0
                ? {
                    message: `${metadataStats.failedObjects} object${metadataStats.failedObjects === 1 ? "" : "s"} could not be enriched; keyword and object-name completion remain available.`,
                  }
                : {}),
            });
          };

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
              recordSemanticTelemetry(activeConnectionId, "stale");
              console.log("[LSP] Skipping stale schema configuration");
              return;
            }

            if (dispatchResult.status === "duplicate") {
              console.log("[LSP] Skipping duplicate configuration send");
              await synchronizeProjectDocuments(projectLspDocuments, documentLanguageId);
              publishSemanticCompletionStatus();
              return;
            }

            if (dispatchResult.status === "sent-stale") {
              recordSemanticTelemetry(activeConnectionId, "stale");
              console.log(
                "[LSP] Configuration sent, but not cached because a newer sync started"
              );
              return;
            }

            lastConfigRef.current = dispatchResult.lastConfigKey;
            await synchronizeProjectDocuments(projectLspDocuments, documentLanguageId);
            console.log("[LSP] ✅ Configuration sent and cached");
            publishSemanticCompletionStatus();
          } catch (err) {
            console.error("[LSP] Failed to sync schema:", err);
            if (!isStale()) {
              recordSemanticTelemetry(activeConnectionId, "syncFailure");
              setSemanticStatus(activeConnectionId, {
                state: "error",
                totalObjects: metadataWork.length,
                ...metadataStats,
                message:
                  err instanceof Error
                    ? err.message
                    : "Schema configuration could not be sent to the language service.",
              });
            }
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
    keywordCase,
    tableAlias,
    driverCatalogStatus,
    activeProjectId,
    activeProjectRoot,
    projectDocumentRevisionKey,
    setSemanticStatus,
    clearSemanticStatus,
    lspCapabilities,
    resolvedCapabilityContext,
  ]);

  return null;
}
