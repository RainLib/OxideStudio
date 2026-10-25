import type { ConnectionConfig, ConnectionRuntimeState } from "@/features/connections/model/types";
import { type CachedLspTableDefinition } from "@/features/lsp-sync/model/syncTypes";
import { createLspSchemaIdentity } from "@/features/lsp-sync/runtime/createLspSchemaIdentity";
import { createLspSyncJob } from "@/features/lsp-sync/runtime/createLspSyncJob";
import { createLspTableLoader } from "@/features/lsp-sync/runtime/createLspTableLoader";
import { createProjectDocumentSync } from "@/features/lsp-sync/runtime/createProjectDocumentSync";
import { lspServerDialectForCapabilities, supportsLspCapabilities } from "@/lib/databaseDialect";
import type { LspClient } from "@/services/lsp/client";
import { clearLspRelationshipIndex } from "@/services/lsp/relationshipIndex";
import type { LspSyncTab } from "@/services/lsp/syncPlan";
import { createLspSyncPlan } from "@/services/lsp/syncPlan";
import {
  cancelScheduledLspSync,
  scheduleDebouncedLspSync,
  type LspSyncTimer,
} from "@/services/lsp/syncScheduler";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";
import type { TableInfo } from "@/services/tauri/types/schemaCatalog";
import type { DatabaseDriverCatalogStatus } from "@/store/useDatabaseDriverCatalogStore";
import type { LspSemanticCompletionStatus } from "@/store/useLspSemanticStatusStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {semanticConnectionToken, semanticTabRoute, type LspSemanticContextIdentity} from "@/services/lsp/semanticContext";
import {useConnectionSemanticStore,isSemanticObservationIdle,type ConnectionSemanticObservation} from "@/services/lsp/connectionSemanticState";
import {verifyConnectionSemanticObservation} from "@/services/lsp/connectionSemanticObserver";
import {useLspRuntimeSnapshot} from "@/hooks/useLspRuntimeSnapshot";
import {publishSemanticStatus as publishContextStatus} from "../runtime/publishSemanticStatus";

interface LspSchemaSyncOptions {
  executionObservation?:ConnectionSemanticObservation;
  activeConnectionId: string | null;
  metadataVersion: number;
  isReady: boolean;
  activeConnection: ConnectionConfig | undefined;
  activeConnectionRuntime?: ConnectionRuntimeState;
  activeProjectRoot: string | null;
  hasConnectionLspTab: boolean;
  lspCapabilities: DatabaseCapabilities;
  supportsMetadataSync: boolean;
  clearSemanticStatus: (connectionId: string) => void;
  resolvedCapabilityContext: {
    connectionId: string;
    capabilities: DatabaseCapabilities;
    serverVersion: string | null;
  } | null;
  setSemanticStatus: (
    connectionId: string,
    status: Omit<LspSemanticCompletionStatus, "updatedAt" | "telemetry"> &
      Partial<Pick<LspSemanticCompletionStatus, "telemetry">>,
  ) => void;
  schemas: string[];
  currentSchema: string | null;
  activeTabId: string | null;
  tabs: LspSyncTab[];
  activeProjectId: string;
  lspClient: LspClient;
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
  recordSemanticTelemetry: (
    connectionId: string,
    event: "stale" | "syncFailure" | "restart",
    durationMs?: number | undefined,
  ) => void;
  connections: ConnectionConfig[];
  tables: TableInfo[];
  keywordCase: "upper" | "lower" | "preserve";
  functionCase: "upper" | "lower" | "preserve";
  tableAlias: "none" | "initials";
  logicalOperatorNewline: "none" | "before" | "after";
  fromClauseLayout: "newLine" | "sameLine";
  driverCatalogStatus: DatabaseDriverCatalogStatus;
  projectDocumentRevisionKey: string;
}

export function useLspSchemaSync({
  executionObservation,
  activeConnectionId,
  metadataVersion,
  isReady,
  activeConnection,
  activeConnectionRuntime,
  activeProjectRoot,
  hasConnectionLspTab,
  lspCapabilities,
  supportsMetadataSync,
  clearSemanticStatus,
  resolvedCapabilityContext,
  setSemanticStatus: publishSemanticStatus,
  schemas,
  currentSchema,
  activeTabId,
  tabs,
  activeProjectId,
  lspClient,
  completionPreferences,
  formattingPreferences,
  recordSemanticTelemetry,
  connections,
  tables,
  keywordCase,
  functionCase,
  tableAlias,
  logicalOperatorNewline,
  fromClauseLayout,
  driverCatalogStatus,
  projectDocumentRevisionKey,
}: LspSchemaSyncOptions) {
  const lspRuntime=useLspRuntimeSnapshot(lspClient);
  const routeSignature=JSON.stringify(tabs.map(tab=>[tab.id,semanticTabRoute(tab)]));
  const contextIdentity = useMemo<LspSemanticContextIdentity>(()=>({
    connection:semanticConnectionToken(activeConnection),runtime:activeConnectionRuntime,lspRuntime:lspRuntime.generation,execution:executionObservation,metadataVersion,
    projectId:activeProjectId,currentSchema,
    routes:Object.fromEntries(tabs.map(tab=>[tab.id,semanticTabRoute(tab)])),
  }),[activeConnection,activeConnectionRuntime,lspRuntime,executionObservation,metadataVersion,activeProjectId,currentSchema,routeSignature]);
  const sourcesReadyRef = useRef<LspSemanticContextIdentity|null>(null);
  const metadataReadyRef = useRef<LspSemanticContextIdentity|null>(null);
  const analysisProvenanceRef=useRef<{identity:LspSemanticContextIdentity;token:string}|null>(null);
  const lastAnalysisTokenRef=useRef<string|null>(null);
  const setSemanticStatus = useCallback<typeof publishSemanticStatus>((connectionId,status)=>{
    publishContextStatus({connectionId,identity:contextIdentity,status,provenance:analysisProvenanceRef,sources:sourcesReadyRef,metadata:metadataReadyRef,publish:publishSemanticStatus});
  },[publishSemanticStatus,contextIdentity]);
  const lastConfigRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<LspSyncTimer | null>(null);
  const syncGenerationRef = useRef(0);
  const tableMetadataCacheRef = useRef<Map<string, CachedLspTableDefinition>>(
    new Map(),
  );
  const [projectDocumentSync] = useState(createProjectDocumentSync);
  const previousSessionRef = useRef({connectionId: activeConnectionId, runtime: activeConnectionRuntime,execution:executionObservation});
  const completedSessionRef = useRef<(typeof previousSessionRef.current & {metadataVersion: number}) | null>(null);
  const resetConfigurationRef = useRef<Promise<boolean>>(Promise.resolve(true));
  useEffect(()=>{
    syncGenerationRef.current++;
    lastConfigRef.current=null;lastAnalysisTokenRef.current=null;
    sourcesReadyRef.current=null;metadataReadyRef.current=null;analysisProvenanceRef.current=null;
    if(activeConnectionId&&hasConnectionLspTab&&supportsMetadataSync)setSemanticStatus(activeConnectionId,{
      state:"syncing",totalObjects:0,cacheHits:0,cacheMisses:0,failedObjects:0,
    });
    // Metadata still belongs to the same database, but process-local documents
    // and configuration receipts must be reacquired even after a quick restart.
    void projectDocumentSync.closeAll();
  },[lspRuntime]);

  useEffect(() => {
    const previous = previousSessionRef.current;
    previousSessionRef.current = {connectionId: activeConnectionId, runtime: activeConnectionRuntime,execution:executionObservation};
    if(previous.connectionId!==activeConnectionId){resetConfigurationRef.current=Promise.resolve(true);return;}
    if (previous.runtime === activeConnectionRuntime&&previous.execution===executionObservation || !isReady) return;
    // Retained LSP sessions must stop exposing objects from a replaced backend
    // connection before fresh introspection is allowed to publish.
    resetConfigurationRef.current = lspClient.updateConfiguration({
      defaultDialect: lspServerDialectForCapabilities(lspCapabilities),
      completionPreferences, formattingPreferences,
      schemas: [], fileSchemas: {}, fileDialects: {},
    }).then(() => true, error => {
      console.error("[LSP] Failed to clear the previous connection context:", error);
      return false;
    });
  }, [activeConnectionId, activeConnectionRuntime, executionObservation, isReady, lspClient]);

  useEffect(() => {
    tableMetadataCacheRef.current.clear();
    clearLspRelationshipIndex();
    lastConfigRef.current = null;
    lastAnalysisTokenRef.current=null;
  }, [activeConnectionId, activeConnectionRuntime, executionObservation, metadataVersion]);

  useEffect(() => {
    return () => {
      void projectDocumentSync.closeAll();
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

    void projectDocumentSync.closeAll();
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
    const executionIsCurrent=()=>{
      if(!lspRuntime.ready||lspClient.getRuntimeSnapshot()!==lspRuntime)return false;
      const authority=useConnectionSemanticStore.getState();
      return !authority.enabled||authority.transport==="ready"&&authority.byConnectionId[activeConnectionId]===executionObservation&&isSemanticObservationIdle(executionObservation);
    };
    if(!executionIsCurrent()){
      setSemanticStatus(activeConnectionId,{state:"syncing",totalObjects:0,cacheHits:0,cacheMisses:0,failedObjects:0,
        message:executionObservation?.state?.uncertain?"The driver could not confirm completion. Reconnect before refreshing semantic metadata.":"Waiting for an idle, verified driver session before refreshing semantic metadata."});
      return;
    }

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
        message:
          "Resolving the live driver package and server capability contract.",
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
        message:
          "Waiting for the database schema before semantic completion can be synchronized.",
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
    const capabilitiesPromise: Promise<DatabaseCapabilities> =
      Promise.resolve(lspCapabilities);
    const serverVersionPromise = Promise.resolve(
      resolvedCapabilityContext?.connectionId === activeConnectionId
        ? resolvedCapabilityContext.serverVersion
        : null,
    );

    const { getSchemaId, objectSourceUri } = createLspSchemaIdentity({
      activeConnectionId,
      connection,
    });

    const synchronizeProjectDocuments = (
      documents: Array<{ relativePath: string; content: string }>,
      languageId: string,
      isCancelled: () => boolean,
    ) =>
      projectDocumentSync.synchronize({
        activeProjectId,
        lspClient,
        documents,
        languageId,
        isCancelled,
      });

    const { assignSourceLocations, getCachedTableDefinition } =
      createLspTableLoader({
        objectSourceUri,
        capabilitiesPromise,
        connection,
        activeConnectionId,
        syncGenerationRef,
        syncGeneration,
        metadataStats,
        tableMetadataCacheRef,
        recordMetadataCacheStatus,
        forceMetadata: Boolean((activeConnectionRuntime || executionObservation || completedSessionRef.current) && (
          completedSessionRef.current?.connectionId !== activeConnectionId ||
          completedSessionRef.current.runtime !== activeConnectionRuntime ||
          completedSessionRef.current.execution !== executionObservation ||
          completedSessionRef.current.metadataVersion !== metadataVersion
        )),
      });

    const scheduledSync = scheduleDebouncedLspSync({
      timerRef: debounceTimerRef,
      delayMs: 500,
      generation: syncGeneration,
      run: async ({ isCancelled }) => {
        const resetSucceeded = await resetConfigurationRef.current;
        if (isCancelled() || syncGenerationRef.current !== syncGeneration || !executionIsCurrent()) return;
        if (!resetSucceeded) {
          setSemanticStatus(activeConnectionId, {state: "error", totalObjects: 0,
            cacheHits: 0, cacheMisses: 0, failedObjects: 0,
            message: "The previous connection context could not be cleared. Reconnect the language service before retrying."});
          return;
        }
        setSemanticStatus(activeConnectionId, {
          state: "syncing",
          totalObjects: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedObjects: 0,
        });
        console.log(
          "[LSP] Building schema configuration for:",
          connection.name,
        );
        console.log(
          "[LSP] Target catalogs:",
          targetCatalogs
            .map((catalog) =>
              [catalog.catalogName, catalog.schemaName]
                .filter(Boolean)
                .join("."),
            )
            .join(", "),
        );

        // Build tables array with columns
        // tables is an ARRAY: TableInfo[]
        const { buildTableDefinitions } = createLspSyncJob({
          lastAnalysisTokenRef,
          capabilitiesPromise,
          serverVersionPromise,
          isCancelled:()=>isCancelled()||!executionIsCurrent(),
          verifyContext:executionObservation?()=>verifyConnectionSemanticObservation(activeConnectionId,executionObservation):undefined,
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
          onConfigurationPublished: (totalObjects,analysisToken) => {
            if (isCancelled() || syncGenerationRef.current !== syncGeneration || !executionIsCurrent()) return;
            analysisProvenanceRef.current=analysisToken?{identity:contextIdentity,token:analysisToken}:null;
            metadataReadyRef.current=null;
            sourcesReadyRef.current=contextIdentity;
            setSemanticStatus(activeConnectionId,{state:"syncing",totalObjects,...metadataStats});
          },
        });

        await buildTableDefinitions();
        if (!isCancelled() && executionIsCurrent() && syncGenerationRef.current === syncGeneration && lastConfigRef.current !== null) {
          completedSessionRef.current = {connectionId: activeConnectionId, runtime: activeConnectionRuntime,execution:executionObservation, metadataVersion};
        }
      },
    });

    return scheduledSync.cleanup;
  }, [
    activeConnectionId,
    activeConnection,
    activeConnectionRuntime,
    executionObservation,
    connections,
    tabs,
    activeTabId,
    isReady,
    lspClient,
    lspRuntime,
    schemas,
    tables,
    currentSchema,
    metadataVersion,
    supportsMetadataSync,
    keywordCase,
    functionCase,
    tableAlias,
    logicalOperatorNewline,
    fromClauseLayout,
    driverCatalogStatus,
    activeProjectId,
    activeProjectRoot,
    projectDocumentRevisionKey,
    setSemanticStatus,
    clearSemanticStatus,
    lspCapabilities,
    resolvedCapabilityContext,
  ]);
}
