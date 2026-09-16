import { useConsoleAutoSuggest } from "@/features/query-editor/hooks/useConsoleAutoSuggest";
import { useConsoleFileController } from "@/features/query-editor/hooks/useConsoleFileController";
import { useCurrentStatementDecoration } from "@/features/query-editor/hooks/useCurrentStatementDecoration";
import { useDocumentCompletionRefresh } from "@/features/query-editor/hooks/useDocumentCompletionRefresh";
import { useEditorApplicationEvents } from "@/features/query-editor/hooks/useEditorApplicationEvents";
import { useEditorChangePreview } from "@/features/query-editor/hooks/useEditorChangePreview";
import { useEditorConnectionCatalog } from "@/features/query-editor/hooks/useEditorConnectionCatalog";
import { useEditorDocumentContent } from "@/features/query-editor/hooks/useEditorDocumentContent";
import { useEditorExecutionConfirmation } from "@/features/query-editor/hooks/useEditorExecutionConfirmation";
import { useEditorExecutionNotice } from "@/features/query-editor/hooks/useEditorExecutionNotice";
import { useEditorFormatting } from "@/features/query-editor/hooks/useEditorFormatting";
import { useEditorKeyboardBindings } from "@/features/query-editor/hooks/useEditorKeyboardBindings";
import { useEditorLanguageServices } from "@/features/query-editor/hooks/useEditorLanguageServices";
import { useEditorPresentation } from "@/features/query-editor/hooks/useEditorPresentation";
import { useEditorServerVersion } from "@/features/query-editor/hooks/useEditorServerVersion";
import { useElasticsearchAnalysis } from "@/features/query-editor/hooks/useElasticsearchAnalysis";
import { useElasticsearchCompletionProvider } from "@/features/query-editor/hooks/useElasticsearchCompletionProvider";
import { useExplorerTableDrop } from "@/features/query-editor/hooks/useExplorerTableDrop";
import { useLspDocumentLifecycle } from "@/features/query-editor/hooks/useLspDocumentLifecycle";
import { useMonacoEditorViewState } from "@/features/query-editor/hooks/useMonacoEditorViewState";
import { useMongoCompletionProvider } from "@/features/query-editor/hooks/useMongoCompletionProvider";
import { useQueryExecutionController } from "@/features/query-editor/hooks/useQueryExecutionController";
import { useQueryEditorWorkspaceState } from "@/features/query-editor/hooks/useQueryEditorWorkspaceState";
import { useQuerySqlCompletion } from "@/features/query-editor/hooks/useQuerySqlCompletion";
import { useQueryTransactionController } from "@/features/query-editor/hooks/useQueryTransactionController";
import { useSavedQueryDrop } from "@/features/query-editor/hooks/useSavedQueryDrop";
import { useSqlEditorIntentions } from "@/features/query-editor/hooks/useSqlEditorIntentions";
import { createEditorHistoryActions } from "@/features/query-editor/model/createEditorHistoryActions";
import { looksLikeDmlStatement } from "@/features/query-editor/model/dmlChangePreview";
import { editorDocumentIdentity } from "@/features/query-editor/model/editorDocumentIdentity";
import { QueryExecutionSnapshot } from "@/features/query-editor/model/queryExecutionTarget";
import type { QueryEditorProps } from "@/features/query-editor/model/queryEditorProps";
import { useSqlScriptImportController } from "@/features/sql-script-import";
import { useLspClient } from "@/hooks/useLspClient";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { elasticsearchConsoleVariableNames } from "@/lib/elasticsearchConsole";
import { lspSemanticStatusPresentation } from "@/lib/lspSemanticStatus";
import { extractSqlParameters } from "@/lib/sqlParameters";
import { type VimModeController } from "@/lib/vimMode";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useLspSemanticStatusStore } from "@/store/useLspSemanticStatusStore";
import type { ElasticsearchAnalysisResponse } from "@/workers/elasticsearchAnalysis.worker";
import { useMonaco } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";



export function useQueryEditorController(props: QueryEditorProps = {}) {
  const { tabId, isActivePane = true, onVimWindowNavigate } = props;

  const {
    activeTab,
    activeConnectionId,
    activeProjectId,
    applyEditorPatchPreview,
    bumpMetadataVersion,
    cancelTabQuery,
    connectedConnectionIds,
    connections,
    currentSchema,
    deleteQuery,
    dismissEditorPatch,
    editorSettings,
    effectiveTabId,
    keymap,
    loadSchemas,
    loadTables,
    metadataVersion,
    openSavedSqlFile,
    runExplainPlan,
    runTabQuery,
    saveQuery,
    savedQueries,
    schemaCollections,
    schemaTables,
    setEditorSelection,
    setEditorViewport,
    setElasticsearchVariables,
    setLspDiagnostics,
    setQueryLanguage,
    setTargetDatabase,
    setTargetSchema,
    tabContexts,
    updateSavedSqlFile,
    updateTabSql,
  } = useQueryEditorWorkspaceState(tabId);

  // const [saveName, setSaveName] = useState("");
  // const [isSaveOpen, setIsSaveOpen] = useState(false);
  // const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [currentPreviewSql, setCurrentPreviewSql] = useState("");
  // const dropdownRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const [mountedEditor, setMountedEditor] = useState<any>(null);

  const tableDropTargetRef = useRef<HTMLDivElement | null>(null);
  const tableDropCaretRef = useRef<HTMLSpanElement | null>(null);
  const activeTabIdRef = useRef<string | null>(effectiveTabId);
  const vimControllerRef = useRef<VimModeController | null>(null);
  const vimModeRef = useRef("NORMAL");
  const inlineKeysContextRef = useRef<{ set: (value: boolean) => void } | null>(
    null,
  );
  const vimStatusNodeRef = useRef<HTMLSpanElement | null>(null);
  const completionTriggerOriginRef = useRef<"explicit" | "chained" | null>(
    null,
  );
  const runAllActionRef = useRef<() => void>(() => {});
  const runCurrentActionRef = useRef<() => void>(() => {});
  const previewChangesActionRef = useRef<() => void>(() => {});
  const previewChangesContextRef = useRef<{
    set: (value: boolean) => void;
  } | null>(null);
  const canPreviewChangesRef = useRef(false);
  const pendingToolbarExecutionSnapshotRef =
    useRef<QueryExecutionSnapshot | null>(null);
  const formatActionRef = useRef<() => void>(() => {});
  const elasticsearchAnalysisWorkerRef = useRef<Worker | null>(null);
  const elasticsearchAnalysisTimerRef = useRef<number | null>(null);
  const elasticsearchAnalysisRequestIdRef = useRef(0);
  const elasticsearchAnalysisApplyRef = useRef<
    ((response: ElasticsearchAnalysisResponse) => void) | null
  >(null);
  const elasticsearchDecorationIdsRef = useRef<string[]>([]);
  const elasticsearchRequestLinesRef = useRef<Set<number>>(new Set());
  const effectiveConnectionId = activeTab?.connectionId || activeConnectionId;
  const { retriggerActiveDocumentCompletion } = useDocumentCompletionRefresh({
    editorRef,
    completionTriggerOriginRef,
    metadataVersion,
    activeProjectId,
    effectiveConnectionId,
  });

  const activeConnection = connections.find(
    (c) => c.id === effectiveConnectionId,
  );
  const connectionAvailabilityKey = useMemo(
    () => connections.map((connection) => connection.id).join("|"),
    [connections],
  );
  // External driver profiles are registered asynchronously. Keep capability
  // dependent editor controls (catalog selector and LSP language) reactive
  // when an installed package becomes active.
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );
  const driver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;

  const {
    capabilities,
    canBrowseDatabaseCatalogs,
    configuredCatalogDatabase,
    postgresDatabaseDiscovery,
    catalogDatabases,
  } = useEditorConnectionCatalog({
    activeConnection,
    driverCatalogStatus,
    driver,
    activeProjectId,
    effectiveConnectionId,
    connectedConnectionIds,
    metadataVersion,
  });

  const documentIdentity = useMemo(
    () => editorDocumentIdentity({ tab: activeTab, driver, capabilities }),
    [activeTab, capabilities, driver],
  );
  const {
    isProjectFilePreview,
    projectFileLanguage: activeProjectFileLanguage,
    documentLanguageId,
    documentUri,
    editorLanguageId,
    canUseLsp,
    usesGenericSqlLsp,
    isElasticsearchConsole,
  } = documentIdentity;
  const isMongoDbConsole = documentLanguageId === "mongodb";
  const preferredElasticsearchIndex = isElasticsearchConsole
    ? activeTab?.tableName || activeTab?.targetSchema || undefined
    : undefined;
  const elasticsearchMetadataNamespace =
    activeTab?.targetSchema ||
    currentSchema ||
    activeConnection?.database ||
    "default";
  const activeDocumentSql = activeTab?.sql || "";

  const { elasticsearchServerVersion } = useEditorServerVersion({
    isElasticsearchConsole,
    effectiveConnectionId,
    connectedConnectionIds,
    mountedEditor,
  });

  const { handleEditorContentChange } = useEditorDocumentContent({
    updateTabSql,
    effectiveTabId,
    isElasticsearchConsole,
  });

  const elasticsearchVariableNames = useMemo(
    () =>
      isElasticsearchConsole
        ? elasticsearchConsoleVariableNames(activeDocumentSql)
        : [],
    [activeDocumentSql, isElasticsearchConsole],
  );
  const {
    resolveDangerousExecution,
    restoreDangerousExecutionFocus,
    confirmEditorExecution,
    dangerousExecution,
  } = useEditorExecutionConfirmation({
    editorRef,
    driver,
    editorSettings,
  });

  const { executionNotice, showExecutionNotice, showNoExecutableTarget } =
    useEditorExecutionNotice({});

  const canExecuteDocument =
    !isProjectFilePreview &&
    !activeTab?.agentFileDiffPreview &&
    !activeTab?.gitFileDiffPreview &&
    (!activeProjectFileLanguage || activeProjectFileLanguage.executable);
  const supportsTransactions =
    capabilities.supportsTransactions && !activeTab?.databaseName;
  const {
    transactionMode,
    transactionState: activeTransactionState,
    transactionOperation,
    transactionIdForExecution,
    handleTransactionModeChange,
    handleBeginTransaction,
    handleCommitTransaction,
    handleRollbackTransaction,
  } = useQueryTransactionController({
    tabs: tabContexts,
    connections,
    activeConnectionId,
    activeTabId: activeTab?.id,
    activeTargetSchema: activeTab?.targetSchema,
    effectiveConnectionId,
    currentSchema,
    supportsTransactions,
    loadSchemas,
    loadTables,
    bumpMetadataVersion,
  });
  const {
    parameterExecution,
    handleRun,
    handleRunCurrent,
    handleCancelRun,
    handleConfigureParameters,
    handleExplain,
    handleRunParameterizedSql,
    closeParameterExecution,
  } = useQueryExecutionController({
    activeTab,
    connectionId: effectiveConnectionId,
    connectionLabel: activeConnection?.name,
    canExecute: canExecuteDocument,
    driver,
    kind: isElasticsearchConsole
      ? "elasticsearch"
      : isMongoDbConsole
        ? "mongodb"
        : "sql",
    executeAllOnBlankLine: editorSettings.executeAllOnBlankLine,
    supportsExplainPlan: capabilities.supportsExplainPlan,
    confirmExecution: confirmEditorExecution,
    onNoExecutableTarget: showNoExecutableTarget,
    editorRef,
    transactionIdForExecution,
    updateTabSql,
    runTabQuery,
    runExplainPlan,
    cancelTabQuery,
  });
  const canPreviewChanges = Boolean(
    canExecuteDocument &&
      capabilities.supportsSqlQuery &&
      effectiveConnectionId &&
      looksLikeDmlStatement(currentPreviewSql),
  );
  const { handlePreviewChanges, isPreviewingChanges } = useEditorChangePreview({
    currentPreviewSql,
    activeTab,
    effectiveConnectionId,
    canPreviewChanges,

    showExecutionNotice,
    editorRef,

    driver,
    capabilities,
    currentSchema,
    previewChangesActionRef,
    canPreviewChangesRef,
    previewChangesContextRef,
  });

  const sqlScriptImportContextKey =
    activeTab?.id && effectiveConnectionId
      ? `${activeTab.id}:${effectiveConnectionId}`
      : null;
  const {
    pendingImport: pendingSqlScriptImport,
    isReviewing: isSqlScriptReviewing,
    isImporting: isSqlScriptImporting,
    requestImport: requestSqlScriptImport,
    confirmImport: handleConfirmSqlScriptImport,
    closeImport: closeSqlScriptImport,
  } = useSqlScriptImportController({
    activeContextKey: sqlScriptImportContextKey,
    availabilityKey: connectionAvailabilityKey,
    isTargetAvailable: (target) =>
      connections.some((connection) => connection.id === target.connectionId),
    refreshMetadata: async (target) => {
      await loadSchemas(target.connectionId, true);
      if (target.schema) {
        await loadTables(target.connectionId, target.schema, true);
      }
      bumpMetadataVersion();
    },
  });
  const handleImportSqlScript = useCallback(() => {
    if (
      !effectiveConnectionId ||
      !activeTab ||
      !capabilities.supportsSqlQuery ||
      !sqlScriptImportContextKey
    ) {
      return;
    }
    void requestSqlScriptImport({
      connectionId: effectiveConnectionId,
      schema: activeTab.targetSchema ?? currentSchema ?? undefined,
      database: activeTab.databaseName,
      label: activeConnection?.name || effectiveConnectionId,
      driver,
      contextKey: sqlScriptImportContextKey,
    });
  }, [
    activeConnection?.name,
    activeTab,
    capabilities.supportsSqlQuery,
    currentSchema,
    driver,
    effectiveConnectionId,
    requestSqlScriptImport,
    sqlScriptImportContextKey,
  ]);
  const {
    operation: consoleFileOperation,
    handleImportConsoleRequests,
    handleExportConsoleRequests,
  } = useConsoleFileController({
    activeTab,
    enabled: isElasticsearchConsole,
    editorRef,
    updateTabSql,
  });
  const editorFileOperation: "sql-review" | "sql-import" | "console-import" | "console-export" | null = isSqlScriptReviewing
    ? "sql-review"
    : isSqlScriptImporting
      ? "sql-import"
      : consoleFileOperation
        ? (`console-${consoleFileOperation}` as const)
        : null;
  const monaco = useMonaco();
  const {
    isReady: lspReady,
    status: lspStatus,
    error: lspError,
    client: lspClient,
    sessionKey: lspSessionKey,
  } = useLspClient({
    connectionId: effectiveConnectionId,
    driver,
    capabilities,
    enabled: Boolean(activeTab && effectiveConnectionId && canUseLsp),
  });
  const {
    openedDocumentsRef,
    documentVersionsRef,
    documentTextsRef,
    completionRequestGenerationRef,
  } = useLspDocumentLifecycle({
    activeTabId: activeTab?.id,
    activeDocumentText: activeDocumentSql,
    canUseLsp,
    documentLanguageId,
    documentUri,
    lifecycleKey: driverCatalogStatus,
    lspClient,
    lspReady,
    lspSessionKey,
    monaco,
    tabs: tabContexts,
  });
  const lspSemanticStatus = useLspSemanticStatusStore((state) =>
    effectiveConnectionId
      ? state.byConnectionId[effectiveConnectionId]
      : undefined,
  );
  const lspSemanticPresentation =
    lspSemanticStatusPresentation(lspSemanticStatus);
  const visibleLspSemanticPresentation = lspReady
    ? lspSemanticPresentation
    : null;
  const parameterTargetSql =
    activeTab?.editorSelection?.text?.trim() || activeTab?.sql || "";
  const parameterCount = useMemo(
    () => extractSqlParameters(parameterTargetSql, driver).length,
    [driver, parameterTargetSql],
  );

  useEffect(() => {
    activeTabIdRef.current = effectiveTabId;
  }, [effectiveTabId]);

  useMonacoEditorViewState({
    editor: mountedEditor,
    ownerKey: effectiveTabId ? `${effectiveTabId}\u0000${documentUri}` : "",
    initialSelection: activeTab?.editorViewSelection,
    initialViewport: activeTab?.editorViewport,
    onCursorPositionChange: setCursorPosition,
    onSelectionChange: (selection, viewSelection) => {
      const currentTabId = activeTabIdRef.current;
      if (currentTabId) {
        setEditorSelection(currentTabId, selection, viewSelection);
      }
    },
    onViewportChange: (viewport) => {
      const currentTabId = activeTabIdRef.current;
      if (currentTabId) setEditorViewport(currentTabId, viewport);
    },
  });

  useConsoleAutoSuggest({
    editor: mountedEditor,
    ownerKey: effectiveTabId ? `${effectiveTabId}\u0000${documentUri}` : "",
  });

  useEffect(() => {
    if (!isProjectFilePreview) return;
    editorRef.current = null;
    setMountedEditor(null);
  }, [isProjectFilePreview]);

  useEditorKeyboardBindings({
    inlineKeysContextRef,
    vimControllerRef,
    vimModeRef,
    mountedEditor,
    editorSettings,
    isActivePane,
    vimStatusNodeRef,
    activeTabIdRef,
    onVimWindowNavigate,
    monaco,
    keymap,
  });

  // MongoDB uses the native JSON command contract rather than the SQL LSP.
  // Register a document-gated provider so Mongo semantic candidates neither
  // leak into ordinary JSON files nor wait for an LSP that intentionally has
  // no SQL builtins for this document driver.
  useMongoCompletionProvider({
    isActivePane,
    monaco,
    isMongoDbConsole,
    effectiveConnectionId,
    activeTab,
    currentSchema,
    activeConnection,
    activeProjectId,
    schemaCollections,
    activeConnectionId,
    effectiveTabId,
    retriggerActiveDocumentCompletion,
  });

  // Mapping fields must remain available even while the full LSP catalog is
  // still synchronizing. Load only the index under the cursor and reuse the
  // same metadata cache as Explorer/Table views.
  useElasticsearchCompletionProvider({
    isActivePane,
    monaco,
    isElasticsearchConsole,
    effectiveConnectionId,
    effectiveTabId,
    preferredElasticsearchIndex,
    retriggerActiveDocumentCompletion,
    activeProjectId,
    elasticsearchMetadataNamespace,
    lspReady,
    canUseLsp,
    documentLanguageId,
    lspClient,
    openedDocumentsRef,
    documentVersionsRef,
    documentTextsRef,
    documentUri,
  });

  // Keep cached relation completion available while the semantic server is
  // starting or recovering. It is deliberately limited to existing Explorer
  // metadata and relation-only SQL contexts; the full LSP still owns fields,
  // keywords, diagnostics, and every vendor-specific proposal once ready.
  const {
    usageScope,
    applyBatchColumnSelection,
    batchColumnSession,
    setBatchColumnSession,
  } = useQuerySqlCompletion({
    activeProjectId,
    effectiveConnectionId,
    currentSchema,
    activeTab,
    driver,
    metadataVersion,
    schemaTables,
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
  });

  const { inlineCompletionStatus } = useEditorLanguageServices({
    activeProjectId,
    canUseLsp,
    documentUri,
    editorLanguageId,
    isActivePane,
    lspClient,
    monaco,
    currentSchema,
    activeTab,
    documentLanguageId,
    documentTextsRef,
    documentVersionsRef,
    driver,
    effectiveConnectionId,
    mountedEditor,
    editorSettings,
    capabilities,
    metadataVersion,
    openedDocumentsRef,
    schemaTables,
    isElasticsearchConsole,
    preferredElasticsearchIndex,
    elasticsearchServerVersion,
    lspReady,
    usageScope,
    lspSessionKey,
    setLspDiagnostics,
  });

  // Initialize targetSchema from currentSchema if not set
  useEffect(() => {
    if (activeTab && activeTab.targetSchema === undefined && currentSchema) {
      setTargetSchema(activeTab.id, currentSchema);
    }
  }, [activeTab, currentSchema, setTargetSchema]);

  // Close dropdown on click outside - COMMENTED OUT UNUSED
  // useEffect(() => { ... }, []);

  const { openHistoryInEditor, rerunHistory } = createEditorHistoryActions({
    connections,
    effectiveConnectionId,
    confirmEditorExecution,
    connectedConnectionIds,
  });

  useEditorApplicationEvents({
    isActivePane,
    runAllActionRef,
    runCurrentActionRef,
    formatActionRef,
    editorRef,
    effectiveTabId,
  });

  const handleSchemaChange = (schema: string) => {
    if (activeTab) {
      setTargetSchema(activeTab.id, schema);
    }
  };

  const handleDatabaseChange = (database: string) => {
    if (!activeTab || !canBrowseDatabaseCatalogs) return;
    setTargetDatabase(
      activeTab.id,
      database === configuredCatalogDatabase ? null : database,
    );
  };

  const { handleFormat } = useEditorFormatting({
    editorRef,
    isElasticsearchConsole,
  });

  runAllActionRef.current = handleRun;
  runCurrentActionRef.current = handleRunCurrent;
  formatActionRef.current = handleFormat;

  useElasticsearchAnalysis({
    monaco,
    mountedEditor,
    isElasticsearchConsole,
    elasticsearchAnalysisRequestIdRef,
    elasticsearchRequestLinesRef,
    elasticsearchDecorationIdsRef,
    elasticsearchAnalysisApplyRef,
    elasticsearchAnalysisWorkerRef,
    runCurrentActionRef,
    elasticsearchAnalysisTimerRef,
    documentUri,
    activeDocumentSql,
    runAllActionRef,
    formatActionRef,
  });

  useSqlEditorIntentions({
    monaco,
    mountedEditor,
    isElasticsearchConsole,
    capabilities,
    canPreviewChangesRef,
    previewChangesContextRef,
    completionTriggerOriginRef,
    previewChangesActionRef,
    driver,
  });

  const { mode, editorOptions, handleEditorMount, handleEditorBeforeMount } =
    useEditorPresentation({
      editorSettings,
      isElasticsearchConsole,
      editorRef,
      setMountedEditor,
      inlineKeysContextRef,
      monaco,
      mountedEditor,
      editorLanguageId,
      documentUri,
    });

  useCurrentStatementDecoration({
    connectionId: effectiveConnectionId || "",
    editor: mountedEditor,
    enabled: Boolean(
      canExecuteDocument &&
        (capabilities.supportsSqlQuery || isMongoDbConsole) &&
        effectiveConnectionId &&
        !isElasticsearchConsole,
    ),
    isMongoDbConsole,
    monaco,
    ownerKey: effectiveTabId ? `${effectiveTabId}\u0000${documentUri}` : "",
    onCurrentStatementChange: setCurrentPreviewSql,
  });
  const canAcceptExplorerTableDrop = Boolean(
    activeTab &&
      mountedEditor &&
      capabilities.supportsSqlQuery &&
      !isProjectFilePreview &&
      !activeTab.agentFileDiffPreview &&
      !activeTab.gitFileDiffPreview,
  );
  useExplorerTableDrop({
    tableDropCaretRef,
    canAcceptExplorerTableDrop,
    mountedEditor,
    tableDropTargetRef,
  });

  const { handleSavedSqlDragOver, handleSavedSqlDrop } = useSavedQueryDrop({
    canAcceptExplorerTableDrop,
    mountedEditor,
    activeProjectId,
    openSavedSqlFile,
  });


  return {
    activeTab,
    activeProjectFileLanguage,
    activeProjectId,
    activeTransactionState,
    applyBatchColumnSelection,
    applyEditorPatchPreview,
    batchColumnSession,
    canAcceptExplorerTableDrop,
    canBrowseDatabaseCatalogs,
    canExecuteDocument,
    canPreviewChanges,
    capabilities,
    catalogDatabases,
    closeParameterExecution,
    closeSqlScriptImport,
    configuredCatalogDatabase,
    connectedConnectionIds,
    currentSchema,
    cursorPosition,
    dangerousExecution,
    dismissEditorPatch,
    documentUri,
    driver,
    editorSettings,
    canUseLsp,
    editorFileOperation,
    editorLanguageId,
    editorOptions,
    editorRef,
    effectiveConnectionId,
    elasticsearchVariableNames,
    executionNotice,
    handleBeginTransaction,
    handleCancelRun,
    handleCommitTransaction,
    handleConfigureParameters,
    handleConfirmSqlScriptImport,
    handleDatabaseChange,
    handleEditorBeforeMount,
    handleEditorContentChange,
    handleEditorMount,
    handleExplain,
    handleExportConsoleRequests,
    handleFormat,
    handleImportConsoleRequests,
    handleImportSqlScript,
    handlePreviewChanges,
    handleRollbackTransaction,
    handleRun,
    handleRunCurrent,
    handleRunParameterizedSql,
    handleSchemaChange,
    handleTransactionModeChange,
    handleSavedSqlDragOver,
    handleSavedSqlDrop,
    inlineCompletionStatus,
    isElasticsearchConsole,
    isPreviewingChanges,
    isProjectFilePreview,
    isSqlScriptImporting,
    lspError,
    lspReady,
    lspStatus,
    mode,
    openHistoryInEditor,
    openSavedSqlFile,
    parameterCount,
    parameterExecution,
    pendingSqlScriptImport,
    pendingToolbarExecutionSnapshotRef,
    postgresDatabaseDiscovery,
    resolveDangerousExecution,
    restoreDangerousExecutionFocus,
    rerunHistory,
    savedQueries,
    saveQuery,
    deleteQuery,
    setBatchColumnSession,
    setElasticsearchVariables,
    setQueryLanguage,
    supportsTransactions,
    tableDropCaretRef,
    tableDropTargetRef,
    transactionMode,
    transactionOperation,
    updateSavedSqlFile,
    usesGenericSqlLsp,
    vimStatusNodeRef,
    visibleLspSemanticPresentation,
  };
}

export type QueryEditorController = ReturnType<typeof useQueryEditorController>;
