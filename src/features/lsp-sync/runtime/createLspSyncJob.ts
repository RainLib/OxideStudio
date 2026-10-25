import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  LSP_PROGRESS_PUBLISH_BATCHES,
  LSP_PROGRESS_PUBLISH_INTERVAL_MS,
} from "@/features/lsp-sync/model/syncPolicy";
import { collectionToLspTableDefinitionWithMetadata } from "@/features/lsp-sync/runtime/collectionMetadata";
import { loadSqlLookupContexts } from "./loadSqlLookupContexts";
import { loadLspCatalogs } from "@/features/lsp-sync/runtime/loadLspCatalogs";
import {
  lspLanguageIdForCapabilities,
  lspServerDialectForCapabilities,
  supportsLspCapabilities,
  supportsSqlRelationMetadataLsp,
} from "@/lib/databaseDialect";
import type { LspClient } from "@/services/lsp/client";
import { dispatchLspConfiguration } from "@/services/lsp/configDispatch";
import { getLspProjectDocumentUri } from "@/services/lsp/document";
import { usesOnDemandOnlyLspColumnMetadata } from "@/services/lsp/metadataPolicy";
import { replaceLspRelationshipIndex } from "@/services/lsp/relationshipIndex";
import {
  DEFAULT_LSP_METADATA_BATCHING,
  loadLspMetadataInBatches,
} from "@/services/lsp/schemaBatching";
import type { LspTableDefinition } from "@/services/lsp/schemaConfig";
import {
  collectionToLspTableDefinition,
  emptyLspTableDetails,
  type LspSchemaDefinition,
} from "@/services/lsp/schemaConfig";
import type { LspCatalogTarget, LspSyncTab } from "@/services/lsp/syncPlan";
import { buildLspFileMappings } from "@/services/lsp/syncPlan";
import { projectFilesService } from "@/services/tauri";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";
import type { LspSemanticCompletionStatus } from "@/store/useLspSemanticStatusStore";

interface LspSyncJobOptions {
  verifyContext?:()=>Promise<boolean>;
  onConfigurationPublished?: (totalObjects:number,analysisToken?:string|null) => void;
  lastAnalysisTokenRef?:React.RefObject<string|null>;
  capabilitiesPromise: Promise<DatabaseCapabilities>;
  serverVersionPromise: Promise<string | null>;
  isCancelled: () => boolean;
  syncGenerationRef: React.RefObject<number>;
  syncGeneration: number;
  setSemanticStatus: (
    connectionId: string,
    status: Omit<LspSemanticCompletionStatus, "updatedAt" | "telemetry"> &
      Partial<Pick<LspSemanticCompletionStatus, "telemetry">>,
  ) => void;
  activeConnectionId: string;
  connection: ConnectionConfig;
  activeProjectRoot: string | null;
  activeProjectId: string;
  queryTabs: LspSyncTab[];
  schemaByTabId: Record<string, string>;
  catalogByTabId: Record<string, LspCatalogTarget>;
  defaultSchema: string;
  defaultCatalog: LspCatalogTarget;
  getSchemaId: (schemaName: string, catalogName?: string | null) => string;
  targetCatalogs: LspCatalogTarget[];
  preferredTablesByCatalog: Map<string, Set<string>>;
  metadataVersion: number;
  objectSourceUri: (
    catalog: LspCatalogTarget,
    objectName?: string | null | undefined,
    objectType?: string | null | undefined,
    columnName?: string | null | undefined,
  ) => string;
  assignSourceLocations: (
    catalog: LspCatalogTarget,
    definition: LspTableDefinition,
  ) => LspTableDefinition;
  getCachedTableDefinition: (
    catalog: LspCatalogTarget,
    table: {
      name: string;
      type?: string | null | undefined;
      comment?: string | null | undefined;
    },
  ) => Promise<LspTableDefinition>;
  completionPreferences: {
    readonly keywordCase: "upper" | "lower" | "preserve";
    readonly functionCase: "upper" | "lower" | "preserve";
    readonly tableAlias: "none" | "initials";
  };
  formattingPreferences: {
    readonly keywordCase: "upper" | "lower" | "preserve";
    readonly functionCase: "upper" | "lower" | "preserve";
    readonly logicalOperatorNewline: "none" | "before" | "after";
    readonly fromClauseLayout: "newLine" | "sameLine";
  };
  lastConfigRef: React.RefObject<string | null>;
  lspClient: LspClient;
  synchronizeProjectDocuments: (
    documents: { relativePath: string; content: string }[],
    lspDialect: string,
    isCancelled: () => boolean,
  ) => Promise<void>;
  recordSemanticTelemetry: (
    connectionId: string,
    event: "stale" | "syncFailure" | "restart",
    durationMs?: number | undefined,
  ) => void;
  metadataStats: {
    cacheHits: number;
    cacheMisses: number;
    failedObjects: number;
  };
}

export function createLspSyncJob({
  verifyContext,
  onConfigurationPublished,
  lastAnalysisTokenRef,
  capabilitiesPromise,
  serverVersionPromise,
  isCancelled,
  syncGenerationRef,
  syncGeneration,
  setSemanticStatus,
  activeConnectionId,
  connection,
  activeProjectRoot,
  activeProjectId,
  queryTabs,
  schemaByTabId,
  catalogByTabId,
  defaultSchema,
  defaultCatalog,
  getSchemaId,
  targetCatalogs,
  preferredTablesByCatalog,
  metadataVersion,
  objectSourceUri,
  assignSourceLocations,
  getCachedTableDefinition,
  completionPreferences,
  formattingPreferences,
  lastConfigRef,
  lspClient,
  synchronizeProjectDocuments,
  recordSemanticTelemetry,
  metadataStats,
}: LspSyncJobOptions) {
  const analysisTokenRef=lastAnalysisTokenRef||{current:null};
  const buildTableDefinitions = async () => {
    const [capabilities, serverVersion] = await Promise.all([
      capabilitiesPromise,
      serverVersionPromise,
    ]);
    const isStale = () =>
      isCancelled() || syncGenerationRef.current !== syncGeneration;
    const contextValid=async()=>!isStale()&&(!verifyContext||await verifyContext())&&!isStale();
    if(!await contextValid())return;
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
    const lookup = await loadSqlLookupContexts({
      connectionId: activeConnectionId,
      dialect: canSyncTableMetadata ? lspDialect : "",
      targetCatalogs,
      preferredTablesByCatalog,
    });
    if (isStale()) return;
    metadataStats.failedObjects += lookup.failures;
    const effectiveDefaultCatalog = lookup.bindCatalog(defaultCatalog);
    const effectiveCatalogByTabId = Object.fromEntries(
      Object.entries(catalogByTabId).map(([id, catalog]) => [id, lookup.bindCatalog(catalog)]),
    );
    const { fileSchemas, fileDialects } = buildLspFileMappings({
      queryTabs,
      schemaByTabId,
      catalogByTabId: effectiveCatalogByTabId,
      defaultSchema,
      defaultCatalog: effectiveDefaultCatalog,
      driver: connection.driver,
      lspDialect,
      documentLanguageId,
      getSchemaId,
    });
    const projectSchemaId = getSchemaId(
      defaultSchema,
      effectiveDefaultCatalog.catalogName,
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
    const { catalogs } = await loadLspCatalogs({
      targetCatalogs: lookup.targetCatalogs,
      canSyncTableMetadata,
      activeConnectionId,
      canSyncCollectionMetadata,
      capabilities,
      preferredTablesByCatalog: lookup.preferredTablesByCatalog,
      useOnDemandColumnMetadata,
    });

    if (isStale()) {
      console.log("[LSP] Cancelled stale metadata sync");
      return;
    }

    const schemaDefinitions: LspSchemaDefinition[] = catalogs.map(
      (catalog) => ({
        id: getSchemaId(catalog.schemaName, catalog.catalogName),
        catalog: catalog.catalogName,
        namespace: lookup.namespaceFor(catalog),
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
                ...emptyLspTableDetails([
                  objectSourceUri(catalog, table.name, table.type || null),
                  1,
                ]),
                columns: [],
              }),
            )
          : catalog.collections.map((collection) =>
              assignSourceLocations(
                catalog,
                collectionToLspTableDefinition(capabilities, collection),
              ),
            ),
        functions: catalog.functions,
      }),
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
            load: () => getCachedTableDefinition(catalog, table),
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
              collection,
            ).then((definition) => assignSourceLocations(catalog, definition)),
        });
      });
    });

    console.log(
      `[LSP] Loading complete metadata for ${metadataWork.length} objects in batches of ${DEFAULT_LSP_METADATA_BATCHING.batchSize}`,
    );
    const publishConfiguration = async () => {
      try {
        if(!await contextValid())return false;
        const dispatchResult = await dispatchLspConfiguration({
          connectionId: activeConnectionId,
          driver: connection.driver,
          lspDialect,
          config: {
            defaultDialect: lspDialect,
            completionPreferences,
            formattingPreferences,
            schemas: schemaDefinitions.map((schema) => ({
              ...schema,
              tables: [...schema.tables],
              functions: [...schema.functions],
            })),
            fileSchemas,
            fileDialects,
          },
          lastConfigKey: lastConfigRef.current,
          lastAnalysisToken:analysisTokenRef.current,
          syncGeneration,
          getCurrentGeneration: () => syncGenerationRef.current,
          isCancelled: isStale,
          confirmConfiguration: token => lspClient.confirmAnalysisConfiguration(token),
          updateConfiguration: (nextConfig) =>
            lspClient.updateConfiguration(nextConfig),
        });

        if(!await contextValid())return false;
        if (dispatchResult.status === "sent") {
          lastConfigRef.current = dispatchResult.lastConfigKey;
          analysisTokenRef.current=dispatchResult.analysisToken||null;
        }
        if (
          dispatchResult.status !== "stale" &&
          dispatchResult.status !== "sent-stale"
        ) {
          if (!isStale()) onConfigurationPublished?.(metadataWork.length,dispatchResult.analysisToken);
          await synchronizeProjectDocuments(
            projectLspDocuments,
            documentLanguageId,
            isStale,
          );
        }
        return (
          !isStale() &&
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
          schemaDefinitions[work.schemaIndex]!.tables[work.objectIndex] =
            definition;
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
        `[LSP] Cancelled stale metadata sync after ${batchResult.processed}/${batchResult.total} objects`,
      );
      return;
    }

    // Reuse the completed semantic metadata for FK-aware JOIN proposals.
    // No additional schema scan is performed by the editor.
    catalogs.forEach((catalog, schemaIndex) => {
      replaceLspRelationshipIndex(
        {
          connectionId: activeConnectionId,
          driver: connection.driver,
          databaseName: catalog.databaseName || undefined,
          schema: catalog.schemaName,
        },
        schemaDefinitions[schemaIndex]?.tables || [],
      );
    });

    // Build configuration matching Python script format
    const config = {
      defaultDialect: lspDialect,
      completionPreferences,
      formattingPreferences,
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
          [catalog.catalogName, catalog.schemaName].filter(Boolean).join("."),
        )
        .join(", "),
    );
    console.log("[LSP] - Files:", Object.keys(fileSchemas).length);

    const publishSemanticCompletionStatus = () => {
      if (isStale()) return;
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
      if(!await contextValid())return;
      const dispatchResult = await dispatchLspConfiguration({
        connectionId: activeConnectionId,
        driver: connection.driver,
        lspDialect,
        config,
        lastConfigKey: lastConfigRef.current,
        lastAnalysisToken:analysisTokenRef.current,
        syncGeneration,
        getCurrentGeneration: () => syncGenerationRef.current,
        isCancelled: isStale,
        confirmConfiguration: token => lspClient.confirmAnalysisConfiguration(token),
          updateConfiguration: (nextConfig) =>
          lspClient.updateConfiguration(nextConfig),
      });

      if(!await contextValid())return;
      if (dispatchResult.status === "stale") {
        recordSemanticTelemetry(activeConnectionId, "stale");
        console.log("[LSP] Skipping stale schema configuration");
        return;
      }

      if (dispatchResult.status === "duplicate") {
        if (!isStale()) onConfigurationPublished?.(metadataWork.length,dispatchResult.analysisToken);
        console.log("[LSP] Skipping duplicate configuration send");
        await synchronizeProjectDocuments(
          projectLspDocuments,
          documentLanguageId,
          isStale,
        );
        publishSemanticCompletionStatus();
        return;
      }

      if (dispatchResult.status === "sent-stale") {
        recordSemanticTelemetry(activeConnectionId, "stale");
        console.log(
          "[LSP] Configuration sent, but not cached because a newer sync started",
        );
        return;
      }

      lastConfigRef.current = dispatchResult.lastConfigKey;
      analysisTokenRef.current=dispatchResult.analysisToken||null;
      if (!isStale()) onConfigurationPublished?.(metadataWork.length,dispatchResult.analysisToken);
      await synchronizeProjectDocuments(
        projectLspDocuments,
        documentLanguageId,
        isStale,
      );
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

  return { buildTableDefinitions };
}
