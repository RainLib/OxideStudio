import type { ConnectionConfig } from "@/features/connections/model/types";
import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import { useBatchColumnSelection } from "@/features/query-editor/hooks/useBatchColumnSelection";
import { useCachedSqlCompletionSource } from "@/features/query-editor/hooks/useCachedSqlCompletionSource";
import { useLspCompletionProviderCoordinator } from "@/features/query-editor/hooks/useLspCompletionProviderCoordinator";
import {
  RECORD_COMPLETION_USAGE_COMMAND,
  SqlBatchColumnRuntimeSession,
} from "@/features/query-editor/model/completionProviderRuntime";
import { createQueryCompletionProvider } from "@/features/query-editor/model/createQueryCompletionProvider";
import type { AppSettings } from "@/features/settings/model/settingsTypes";
import type { TabData } from "@/features/workspace-tabs/model/types";
import {
  completionUsageScope,
  recordCompletionUsage,
} from "@/lib/completionUsage";
import {
  ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS,
  ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
} from "@/lib/elasticsearchConsole";
import type { LspClient } from "@/services/lsp/client";
import { type DatabaseCapabilities } from "@/services/tauri";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import type { TableInfo } from "@/services/tauri/types/schemaCatalog";
import type { DatabaseDriverCatalogStatus } from "@/store/useDatabaseDriverCatalogStore";
import { useMemo, useRef } from "react";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";
import {semanticTabRoute, semanticConnectionToken} from "@/services/lsp/semanticContext";
import {createCompletionContextReader} from "../model/completionContextState";
import {subscribeCompletionContext} from "../model/completionContextState";
import {useLspRuntimeSnapshot} from "@/hooks/useLspRuntimeSnapshot";
import {useCompletionContextRefresh} from "./useCompletionContextRefresh";
import {triggerChainedSqlCompletion} from "../model/completionContinuation";

interface QuerySqlCompletionOptions {
  syncDocument?:(model:any)=>Promise<void>;
  activeProjectId: string;
  effectiveConnectionId: string | null;
  currentSchema: string | null;
  activeTab: TabData | undefined;
  driver: DatabaseDriver;
  metadataVersion: number;
  schemaTables: TableInfo[];
  catalogDatabases?: string[];
  editorSettings: AppSettings["editor"];
  documentUri: string;
  driverCatalogStatus: DatabaseDriverCatalogStatus;
  lspReady: boolean;
  preferredElasticsearchIndex: string | undefined;
  canUseLsp: boolean;
  monaco: typeof import("monaco-editor") | null;
  completionTriggerOriginRef: React.RefObject<"explicit" | "chained" | null>;
  activeConnection: ConnectionConfig | undefined;
  completionRequestGenerationRef: React.RefObject<Map<string, number>>;
  capabilities: DatabaseCapabilities;
  documentLanguageId: string;
  lspClient: LspClient;
  openedDocumentsRef: React.RefObject<Set<string>>;
  documentVersionsRef: React.RefObject<Map<string, number>>;
  documentTextsRef: React.RefObject<Map<string, string>>;
  mountedEditor: any;
  editorLanguageId: string;
  isActivePane: boolean;
}

export function useQuerySqlCompletion({
  syncDocument,
  activeProjectId,
  effectiveConnectionId,
  currentSchema,
  activeTab,
  driver,
  metadataVersion,
  schemaTables,
  catalogDatabases,
  editorSettings,
  documentUri,
  driverCatalogStatus,
  lspReady,
  preferredElasticsearchIndex,
  canUseLsp,
  monaco,
  completionTriggerOriginRef,
  activeConnection,
  completionRequestGenerationRef,
  capabilities,
  documentLanguageId,
  lspClient,
  openedDocumentsRef,
  documentVersionsRef,
  documentTextsRef,
  mountedEditor,
  editorLanguageId,
  isActivePane,
}: QuerySqlCompletionOptions) {
  const lspRuntime=useLspRuntimeSnapshot(lspClient);
  const connectionRuntime=useConnectionStore(state=>effectiveConnectionId?state.connectionRuntimeStates[effectiveConnectionId]:undefined);
  const executionObservation=useConnectionSemanticStore(state=>effectiveConnectionId?state.byConnectionId[effectiveConnectionId]:undefined);
  const connectionIdentity = semanticConnectionToken(activeConnection);
  const cacheScope=useMemo(()=>({connectionIdentity,connectionRuntime,executionObservation}),[connectionIdentity,connectionRuntime,executionObservation]);
  const runtimeSequenceRef=useRef(0);
  const observedProcess=effectiveConnectionId?lspRuntime:undefined;
  const runtimeSequence=useMemo(()=>++runtimeSequenceRef.current,[connectionRuntime,executionObservation,observedProcess]);
  const route=semanticTabRoute(activeTab);
  const getCompletionContext=useMemo(()=>createCompletionContextReader({
    connectionId:effectiveConnectionId,tabId:activeTab?.id,connection:activeConnection,
    lspClient,metadataVersion,projectId:activeProjectId,currentSchema,route,
  }),[effectiveConnectionId,activeTab?.id,activeConnection,metadataVersion,activeProjectId,currentSchema,route,lspClient]);
  const subscribeContext=useMemo(()=>(listener:()=>void)=>subscribeCompletionContext(listener,lspClient),[lspClient]);
  const batchColumnSessionsRef = useRef(
    new Map<string, SqlBatchColumnRuntimeSession>(),
  );
  useCompletionContextRefresh({editor:mountedEditor,enabled:isActivePane,read:getCompletionContext,subscribe:subscribeContext,
    allowDocumentOnly:capabilities.supportsSqlQuery,
    invalidate:()=>batchColumnSessionsRef.current.clear(),triggerOriginRef:completionTriggerOriginRef});

  const createCachedSqlCompletionRequest = useCachedSqlCompletionSource({
    cacheScope,
    activeProjectId,
    connectionId: effectiveConnectionId,
    currentSchema,
    databaseName: activeTab?.databaseName || (activeConnection && connectionCatalogDatabaseName(activeConnection)) ||
      (catalogDatabases?.length === 1 ? catalogDatabases[0] : undefined),
    driver,
    metadataRevision: metadataVersion,
    schemaTables,
    sqlCompletion: editorSettings.sqlCompletion,
    sqlFormatting: editorSettings.sqlFormatting,
    targetSchema: activeTab?.targetSchema || activeTab?.schemaName,
  });
  const usageScope = completionUsageScope([
    activeProjectId,
    effectiveConnectionId,
    activeTab?.databaseName,
    activeTab?.targetSchema || currentSchema,
    driver,
  ]);
  const rankByUsage = editorSettings.sqlCompletion.rankByUsage;
  const completionOwnerKey = useMemo(
    () =>
      [
        documentUri,
        effectiveConnectionId || "",
        driver,
        runtimeSequence,
        activeTab?.databaseName || "",
        activeTab?.targetSchema || currentSchema || "",
        metadataVersion,
        driverCatalogStatus,
        lspReady ? "ready" : "offline",
        preferredElasticsearchIndex || "",
        editorSettings.sqlCompletion.appendSpace ? "space" : "compact",
        editorSettings.sqlFormatting.keywordCase,
        editorSettings.sqlFormatting.functionCase,
        rankByUsage ? "usage" : "alphabetic",
        editorSettings.sqlCompletion.triggerMode,
        JSON.stringify(editorSettings.sqlCompletion.snippets),
      ].join("\u0000"),
    [
      activeTab?.databaseName,
      activeTab?.targetSchema,
      currentSchema,
      documentUri,
      driver,
      driverCatalogStatus,
      editorSettings.sqlCompletion.appendSpace,
      editorSettings.sqlFormatting.functionCase,
      editorSettings.sqlFormatting.keywordCase,
      editorSettings.sqlCompletion.snippets,
      editorSettings.sqlCompletion.triggerMode,
      effectiveConnectionId,
      lspReady,
      metadataVersion,
      preferredElasticsearchIndex,
      rankByUsage,
      runtimeSequence,
    ],
  );
  // Monaco providers are global per language. Scope requests to the document
  // owned by this editor instance so a background tab cannot use this
  // connection's LSP client or pinned driver package.
  const isCurrentLspModelUri = (uri: string) =>
    uri === documentUri && canUseLsp;
  const { provideCompletionItems, resolveCompletionItem } =
    createQueryCompletionProvider({
      syncDocument,
      getCompletionContext,
      monaco,
      completionTriggerOriginRef,
      documentUri,
      effectiveConnectionId,
      isCurrentLspModelUri,
      activeTab,
      currentSchema,
      activeConnection,
      metadataVersion,
      editorSettings,
      usageScope,
      completionRequestGenerationRef,
      createCachedSqlCompletionRequest,
      capabilities,
      rankByUsage,
      completionOwnerKey,
      driver,
      batchColumnSessionsRef,
      preferredElasticsearchIndex,
      lspReady,
      documentLanguageId,
      lspClient,
      openedDocumentsRef,
      documentVersionsRef,
      documentTextsRef,
      mountedEditor,
    });

  useLspCompletionProviderCoordinator({
    editorLanguageId,
    isActivePane,
    monaco,
    ownerKey: completionOwnerKey,
    provideCompletionItems,
    resolveCompletionItem,
    rankByUsage,
    recordUsage: recordCompletionUsage,
    triggerChainedCompletion: () => triggerChainedSqlCompletion(mountedEditor,completionTriggerOriginRef),
    triggerCharacters:
      editorLanguageId === ELASTICSEARCH_CONSOLE_LANGUAGE_ID
        ? ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS
        : [" ", ".", "(", ",", '"', "@", "/", "{", ":"],
    usageCommandId: RECORD_COMPLETION_USAGE_COMMAND,
    usageScope,
  });

  const {
    applyBatchColumnSelection,
    batchColumnSession,
    setBatchColumnSession,
  } = useBatchColumnSelection({
    monaco,
    isActivePane,
    completionOwnerKey,
    batchColumnSessionsRef,
    mountedEditor,

    editorSettings,
  });

  return {
    usageScope,
    applyBatchColumnSelection,
    batchColumnSession,
    setBatchColumnSession,
  };
}
