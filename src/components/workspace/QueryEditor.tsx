import { useConnectionStore } from "@/store/useConnectionStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import {
  querySchemaContextForTab,
  useTabStore,
} from "@/store/useTabStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { EditorActionBar } from "./EditorActionBar";
import { ThemeContext } from "@/theme/ThemeProvider";
import Editor, { DiffEditor, useMonaco } from "@monaco-editor/react";
import type { Selection } from "monaco-editor";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useContext,
  useMemo,
} from "react";
import {
  connectionService,
  databaseService,
  queryService,
  schemaService,
  type DatabaseCapabilities,
} from "@/services/tauri";
import { useLspClient } from "@/hooks/useLspClient";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  lspLanguageId,
  lspLanguageIdForCapabilities,
  lspServerDialectForCapabilities,
} from "@/lib/databaseDialect";
import {
  completionFilterText,
  completionInsertText,
  filterCompletionsForSqlContext,
  isCompletedSqlContextKeyword,
  sqlContextKeywordBeforeCursor,
  toLspCompletionContext,
  toMonacoCompletionKind,
} from "@/lib/lspCompletion";
import {
  extractLspDocumentIdentity,
  extractSqlDocumentTabId,
  LSP_NOTIFICATION_EVENT,
} from "@/services/lsp";
import type { LspServerNotification } from "@/services/lsp";
import type { LspCancellationToken } from "@/services/lsp/client";
import { CompletionItemKind } from "@/services/lsp/types";
import {
  APP_EVENT_RUN_QUERY,
  APP_EVENT_RUN_CURRENT,
  APP_EVENT_FORMAT_SQL,
  APP_EVENT_INSERT_LINE_BELOW,
  APP_EVENT_INLINE_COMPLETION_ACCEPT,
  APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD,
  APP_EVENT_INLINE_COMPLETION_HIDE,
  APP_EVENT_INLINE_COMPLETION_TRIGGER,
} from "@/lib/actionEvents";
import { editorExecutionConfirmation } from "@/lib/sqlExecutionGate";
import {
  completionUsageScore,
  completionUsageScope,
  recordCompletionUsage,
  usageRankedCompletionSortText,
} from "@/lib/completionUsage";
import { StatusBarPortal } from "./StatusBarPortal";
import {
  Image as ImageIcon,
  LockKeyhole,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeKeybinding } from "@/lib/keybindings";
import { redactSecretString } from "@/lib/redaction";
import {
  attachVimMode,
  APP_EVENT_VIM_WINDOW_NAVIGATE,
  restoreStandardEditorState,
  type VimModeController,
  type VimWindowNavigation,
} from "@/lib/vimMode";
import { saveProjectFileTab } from "@/lib/projectFileTabs";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useLspSemanticStatusStore } from "@/store/useLspSemanticStatusStore";
import { lspSemanticStatusPresentation } from "@/lib/lspSemanticStatus";
import { usePostgresDatabaseDiscovery } from "@/hooks/usePostgresDatabaseDiscovery";
import { connectionCatalogDatabaseName } from "./PostgresDatabaseTree";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { extractSqlParameters } from "@/lib/sqlParameters";
import { SqlParametersPanel } from "./SqlParametersPanel";
import { SqlScriptImportDialog } from "./SqlScriptImportDialog";
import { aiService } from "@/services/tauri/ai.service";
import { projectFilesService } from "@/services/tauri/project-files.service";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import {
  documentMetadataCacheKey,
  invalidateDocumentMetadataScope,
  loadDocumentMetadata,
} from "@/services/documentMetadataCache";
import { ProjectFileImagePreview } from "./ProjectFileImagePreview";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";
import {
  APP_EVENT_REVEAL_EDITOR_RANGE,
  requestEditorRangeReveal,
  type EditorRangeNavigationDetail,
} from "@/lib/editorNavigation";
import { documentTextRevision } from "@/lib/documentRevision";
import { applyEditorTextPatch } from "@/lib/editorPatch";
import {
  analyzePatchExplainPlan,
  completePatchSqlDocuments,
  comparePatchExplainPlans,
  reviewRuntimeExplainPlan,
} from "@/lib/explainPlanComparison";
import { EditorPatchPreviewPanel } from "./EditorPatchPreviewPanel";
import { AgentFileDiffReviewBar } from "./AgentFileDiffReviewBar";
import { GitFileDiffReviewBar } from "./GitFileDiffReviewBar";
import type { QueryHistoryItem } from "@/lib/queryHistory";
import {
  boundedInlineContext,
  cleanInlineSuggestion,
  inlineCompletionCacheKey,
  InlineCompletionCache,
  localInlineSuggestion,
  mergeInlineCompletionCandidates,
  shouldRequestAiInlineCompletion,
  type InlineCompletionStatus,
} from "@/lib/inlineCompletion";
import {
  elasticsearchRequestNavigationOffset,
  elasticsearchRequestsForSelection,
  elasticsearchConsoleCompletionContext,
  elasticsearchCompletionExpectsMappingField,
  elasticsearchConsoleInlineSuggestion,
  elasticsearchMappingFieldCompletions,
  elasticsearchConsoleRequestContext,
  elasticsearchSchemaCompletionsForContext,
  elasticsearchConsoleVariableNames,
  ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS,
  ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
  formatElasticsearchConsole,
  registerElasticsearchConsoleLanguage,
  validateElasticsearchConsole,
} from "@/lib/elasticsearchConsole";
import {
  buildMongoDbConsoleCompletions,
  mongodbConsoleCompletionContext,
} from "@/lib/mongodbCompletion";
import type { ElasticsearchAnalysisResponse } from "@/workers/elasticsearchAnalysis.worker";
import type { ElasticsearchServerVersion } from "@/lib/elasticsearchConsole";
import {
  buildRedisCompletionItems,
  getRedisCompletionContext,
  takesRedisKeyArgument,
} from "@/lib/redisCompletion";
import {
  loadRedisCommandDocumentation,
  loadRedisCompletionKeys,
} from "@/lib/redisCompletionSource";
import { useSqlScriptImportController } from "@/features/sql-script-import";
import {
  buildQueryEditorOptions,
  appendSqlCompletionSpace,
  boundedSqlCompletionTextBeforeCursor,
  elasticsearchJsonStringCompletionRange,
  editorDocumentIdentity,
  completionLabelForMonaco,
  completionResolveRequestContext,
  isPublishDiagnosticsParams,
  lspDiagnosticToMonacoMarker,
  lspCompletionItemsToMonacoSuggestions,
  markResolvableLspCompletionItems,
  sourceLspCompletionItem,
  applyResolvedLspCompletionItem,
  limitCompletionSuggestions,
  mergeCatalogNames,
  mergeCompletionFallbackSuggestions,
  parseElasticsearchConsoleServerVersion,
  quoteSqlIdentifierSelection,
  insertLineBelow,
  recordSqlCompletionTelemetry,
  shouldApplyLspDiagnostics,
  shouldChainSqlCompletionAfterAccept,
  sqlInListFromClipboard,
  sqlSyntaxFallbackCompletions,
  sqlCompletionItemType,
  sqlCompletionTriggerDecision,
  syncLspModelBeforeCompletion,
  unquoteSqlIdentifierSelection,
  useConsoleFileController,
  useLspCompletionProviderCoordinator,
  useCachedSqlCompletionSource,
  useConsoleAutoSuggest,
  useCurrentStatementDecoration,
  useMonacoEditorViewState,
  useLspCoreProviderCoordinator,
  useLspHoverProviderCoordinator,
  useLspDocumentLifecycle,
  useQueryExecutionController,
  useQueryTransactionController,
} from "@/features/query-editor";
import { isCompletionRequestCurrent } from "@/features/query-editor/model/completionRequestGuard";

const RECORD_COMPLETION_USAGE_COMMAND = "oxide.sqlCompletion.recordUsage";
const MAX_QUERY_EDITOR_COMPLETION_SUGGESTIONS = 640;

function createInlineCompletionRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `inline-${crypto.randomUUID()}`;
  }
  return `inline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toMonacoKeybinding(monaco: any, binding: string) {
  const parts = normalizeKeybinding(binding).split("+").filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const namedKeys: Record<string, number | undefined> = {
    tab: monaco.KeyCode.Tab,
    enter: monaco.KeyCode.Enter,
    escape: monaco.KeyCode.Escape,
    space: monaco.KeyCode.Space,
    arrowleft: monaco.KeyCode.LeftArrow,
    arrowright: monaco.KeyCode.RightArrow,
    arrowup: monaco.KeyCode.UpArrow,
    arrowdown: monaco.KeyCode.DownArrow,
    "\\": monaco.KeyCode.Backslash,
  };
  const keyCode =
    namedKeys[key] ||
    (key.length === 1 && /[a-z]/.test(key)
      ? monaco.KeyCode[`Key${key.toUpperCase()}`]
      : key.length === 1 && /\d/.test(key)
        ? monaco.KeyCode[`Digit${key}`]
        : undefined);
  if (!keyCode) return null;
  return (
    keyCode |
    (parts.includes("mod") ? monaco.KeyMod.CtrlCmd : 0) |
    (parts.includes("alt") ? monaco.KeyMod.Alt : 0) |
    (parts.includes("shift") ? monaco.KeyMod.Shift : 0)
  );
}

function mongodbJsonStringCompletionRange(
  monaco: any,
  model: any,
  position: any,
) {
  const line = model.getLineContent(position.lineNumber);
  const cursorIndex = position.column - 1;
  let openQuote = -1;
  let escaping = false;

  for (let index = 0; index < cursorIndex; index += 1) {
    const character = line[index];
    if (openQuote >= 0) {
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === '"') openQuote = -1;
    } else if (character === '"') {
      openQuote = index;
    }
  }

  if (openQuote >= 0) {
    let closingQuote = cursorIndex;
    escaping = false;
    for (; closingQuote < line.length; closingQuote += 1) {
      const character = line[closingQuote];
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === '"') break;
    }
    return new monaco.Range(
      position.lineNumber,
      openQuote + 2,
      position.lineNumber,
      closingQuote + 1,
    );
  }

  const word = model.getWordUntilPosition(position);
  return new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
}

interface QueryEditorProps {
  tabId?: string | null;
  isActivePane?: boolean;
  onActivate?: () => void;
  editorGroupId?: string;
  onVimWindowNavigate?: (direction: VimWindowNavigation) => void;
}

export function QueryEditor({
  tabId,
  isActivePane = true,
  onActivate,
  editorGroupId,
  onVimWindowNavigate,
}: QueryEditorProps = {}) {
  const storeActiveTabId = useTabStore((state) => state.activeTabId);
  const effectiveTabId = tabId === undefined ? storeActiveTabId : tabId;
  const activeTab = useTabStore((state) =>
    state.tabs.find((candidate) => candidate.id === effectiveTabId),
  );
  const tabContextSignature = useTabStore((state) =>
    state.tabs
      .map((candidate) =>
        [candidate.id, candidate.type, candidate.connectionId || ""].join("\u0001"),
      )
      .join("\u0000"),
  );
  const tabContexts = useMemo(
    () =>
      useTabStore.getState().tabs.map((candidate) => ({
        id: candidate.id,
        type: candidate.type,
        connectionId: candidate.connectionId,
      })),
    [tabContextSignature],
  );
  const {
    updateTabSql,
    setQueryLanguage,
    setElasticsearchVariables,
    runTabQuery,
    runExplainPlan,
    cancelTabQuery,
    setTargetSchema,
    setTargetDatabase,
    setEditorSelection,
    setEditorViewport,
    setLspDiagnostics,
    applyEditorPatchPreview,
    dismissEditorPatch,
  } = useTabStore(
    useShallow((state) => ({
      updateTabSql: state.updateTabSql,
      setQueryLanguage: state.setQueryLanguage,
      setElasticsearchVariables: state.setElasticsearchVariables,
      runTabQuery: state.runTabQuery,
      runExplainPlan: state.runExplainPlan,
      cancelTabQuery: state.cancelTabQuery,
      setTargetSchema: state.setTargetSchema,
      setTargetDatabase: state.setTargetDatabase,
      setEditorSelection: state.setEditorSelection,
      setEditorViewport: state.setEditorViewport,
      setLspDiagnostics: state.setLspDiagnostics,
      applyEditorPatchPreview: state.applyEditorPatchPreview,
      dismissEditorPatch: state.dismissEditorPatch,
    })),
  );
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const connections = useConnectionStore((state) => state.connections);
  const connectedConnectionIds = useConnectionStore(
    (state) => state.connectedConnectionIds,
  );
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const schemaTables = useSchemaStore((state) => state.tables);
  const schemaCollections = useSchemaStore((state) => state.collections);
  const metadataVersion = useSchemaStore((state) => state.metadataVersion);
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const loadTables = useSchemaStore((state) => state.loadTables);
  const bumpMetadataVersion = useSchemaStore(
    (state) => state.bumpMetadataVersion,
  );
  const { savedQueries, saveQuery, deleteQuery } = useSavedQueryStore();
  const editorSettings = useSettingsStore((state) => state.settings.editor);
  const keymap = useSettingsStore((state) => state.settings.keymap);
  const inlineProviderConfig = useAiSettingsStore(
    (state) => state.inlineProviderConfig,
  );
  const inlineCompletionProtocol = useAiSettingsStore(
    (state) => state.inlineCompletionProtocol,
  );
  const inlineCompletionModel = useAiSettingsStore(
    (state) => state.inlineCompletionModel,
  );
  const projectId = useProjectFilesStore((state) => state.projectId);
  const projectRootPath = useProjectFilesStore((state) => state.rootPath);

  // const [saveName, setSaveName] = useState("");
  // const [isSaveOpen, setIsSaveOpen] = useState(false);
  // const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [executionNotice, setExecutionNotice] = useState<string | null>(null);
  const [inlineCompletionStatus, setInlineCompletionStatus] =
    useState<InlineCompletionStatus>("off");
  const [elasticsearchServerVersion, setElasticsearchServerVersion] =
    useState<ElasticsearchServerVersion | undefined>();
  // const dropdownRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const [mountedEditor, setMountedEditor] = useState<any>(null);
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
  const inlineCompletionCacheRef = useRef(new InlineCompletionCache());
  const inlineCompletionAbortRef = useRef<AbortController | null>(null);
  const inlineCompletionListenersRef = useRef(new Set<() => void>());
  const runAllActionRef = useRef<() => void>(() => {});
  const runCurrentActionRef = useRef<() => void>(() => {});
  const formatActionRef = useRef<() => void>(() => {});
  const executionNoticeTimerRef = useRef<number | null>(null);
  const elasticsearchAnalysisWorkerRef = useRef<Worker | null>(null);
  const elasticsearchAnalysisTimerRef = useRef<number | null>(null);
  const elasticsearchAnalysisRequestIdRef = useRef(0);
  const elasticsearchAnalysisApplyRef = useRef<
    ((response: ElasticsearchAnalysisResponse) => void) | null
  >(null);
  const elasticsearchDecorationIdsRef = useRef<string[]>([]);
  const elasticsearchRequestLinesRef = useRef<Set<number>>(new Set());
  const documentMetadataVersionRef = useRef(metadataVersion);
  const pendingElasticsearchSqlRef = useRef<{
    tabId: string;
    value: string;
  } | null>(null);
  const pendingElasticsearchSqlTimerRef = useRef<number | null>(null);
  const effectiveConnectionId = activeTab?.connectionId || activeConnectionId;
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
  const [connectionCapabilities, setConnectionCapabilities] = useState<{
    connectionId: string;
    capabilities: DatabaseCapabilities;
  } | null>(null);
  useEffect(() => {
    if (!activeConnection) {
      setConnectionCapabilities(null);
      return;
    }
    let cancelled = false;
    setConnectionCapabilities(null);
    const liveCapabilityRequest =
      typeof databaseService.getConnectionDatabaseCapabilityContext ===
      "function"
        ? databaseService
            .getConnectionDatabaseCapabilityContext(activeConnection.id)
            .then((context) => context.capabilities)
        : Promise.reject(new Error("Live capability context unavailable"));
    void liveCapabilityRequest
      .catch(() =>
        databaseService.getDatabaseCapabilities(
          activeConnection.driver,
          activeConnection.driverPackageVersion,
        ),
      )
      .then((nextCapabilities) => {
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            capabilities: nextCapabilities,
          });
        }
      })
      .catch((error) => {
        console.warn("Failed to load query-editor driver capabilities", error);
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            capabilities: defaultDatabaseCapabilities(activeConnection.driver),
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
  const capabilities = useMemo(() => {
    const resolvedCapabilities =
      connectionCapabilities &&
      connectionCapabilities.connectionId === activeConnection?.id
        ? connectionCapabilities.capabilities
        : null;
    return resolvedCapabilities?.driver.toLowerCase() === driver.toLowerCase()
      ? resolvedCapabilities
      : defaultDatabaseCapabilities(driver);
  }, [activeConnection?.id, connectionCapabilities, driver]);
  const canBrowseDatabaseCatalogs = Boolean(
    capabilities.supportsDatabaseCatalogs,
  );
  // Network catalog drivers retain one configured database on the connection.
  // File-backed engines such as DuckDB return an empty value here and discover
  // their primary catalog through metadata instead.
  const configuredCatalogDatabase =
    activeConnection && canBrowseDatabaseCatalogs
      ? connectionCatalogDatabaseName(activeConnection)
      : null;
  const postgresDatabaseDiscovery = usePostgresDatabaseDiscovery({
    projectId: activeProjectId,
    connectionId: effectiveConnectionId || null,
    driver: activeConnection?.driver,
    driverPackageVersion: activeConnection?.driverPackageVersion,
    connectionDatabaseName: activeConnection?.database,
    canBrowseDatabaseCatalogs,
    isConnectionReady: Boolean(
      effectiveConnectionId &&
      connectedConnectionIds.includes(effectiveConnectionId),
    ),
    refreshVersion: metadataVersion,
  });
  const catalogDatabases = useMemo(() => {
    if (!canBrowseDatabaseCatalogs) return [];
    const discovered =
      postgresDatabaseDiscovery.connectionId === effectiveConnectionId
        ? postgresDatabaseDiscovery.databases
        : [];
    return mergeCatalogNames(configuredCatalogDatabase, discovered);
  }, [
    canBrowseDatabaseCatalogs,
    configuredCatalogDatabase,
    effectiveConnectionId,
    postgresDatabaseDiscovery.connectionId,
    postgresDatabaseDiscovery.databases,
  ]);
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

  useEffect(() => {
    let cancelled = false;
    if (
      !isElasticsearchConsole ||
      !effectiveConnectionId ||
      !connectedConnectionIds.includes(effectiveConnectionId)
    ) {
      setElasticsearchServerVersion(undefined);
      return;
    }

    connectionService
      .getServerVersion(effectiveConnectionId)
      .then((version) => {
        if (cancelled) return;
        setElasticsearchServerVersion(
          parseElasticsearchConsoleServerVersion(version),
        );
      })
      .catch(() => {
        if (!cancelled) setElasticsearchServerVersion(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [connectedConnectionIds, effectiveConnectionId, isElasticsearchConsole]);

  useEffect(() => {
    const model = mountedEditor?.getModel?.() as
      | { __oxideElasticsearchServerVersion?: ElasticsearchServerVersion }
      | undefined;
    if (!model) return;
    model.__oxideElasticsearchServerVersion = isElasticsearchConsole
      ? elasticsearchServerVersion
      : undefined;
  }, [elasticsearchServerVersion, isElasticsearchConsole, mountedEditor]);

  const commitPendingElasticsearchSql = useCallback(() => {
    if (pendingElasticsearchSqlTimerRef.current !== null) {
      window.clearTimeout(pendingElasticsearchSqlTimerRef.current);
      pendingElasticsearchSqlTimerRef.current = null;
    }
    const pending = pendingElasticsearchSqlRef.current;
    pendingElasticsearchSqlRef.current = null;
    if (pending) updateTabSql(pending.tabId, pending.value);
  }, [updateTabSql]);

  const handleEditorContentChange = useCallback(
    (value: string | undefined) => {
      if (!effectiveTabId) return;
      const nextValue = value || "";
      if (!isElasticsearchConsole) {
        updateTabSql(effectiveTabId, nextValue);
        return;
      }

      pendingElasticsearchSqlRef.current = {
        tabId: effectiveTabId,
        value: nextValue,
      };
      if (pendingElasticsearchSqlTimerRef.current !== null) {
        window.clearTimeout(pendingElasticsearchSqlTimerRef.current);
      }
      pendingElasticsearchSqlTimerRef.current = window.setTimeout(
        commitPendingElasticsearchSql,
        120,
      );
    },
    [
      commitPendingElasticsearchSql,
      effectiveTabId,
      isElasticsearchConsole,
      updateTabSql,
    ],
  );

  useEffect(
    () => () => {
      commitPendingElasticsearchSql();
    },
    [effectiveTabId, commitPendingElasticsearchSql],
  );
  const elasticsearchVariableNames = useMemo(
    () =>
      isElasticsearchConsole
        ? elasticsearchConsoleVariableNames(activeDocumentSql)
        : [],
    [activeDocumentSql, isElasticsearchConsole],
  );
  const confirmEditorExecution = useCallback(
    (sql: string, executionDriver = driver) => {
      if (!editorSettings.confirmDestructiveSql) return true;
      const confirmation = editorExecutionConfirmation(sql, executionDriver);
      if (!confirmation.required) return true;
      return window.confirm(
        confirmation.message || "Execute this query?",
      );
    },
    [driver, editorSettings.confirmDestructiveSql],
  );
  const showNoExecutableTarget = useCallback(() => {
    setExecutionNotice("No executable statement at cursor");
    if (executionNoticeTimerRef.current !== null) {
      window.clearTimeout(executionNoticeTimerRef.current);
    }
    executionNoticeTimerRef.current = window.setTimeout(() => {
      executionNoticeTimerRef.current = null;
      setExecutionNotice(null);
    }, 3000);
  }, []);
  useEffect(
    () => () => {
      if (executionNoticeTimerRef.current !== null) {
        window.clearTimeout(executionNoticeTimerRef.current);
      }
    },
    [],
  );
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
  const editorFileOperation = isSqlScriptReviewing
    ? "sql-review"
    : isSqlScriptImporting
      ? "sql-import"
      : consoleFileOperation
        ? `console-${consoleFileOperation}` as const
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
    effectiveConnectionId ? state.byConnectionId[effectiveConnectionId] : undefined,
  );
  const lspSemanticPresentation = lspSemanticStatusPresentation(lspSemanticStatus);
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

  useEffect(() => {
    return () => {
      inlineKeysContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    vimControllerRef.current?.dispose();
    vimControllerRef.current = null;
    vimModeRef.current = "INSERT";
    inlineKeysContextRef.current?.set(true);

    if (mountedEditor) restoreStandardEditorState(mountedEditor);

    if (
      editorSettings.keybindingMode !== "vim" ||
      !mountedEditor ||
      !isActivePane
    ) {
      return;
    }

    let disposed = false;
    let attachedController: VimModeController | null = null;
    void attachVimMode({
      editor: mountedEditor,
      statusNode: vimStatusNodeRef.current,
      leader: editorSettings.vim.leader,
      mappings: editorSettings.vim.mappings,
      onModeChange: (mode) => {
        vimModeRef.current = mode;
        inlineKeysContextRef.current?.set(mode === "INSERT");
      },
      onWrite: () => saveProjectFileTab(activeTabIdRef.current || undefined),
      onQuit: () => {
        const activeId = activeTabIdRef.current;
        if (activeId) useTabStore.getState().closeTab(activeId);
      },
      onWriteQuit: async () => {
        const tabId = activeTabIdRef.current;
        if (!tabId || !(await saveProjectFileTab(tabId))) return;
        useTabStore.getState().closeTab(tabId);
      },
      onEdit: async (relativePath) => {
        try {
          await openProjectFileInEditor(relativePath);
        } catch (error) {
          const tabId = activeTabIdRef.current;
          if (!tabId) return;
          const message =
            error instanceof Error ? error.message : String(error);
          useTabStore.setState((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === tabId
                ? { ...tab, fileError: `Failed to open file: ${message}` }
                : tab,
            ),
          }));
        }
      },
      onWindowNavigate: (direction) => {
        if (onVimWindowNavigate) {
          onVimWindowNavigate(direction);
          return;
        }
        window.dispatchEvent(
          new CustomEvent(APP_EVENT_VIM_WINDOW_NAVIGATE, {
            detail: { direction, source: "editor" },
          }),
        );
      },
    })
      .then((controller) => {
        if (disposed) {
          controller.dispose();
          return;
        }
        attachedController = controller;
        vimControllerRef.current = controller;
      })
      .catch((error) => {
        if (disposed) return;
        console.error("Failed to initialize Vim mode", error);
        if (vimStatusNodeRef.current) {
          vimStatusNodeRef.current.textContent = "VIM unavailable";
        }
      });

    return () => {
      disposed = true;
      attachedController?.dispose();
      if (vimControllerRef.current === attachedController) {
        vimControllerRef.current = null;
      }
      vimModeRef.current = "INSERT";
      inlineKeysContextRef.current?.set(true);
      restoreStandardEditorState(mountedEditor);
    };
  }, [
    editorSettings.keybindingMode,
    editorSettings.vim.leader,
    editorSettings.vim.mappings,
    isActivePane,
    mountedEditor,
    onVimWindowNavigate,
  ]);

  useEffect(() => {
    if (!isActivePane || !mountedEditor) return;
    mountedEditor.focus();
  }, [isActivePane, mountedEditor]);

  useEffect(() => {
    inlineKeysContextRef.current?.set(
      editorSettings.keybindingMode !== "vim" ||
        vimModeRef.current === "INSERT",
    );
  }, [editorSettings.keybindingMode, mountedEditor]);

  useEffect(() => {
    if (!isActivePane || !mountedEditor) return;
    const run = (command: string) => {
      if (
        editorSettings.keybindingMode === "vim" &&
        vimModeRef.current !== "INSERT"
      ) {
        return;
      }
      mountedEditor.trigger("oxide-inline-completion", command, null);
    };
    const handlers: Array<[string, () => void]> = [
      [
        APP_EVENT_INLINE_COMPLETION_TRIGGER,
        () => run("editor.action.inlineSuggest.trigger"),
      ],
      [
        APP_EVENT_INLINE_COMPLETION_ACCEPT,
        () => run("editor.action.inlineSuggest.commit"),
      ],
      [
        APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD,
        () => run("editor.action.inlineSuggest.acceptNextWord"),
      ],
      [
        APP_EVENT_INLINE_COMPLETION_HIDE,
        () => run("editor.action.inlineSuggest.hide"),
      ],
    ];
    handlers.forEach(([event, handler]) =>
      window.addEventListener(event, handler),
    );
    return () => {
      handlers.forEach(([event, handler]) =>
        window.removeEventListener(event, handler),
      );
    };
  }, [editorSettings.keybindingMode, isActivePane, mountedEditor]);

  useEffect(() => {
    if (!monaco) return;
    const visibleWhen =
      "oxideInlineCompletionKeysEnabled && editorTextFocus && inlineSuggestionVisible && !suggestWidgetVisible";
    const rules: Array<{
      keybinding: number;
      command?: string | null;
      when?: string;
    }> = [];
    const addRules = (actionId: string, command: string, when: string) => {
      for (const binding of keymap[actionId] || []) {
        const keybinding = toMonacoKeybinding(monaco, binding);
        if (keybinding) rules.push({ keybinding, command, when });
      }
    };
    addRules(
      "editor.inlineCompletion.trigger",
      "editor.action.inlineSuggest.trigger",
      "oxideInlineCompletionKeysEnabled && editorTextFocus",
    );
    addRules(
      "editor.inlineCompletion.accept",
      "editor.action.inlineSuggest.commit",
      visibleWhen,
    );
    addRules(
      "editor.inlineCompletion.acceptNextWord",
      "editor.action.inlineSuggest.acceptNextWord",
      visibleWhen,
    );
    addRules(
      "editor.inlineCompletion.hide",
      "editor.action.inlineSuggest.hide",
      visibleWhen,
    );

    const normalizedAccept = (
      keymap["editor.inlineCompletion.accept"] || []
    ).map(normalizeKeybinding);
    const normalizedWord = (
      keymap["editor.inlineCompletion.acceptNextWord"] || []
    ).map(normalizeKeybinding);
    const normalizedHide = (keymap["editor.inlineCompletion.hide"] || []).map(
      normalizeKeybinding,
    );
    if (!normalizedAccept.includes("tab")) {
      rules.push({
        keybinding: monaco.KeyCode.Tab,
        command: null,
        when: visibleWhen,
      });
    }
    if (!normalizedWord.includes("mod+arrowright")) {
      rules.push({
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow,
        command: null,
        when: visibleWhen,
      });
    }
    if (!normalizedHide.includes("escape")) {
      rules.push({
        keybinding: monaco.KeyCode.Escape,
        command: null,
        when: visibleWhen,
      });
    }
    const disposable = monaco.editor.addKeybindingRules(rules);
    return () => disposable.dispose();
  }, [keymap, monaco]);

  useEffect(() => {
    if (documentMetadataVersionRef.current === metadataVersion) return;
    documentMetadataVersionRef.current = metadataVersion;
    if (!effectiveConnectionId) return;
    const projectScope = activeProjectId || "local";
    invalidateDocumentMetadataScope({
      projectId: projectScope,
      connectionId: effectiveConnectionId,
      driver: "mongodb",
    });
    invalidateDocumentMetadataScope({
      projectId: projectScope,
      connectionId: effectiveConnectionId,
      driver: "elasticsearch",
    });
  }, [activeProjectId, effectiveConnectionId, metadataVersion]);

  // MongoDB uses the native JSON command contract rather than the SQL LSP.
  // Register a document-gated provider so Mongo semantic candidates neither
  // leak into ordinary JSON files nor wait for an LSP that intentionally has
  // no SQL builtins for this document driver.
  useEffect(() => {
    if (
      !isActivePane ||
      !monaco ||
      !isMongoDbConsole ||
      !effectiveConnectionId
    ) {
      return;
    }

    const collectionNamespace =
      activeTab?.targetSchema ||
      currentSchema ||
      activeConnection?.database ||
      "";
    const collectionCacheKey = documentMetadataCacheKey({
      projectId: activeProjectId || "local",
      connectionId: effectiveConnectionId,
      driver: "mongodb",
      namespace: collectionNamespace,
      kind: "collections",
    });
    const loadCollections = () => {
      const knownCollections = schemaCollections
        .filter(
          (collection) =>
            !collectionNamespace ||
            !collection.namespace ||
            collection.namespace === collectionNamespace,
        )
        .map((collection) => collection.name)
        .filter(Boolean);
      const request = knownCollections.length > 0
        ? Promise.resolve(knownCollections)
        : schemaService
            .getCollections(effectiveConnectionId, collectionNamespace)
            .then((collections) => collections.map((collection) => collection.name));
      return loadDocumentMetadata(collectionCacheKey, () => request
        .then((collections) => [...new Set(collections.map((name) => name.trim()).filter(Boolean))])
        .catch((error) => {
          console.debug("[MongoDB Console] Collections unavailable", error);
          return [];
        }));
    };
    const loadFields = (collection: string) => {
      const cacheKey = documentMetadataCacheKey({
        projectId: activeProjectId || "local",
        connectionId: effectiveConnectionId,
        driver: "mongodb",
        namespace: collectionNamespace,
        kind: "fields",
        objectName: collection,
      });
      return loadDocumentMetadata(cacheKey, () =>
        loadTableMetadata({
          projectId: activeProjectId || undefined,
          connectionId: effectiveConnectionId,
          driver: "mongodb",
          schema: collectionNamespace,
          table: collection,
          includeIndexes: false,
          includeConstraints: false,
        })
          .then((metadata) =>
            metadata.columns.map((column) => ({
              name: column.name,
              dataType: column.data_type || "field",
            })),
          )
          .catch((error) => {
            console.debug(
              `[MongoDB Console] Fields unavailable for ${collection}`,
              error,
            );
            return [];
          }),
      );
    };

    const disposable = monaco.languages.registerCompletionItemProvider("json", {
      triggerCharacters: ['"', "{", "[", ",", ":", "$"],
      provideCompletionItems: async (
        model: any,
        position: any,
        _providerContext: any,
        token: { isCancellationRequested?: boolean },
      ) => {
        const identity = extractLspDocumentIdentity(model.uri.toString());
        if (identity?.tabId !== effectiveTabId || identity.driver !== "mongodb") {
          return { suggestions: [] };
        }
        const source = model.getValue();
        const offset = model.getOffsetAt(position);
        const initialVersion = model.getVersionId();
        const context = mongodbConsoleCompletionContext(source, offset);
        const needsCollections = context.area === "collection";
        const needsFields = context.area === "field";
        const [collections, fields] = await Promise.all([
          needsCollections ? loadCollections() : Promise.resolve([]),
          needsFields && context.collection
            ? loadFields(context.collection)
            : Promise.resolve([]),
        ]);
        if (
          token?.isCancellationRequested ||
          model.getVersionId() !== initialVersion
        ) {
          return { suggestions: [] };
        }
        const { items } = buildMongoDbConsoleCompletions(source, offset, {
          collections,
          fields,
        });
        const range = mongodbJsonStringCompletionRange(monaco, model, position);
        const kindMap = {
          property: monaco.languages.CompletionItemKind.Property,
          field: monaco.languages.CompletionItemKind.Field,
          operator: monaco.languages.CompletionItemKind.Operator,
          snippet: monaco.languages.CompletionItemKind.Snippet,
          value: monaco.languages.CompletionItemKind.Value,
        };
        return {
          incomplete: Boolean(needsCollections || needsFields),
          suggestions: items.map((item, index) => ({
            label: item.label,
            kind: kindMap[item.kind],
            detail: item.detail,
            documentation: item.documentation
              ? { value: item.documentation }
              : undefined,
            insertText: item.insertText,
            insertTextRules:
              item.kind === "snippet"
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            filterText: item.label,
            sortText: item.sortText || String(index).padStart(3, "0"),
            range,
          })),
        };
      },
    });
    return () => disposable.dispose();
  }, [
    activeConnection?.database,
    activeProjectId,
    activeTab?.targetSchema,
    currentSchema,
    effectiveConnectionId,
    effectiveTabId,
    isActivePane,
    isMongoDbConsole,
    monaco,
    schemaCollections,
  ]);

  // Mapping fields must remain available even while the full LSP catalog is
  // still synchronizing. Load only the index under the cursor and reuse the
  // same metadata cache as Explorer/Table views.
  useEffect(() => {
    if (
      !isActivePane ||
      !monaco ||
      !isElasticsearchConsole ||
      !effectiveConnectionId
    ) {
      return;
    }

    const disposable = monaco.languages.registerCompletionItemProvider(
      ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      {
        triggerCharacters: ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS,
        provideCompletionItems: async (
          model: any,
          position: any,
          providerContext: any,
          token: { isCancellationRequested?: boolean },
        ) => {
          const identity = extractLspDocumentIdentity(model.uri.toString());
          if (
            identity?.tabId !== effectiveTabId ||
            (identity.driver !== "elasticsearch" &&
              identity.driver !== "elastic")
          ) {
            return { suggestions: [] };
          }

          const source = model.getValue();
          const offset = model.getOffsetAt(position);
          const completionContext = elasticsearchConsoleCompletionContext(
            source,
            offset,
          );
          const expectsMappingField =
            elasticsearchCompletionExpectsMappingField(completionContext);
          const isIndexPath = completionContext.area === "path";
          if (!expectsMappingField && !isIndexPath) {
            return { suggestions: [] };
          }

          const requestContext = elasticsearchConsoleRequestContext(
            source,
            offset,
            preferredElasticsearchIndex,
          );
          const indexName = requestContext.index?.trim();
          if (expectsMappingField && !indexName) {
            return { suggestions: [] };
          }

          const modelVersion = model.getVersionId();
          let fieldCompletions: Array<{
            label: string;
            detail?: string;
            insertText?: string;
            sortText?: string;
          }> = [];
          if (isIndexPath) {
            const cacheKey = documentMetadataCacheKey({
              projectId: activeProjectId || "local",
              connectionId: effectiveConnectionId,
              driver: "elasticsearch",
              namespace: elasticsearchMetadataNamespace,
              kind: "collections",
            });
            const collections = await loadDocumentMetadata(cacheKey, () =>
              schemaService
                .getCollections(
                  effectiveConnectionId,
                  elasticsearchMetadataNamespace,
                )
                .then((collections) =>
                  collections
                    .map((collection) => ({
                      name: collection.name.trim(),
                      type: collection.type || "index",
                    }))
                    .filter((collection) => Boolean(collection.name)),
                )
                .catch((error) => {
                  console.debug(
                    "[Elasticsearch Console] Indices unavailable",
                    error,
                  );
                  return [];
                }),
            );
            fieldCompletions = elasticsearchSchemaCompletionsForContext(
              collections.map((collection) => ({
                label: collection.name,
                detail: `Elasticsearch ${collection.type}: ${collection.name}`,
                insertText: collection.name,
              })),
              completionContext,
              preferredElasticsearchIndex,
            );
          } else {
            const cacheKey = documentMetadataCacheKey({
              projectId: activeProjectId || "local",
              connectionId: effectiveConnectionId,
              driver: "elasticsearch",
              namespace: elasticsearchMetadataNamespace,
              kind: "fields",
              objectName: indexName!,
            });
            const fields = await loadDocumentMetadata(cacheKey, async () => {
                try {
                  const metadataOptions = {
                    projectId: activeProjectId || undefined,
                    connectionId: effectiveConnectionId,
                    driver: "elasticsearch" as const,
                    schema: elasticsearchMetadataNamespace,
                    table: indexName!,
                    includeIndexes: false,
                    includeConstraints: false,
                  };
                  let metadata = await loadTableMetadata(metadataOptions);
                  // A previous offline catalog sync may have persisted an empty
                  // placeholder. Refresh that one object once instead of treating
                  // the placeholder as an authoritative mapping forever.
                  if (metadata.columns.length === 0) {
                    metadata = await loadTableMetadata({
                      ...metadataOptions,
                      force: true,
                    });
                  }
                  return metadata.columns.map((column) => ({
                    name: column.name,
                    dataType: column.data_type || "field",
                  }));
                } catch (error) {
                  console.debug(
                    `[Elasticsearch Console] Mapping fields unavailable for ${indexName}`,
                    error,
                  );
                  return [];
                }
              });
            fieldCompletions = elasticsearchMappingFieldCompletions(
              fields,
              completionContext,
              indexName!,
            );
          }

          if (
            token?.isCancellationRequested ||
            model.getVersionId() !== modelVersion
          ) {
            return { suggestions: [] };
          }

          const range = elasticsearchJsonStringCompletionRange(
            monaco,
            model,
            position,
          );
          // Keep the already-synchronized LSP catalog as a fallback when live
          // index/mapping metadata is unavailable (for example during a brief
          // reconnect). This provider owns Console path and field positions,
          // so results do not race a second provider with a stale catalog.
          if (fieldCompletions.length === 0 && lspReady && canUseLsp) {
            try {
              const uri = model.uri.toString();
              await syncLspModelBeforeCompletion({
                uri,
                model,
                languageId: documentLanguageId,
                client: lspClient,
                openedDocuments: openedDocumentsRef.current,
                documentVersions: documentVersionsRef.current,
                documentTexts: documentTextsRef.current,
              });
              const items = await lspClient.getCompletions(
                uri,
                position.lineNumber - 1,
                position.column - 1,
                toLspCompletionContext(providerContext),
              );
              fieldCompletions = elasticsearchSchemaCompletionsForContext(
                items,
                completionContext,
                indexName,
              );
            } catch (error) {
              console.debug(
                `[Elasticsearch Console] LSP mapping fallback unavailable for ${indexName}`,
                error,
              );
            }
          }

          if (
            token?.isCancellationRequested ||
            model.getVersionId() !== modelVersion
          ) {
            return { suggestions: [] };
          }

          const suggestions = fieldCompletions.map((field) => ({
            label: field.label,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: field.detail,
            insertText: field.insertText || JSON.stringify(field.label),
            filterText: field.label,
            sortText: field.sortText,
            range,
          }));

          return { incomplete: false, suggestions };
        },
      },
    );
    return () => disposable.dispose();
  }, [
    activeProjectId,
    documentUri,
    effectiveConnectionId,
    effectiveTabId,
    elasticsearchMetadataNamespace,
    canUseLsp,
    documentLanguageId,
    isActivePane,
    isElasticsearchConsole,
    lspClient,
    lspReady,
    monaco,
    preferredElasticsearchIndex,
  ]);

  // Keep cached relation completion available while the semantic server is
  // starting or recovering. It is deliberately limited to existing Explorer
  // metadata and relation-only SQL contexts; the full LSP still owns fields,
  // keywords, diagnostics, and every vendor-specific proposal once ready.
  const createCachedSqlCompletionRequest = useCachedSqlCompletionSource({
    activeProjectId,
    connectionId: effectiveConnectionId,
    currentSchema,
    databaseName: activeTab?.databaseName,
    driver,
    metadataRevision: metadataVersion,
    schemaTables,
    sqlCompletion: editorSettings.sqlCompletion,
    sqlFormatting: editorSettings.sqlFormatting,
    targetSchema: activeTab?.targetSchema,
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
    ],
  );
  // Monaco providers are global per language. Scope requests to the document
  // owned by this editor instance so a background tab cannot use this
  // connection's LSP client or pinned driver package.
  const isCurrentLspModelUri = (uri: string) =>
    uri === documentUri && canUseLsp;
  const provideCompletionItems = async (
          model: any,
          position: any,
          context: any,
          token: LspCancellationToken,
        ) => {
          if (!monaco) return { suggestions: [] };
          const completionStartedAt = performance.now();
          // Metadata/FK fallback work can outlive an LSP response. Capture
          // this before either branch starts so no older cursor revision can
          // publish a late merged completion list.
          const initialModelVersion = model.getVersionId();
          const completionUri = model.uri.toString();
          const textBeforeCursor = boundedSqlCompletionTextBeforeCursor(
            monaco,
            model,
            position,
          );
          const completionIdentity = extractLspDocumentIdentity(
            model.uri.toString(),
          );
          const completionDriver =
            completionIdentity?.driver.toLocaleLowerCase() || "";
          const isRedisCompletionDocument = completionDriver === "redis";
          const isSqlCompletionDocument = ![
            "elasticsearch",
            "elastic",
            "mongodb",
            "redis",
          ].includes(completionDriver);
          const explicitCompletion = completionTriggerOriginRef.current !== null;
          completionTriggerOriginRef.current = null;
          if (isRedisCompletionDocument) {
            if (
              completionUri !== documentUri ||
              !effectiveConnectionId ||
              !isCurrentLspModelUri(completionUri)
            ) {
              return { suggestions: [] };
            }
            const source = model.getValue();
            const offset = model.getOffsetAt(position);
            const redisDatabase =
              activeTab?.targetSchema ||
              currentSchema ||
              activeConnection?.database ||
              "0";
            const commands = await loadRedisCommandDocumentation(
              effectiveConnectionId,
              redisDatabase,
              metadataVersion,
            );
            if (
              token?.isCancellationRequested ||
              model.getVersionId() !== initialModelVersion
            ) {
              return { suggestions: [] };
            }
            const redisContext = getRedisCompletionContext(source, offset, {
              commands,
            });
            let keys: string[] = [];
            if (
              redisContext.mode === "argument" &&
              takesRedisKeyArgument(
                redisContext.commandName,
                { commands },
                redisContext.argumentIndex,
                redisContext.argumentValues,
              )
            ) {
              try {
                keys = await loadRedisCompletionKeys(
                  effectiveConnectionId,
                  redisDatabase,
                  metadataVersion,
                );
              } catch {
                // Command and argument completion remain useful when SCAN is denied.
              }
            }
            if (
              token?.isCancellationRequested ||
              model.getVersionId() !== initialModelVersion
            ) {
              return { suggestions: [] };
            }
            const start = model.getPositionAt(redisContext.from);
            const range = new monaco.Range(
              start.lineNumber,
              start.column,
              position.lineNumber,
              position.column,
            );
            const suggestions = buildRedisCompletionItems(redisContext, {
              commands,
              keys,
            }).map((item) => ({
              label: item.label,
              kind:
                item.type === "key"
                  ? monaco.languages.CompletionItemKind.Reference
                  : item.type === "value"
                    ? monaco.languages.CompletionItemKind.Value
                    : monaco.languages.CompletionItemKind.Keyword,
              detail: item.detail,
              documentation: item.documentation
                ? { value: item.documentation }
                : undefined,
              insertText: `${item.insertText || item.label}${
                item.appendSpace ? " " : ""
              }`,
              filterText: item.label,
              sortText: item.sortText,
              range,
            }));
            return { suggestions, incomplete: false };
          }
          if (isSqlCompletionDocument) {
            const trigger = sqlCompletionTriggerDecision(
              editorSettings.sqlCompletion.triggerMode,
              textBeforeCursor,
              explicitCompletion,
              completionDriver,
            );
            if (!trigger.allowed) {
              recordSqlCompletionTelemetry({
                scope: usageScope,
                outcome: "empty",
                durationMs: performance.now() - completionStartedAt,
                suggestionCount: 0,
                reason: `trigger:${trigger.reason}`,
              });
              return { suggestions: [] };
            }
          }
          if (!isCurrentLspModelUri(completionUri)) {
            return { suggestions: [] };
          }
          // Advance the generation for every accepted request, including the
          // cache-only path used while LSP is restarting. A model version does
          // not change when the user reopens completion at the same cursor, so
          // version checks alone cannot prevent an older fallback from
          // replacing a newer list.
          const requestGeneration =
            (completionRequestGenerationRef.current.get(completionUri) || 0) +
            1;
          completionRequestGenerationRef.current.set(
            completionUri,
            requestGeneration,
          );
          const isCompletionCurrent = () =>
            isCompletionRequestCurrent({
              model,
              modelVersion: initialModelVersion,
              token,
              currentGeneration:
                completionRequestGenerationRef.current.get(completionUri),
              requestGeneration,
            });
          const cachedCompletion = createCachedSqlCompletionRequest({
            completionDriver,
            model,
            monaco,
            position,
            textBeforeCursor,
            token,
          });
          const cachedJoinSuggestions = cachedCompletion.joinSuggestions;
          const cachedMetadataSuggestions = cachedCompletion.metadataSuggestions;
          const cachedSuggestions = cachedCompletion.suggestions;
          const fallbackSuggestions = async () => {
            const cached = await cachedSuggestions();
            if (!isCompletionCurrent()) return [];
            const word = model.getWordUntilPosition(position);
            const range = new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn,
            );
            const typedWord = model.getValueInRange(range);
            const nextCharacter = model
              .getLineContent(position.lineNumber)
              .slice(position.column - 1, position.column);
            const completedContextKeyword =
              isCompletedSqlContextKeyword(typedWord);
            const insertRange = completedContextKeyword
              ? new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                )
              : range;
            const syntax = sqlSyntaxFallbackCompletions(textBeforeCursor, {
              driver: capabilities.driver,
              supportsSqlQuery: capabilities.supportsSqlQuery,
              keywordCase: editorSettings.sqlFormatting.keywordCase,
              functionCase: editorSettings.sqlFormatting.functionCase,
              snippets: editorSettings.sqlCompletion.snippets,
            }).map((item) => {
              // Use the same completed-keyword replacement semantics as a
              // live LSP response. In particular, an offline/restarting LSP
              // must append ` DISTINCT` after a typed `SELECT`, not replace
              // the statement keyword with the fallback proposal.
              const insertText = appendSqlCompletionSpace(
                completionInsertText(item, completedContextKeyword),
                {
                  enabled: editorSettings.sqlCompletion.appendSpace,
                  itemType: sqlCompletionItemType(item),
                  nextCharacter,
                },
              );
              const chainCompletion = shouldChainSqlCompletionAfterAccept(
                item,
                insertText,
                completionDriver,
              );
              return {
                label: completionLabelForMonaco(item),
                kind: toMonacoCompletionKind(monaco, item.kind),
                detail: item.detail || "SQL syntax",
                documentation: item.documentation
                  ? { value: item.documentation }
                  : { value: "Available SQL syntax for the current clause." },
                insertText,
                filterText: completionFilterText(
                  item,
                  typedWord,
                  completedContextKeyword,
                ),
                sortText: rankByUsage
                  ? usageRankedCompletionSortText(
                      item.sortText || `9:${item.label}`,
                      completionUsageScore(usageScope, item.label),
                    )
                  : item.sortText || `9:${item.label}`,
                command:
                  rankByUsage || chainCompletion
                    ? {
                        id: RECORD_COMPLETION_USAGE_COMMAND,
                        title: chainCompletion
                          ? "Continue SQL completion"
                          : "Record SQL completion usage",
                        arguments: [
                          usageScope,
                          item.label,
                          chainCompletion,
                          completionOwnerKey,
                        ],
                      }
                    : undefined,
                insertTextRules:
                  item.insertTextFormat === 2
                    ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                    : undefined,
                range: insertRange,
              };
            });
            return mergeCompletionFallbackSuggestions(cached, syntax);
          };
          const result = (
            suggestions: any[],
            outcome: "lsp" | "fallback" | "empty" | "discarded" | "error",
            reason?: string,
            incomplete = false,
          ) => {
            recordSqlCompletionTelemetry({
              scope: usageScope,
              outcome,
              durationMs: performance.now() - completionStartedAt,
              suggestionCount: suggestions.length,
              reason,
            });
            return { suggestions, incomplete };
          };
          try {
            const uri = completionUri;
            const modelVersion = initialModelVersion;

            const identity = extractLspDocumentIdentity(uri);
            const isElasticsearchDocument =
              identity?.driver === "elasticsearch" ||
              identity?.driver === "elastic";
            const isMongoDbDocument = identity?.driver === "mongodb";
            const elasticsearchContext = isElasticsearchDocument
              ? elasticsearchConsoleCompletionContext(
                  model.getValue(),
                  model.getOffsetAt(position),
                )
              : null;
            const elasticsearchRequestContext = elasticsearchContext
              ? elasticsearchConsoleRequestContext(
                  model.getValue(),
                  model.getOffsetAt(position),
                  preferredElasticsearchIndex,
                )
              : null;
            if (elasticsearchContext) {
              // The Console provider owns methods, REST operations, DSL keys,
              // live index names, and mapping fields. Keeping all of these in
              // one provider prevents a late generic-LSP catalog from mixing
              // a previous connection's indices into the active request.
              return result([], "empty", "consoleSyntaxOwned");
            }
            if (isMongoDbDocument) {
              // MongoDB JSON commands intentionally have no SQL-LSP builtin
              // catalog. Its document-gated Console provider owns semantic
              // suggestions, avoiding an empty JSON LSP round trip on every
              // automatic trigger.
              return result([], "empty", "mongoConsoleOwned");
            }
            if (!lspReady) {
              const suggestions = await fallbackSuggestions();
              return result(
                suggestions,
                suggestions.length > 0 ? "fallback" : "empty",
                suggestions.length > 0 ? "lspNotReady" : "lspNotReadyNoFallback",
              );
            }
            const languageId =
              identity?.driver?.toLowerCase() === driver.toLowerCase()
                ? documentLanguageId
                : identity?.driver
                  ? lspLanguageId(identity.driver)
                  : "sql";
            await syncLspModelBeforeCompletion({
              uri,
              model,
              languageId,
              client: lspClient,
              openedDocuments: openedDocumentsRef.current,
              documentVersions: documentVersionsRef.current,
              documentTexts: documentTextsRef.current,
            });

            // Now request completions with synchronized state
            const completionList = await lspClient.getCompletionList(
              uri,
              position.lineNumber - 1, // LSP uses 0-indexed lines
              position.column - 1, // LSP uses 0-indexed columns
              toLspCompletionContext(context),
              token,
            );
            const items = markResolvableLspCompletionItems(
              completionList.items,
              completionList.resolveProvider,
            );

            if (!isCompletionRequestCurrent({
              model,
              modelVersion,
              token,
              currentGeneration: completionRequestGenerationRef.current.get(uri),
              requestGeneration,
            })) {
              const reason = token?.isCancellationRequested
                ? "cancelled"
                : model.getVersionId() !== modelVersion
                  ? "modelChanged"
                  : "superseded";
              return result([], "discarded", reason);
            }

            // Get the word being typed for range calculation
            const word = model.getWordUntilPosition(position);
            const range = new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn,
            );
            const typedWord = model.getValueInRange(range);
            const nextCharacter = model
              .getLineContent(position.lineNumber)
              .slice(position.column - 1, position.column);
            const completedContextKeyword =
              isCompletedSqlContextKeyword(typedWord);
            const sqlContextKeyword =
              sqlContextKeywordBeforeCursor(textBeforeCursor);
            const insertRange = completedContextKeyword
              ? new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                )
              : range;
            const filteredItems = elasticsearchContext
              ? elasticsearchSchemaCompletionsForContext(
                  items,
                  elasticsearchContext,
                  elasticsearchRequestContext?.index ||
                    preferredElasticsearchIndex,
                )
              : filterCompletionsForSqlContext(items, sqlContextKeyword);
            // SQL LSPs commonly return field names after `WHERE column` but
            // omit operators, and the context filter deliberately removes
            // unrelated operators. Merge the small grammar layer afterwards
            // so a partial live result cannot hide `=`, `IN`, `LIKE`, or the
            // next boolean connector. Non-SQL console languages keep their
            // own grammar and are not mixed with this fallback.
            const completionItems = elasticsearchContext || isMongoDbDocument
              ? filteredItems
              : mergeCompletionFallbackSuggestions(
                  filteredItems,
                  sqlSyntaxFallbackCompletions(textBeforeCursor, {
                    driver: capabilities.driver,
                    supportsSqlQuery: capabilities.supportsSqlQuery,
                    keywordCase: editorSettings.sqlFormatting.keywordCase,
                    functionCase: editorSettings.sqlFormatting.functionCase,
                    snippets: editorSettings.sqlCompletion.snippets,
                  }),
                );
            const lineBeforeCursor = model
              .getLineContent(position.lineNumber)
              .slice(0, position.column - 1);
            const requestPathPrefix = lineBeforeCursor.match(
              /^(\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+)(.*)$/i,
            );
            const jsonStringFragment = lineBeforeCursor.match(
              /"[\w.@*-]*"?$/u,
            )?.[0];
            const elasticsearchInsertRange = requestPathPrefix
              ? new monaco.Range(
                  position.lineNumber,
                  requestPathPrefix[1]!.length + 1,
                  position.lineNumber,
                  position.column,
                )
              : jsonStringFragment?.endsWith('"')
                ? new monaco.Range(
                    position.lineNumber,
                    lineBeforeCursor.length - jsonStringFragment.length + 1,
                    position.lineNumber,
                    position.column,
                  )
                : insertRange;
            const mongodbInsertRange = isMongoDbDocument
              ? mongodbJsonStringCompletionRange(monaco, model, position)
              : insertRange;

            const suggestions = lspCompletionItemsToMonacoSuggestions({
              monaco,
              ownerKey: completionOwnerKey,
              items: completionItems,
              typedWord,
              completedContextKeyword,
              defaultRange: elasticsearchContext
                ? elasticsearchInsertRange
                : isMongoDbDocument
                  ? mongodbInsertRange
                  : insertRange,
              rankByUsage,
              usageScope,
              recordUsageCommand: RECORD_COMPLETION_USAGE_COMMAND,
              driver: completionDriver,
              nextCharacter,
              requestUri: uri,
              requestModelVersion: modelVersion,
            });
            const cachedMetadata = await cachedMetadataSuggestions();
            if (!isCompletionRequestCurrent({
              model,
              modelVersion,
              token,
              currentGeneration: completionRequestGenerationRef.current.get(uri),
              requestGeneration,
            })) {
              return result([], "discarded", "metadataChanged");
            }
            const suggestionsWithMetadata = mergeCompletionFallbackSuggestions(
              suggestions,
              cachedMetadata,
            );
            const cachedJoins = await cachedJoinSuggestions();
            if (
              token?.isCancellationRequested ||
              model.getVersionId() !== modelVersion ||
              completionRequestGenerationRef.current.get(uri) !==
                requestGeneration
            ) {
              return result([], "discarded", "joinMetadataChanged");
            }
            const suggestionsWithSmartJoins =
              mergeCompletionFallbackSuggestions(
                cachedJoins,
                suggestionsWithMetadata,
              );

            // A healthy language server can still return no proposals while
            // metadata is being refreshed, a newly opened document has not
            // reached its first semantic pass, or a generic dialect cannot
            // classify a vendor extension. Preserve the same conservative
            // cache fallback used during startup in that narrow case. It only
            // returns an unambiguous relation's columns or existing Explorer
            // objects, so an empty LSP response never turns into cross-schema
            // guessing.
            const boundedSuggestions = limitCompletionSuggestions(
              suggestionsWithSmartJoins,
              MAX_QUERY_EDITOR_COMPLETION_SUGGESTIONS,
            );
            if (boundedSuggestions.length > 0) {
              return result(
                boundedSuggestions,
                "lsp",
                undefined,
                completionList.isIncomplete,
              );
            }
            const fallback = await fallbackSuggestions();
            return result(
              fallback,
              fallback.length > 0 ? "fallback" : "empty",
              fallback.length > 0 ? "emptyLsp" : "emptyLspNoFallback",
              completionList.isIncomplete,
            );
          } catch (error) {
            console.error("[LSP] Completion failed:", error);
            const fallback = await fallbackSuggestions();
            return result(fallback, "error", fallback.length > 0 ? "lspErrorFallback" : "lspErrorEmpty");
          }
        };

  const resolveCompletionItem = async (
    suggestion: any,
    token: LspCancellationToken,
  ) => {
    const sourceItem = sourceLspCompletionItem(suggestion);
    const resolveContext = completionResolveRequestContext(suggestion);
    const model = mountedEditor?.getModel();
    if (
      !monaco ||
      !sourceItem ||
      token?.isCancellationRequested ||
      (resolveContext &&
        (!model ||
          model.uri.toString() !== resolveContext.uri ||
          model.getVersionId() !== resolveContext.modelVersion))
    ) {
      return suggestion;
    }
    const resolvedItem = await lspClient.resolveCompletionItem(sourceItem, token);
    const currentModel = mountedEditor?.getModel();
    if (
      token?.isCancellationRequested ||
      (resolveContext &&
        (!currentModel ||
          currentModel.uri.toString() !== resolveContext.uri ||
          currentModel.getVersionId() !== resolveContext.modelVersion))
    ) {
      return suggestion;
    }
    return applyResolvedLspCompletionItem(monaco, suggestion, resolvedItem);
  };

  useLspCompletionProviderCoordinator({
    editorLanguageId,
    isActivePane,
    monaco,
    ownerKey: completionOwnerKey,
    provideCompletionItems,
    resolveCompletionItem,
    rankByUsage,
    recordUsage: recordCompletionUsage,
    triggerChainedCompletion: () => {
      const editor = mountedEditor;
      const model = editor?.getModel();
      if (!editor || !model) return;
      window.setTimeout(() => {
        if (editor.getModel() !== model || !editor.hasTextFocus()) return;
        completionTriggerOriginRef.current = "chained";
        editor.trigger(
          "oxide.sql.chainedCompletion",
          "editor.action.triggerSuggest",
          {},
        );
        window.setTimeout(() => {
          if (completionTriggerOriginRef.current === "chained") {
            completionTriggerOriginRef.current = null;
          }
        }, 0);
      }, 0);
    },
    triggerCharacters:
      editorLanguageId === ELASTICSEARCH_CONSOLE_LANGUAGE_ID
        ? ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS
        : [" ", ".", "(", ",", '"', "@", "/", "{", ":"],
    usageCommandId: RECORD_COMPLETION_USAGE_COMMAND,
    usageScope,
  });

  useLspCoreProviderCoordinator({
    activeProjectId,
    canUseLsp,
    documentUri,
    editorLanguageId,
    isActivePane,
    lspClient,
    monaco,
  });

  useLspHoverProviderCoordinator({
    activeProjectId,
    canUseLsp,
    currentSchema,
    databaseName: activeTab?.databaseName,
    documentLanguageId,
    documentUri,
    documentTextsRef,
    documentVersionsRef,
    driver,
    editorLanguageId,
    effectiveConnectionId,
    isActivePane,
    lspClient,
    metadataRevision: metadataVersion,
    monaco,
    openedDocumentsRef,
    schemaTables,
    supportsTableBrowsing: capabilities.supportsTableBrowsing,
    targetSchema: activeTab?.targetSchema,
  });

  useEffect(() => {
    const settings = editorSettings.inlineCompletion;
    if (
      !isActivePane ||
      !monaco ||
      !settings.enabled ||
      ((!lspReady || !canUseLsp) &&
        !isElasticsearchConsole &&
        !capabilities.supportsSqlQuery)
    ) {
      inlineCompletionAbortRef.current?.abort();
      setInlineCompletionStatus(settings.enabled ? "offline" : "off");
      return;
    }

    let disposed = false;
    const providerLanguages = [editorLanguageId];
    const emitInlineCompletionChange = () => {
      inlineCompletionListenersRef.current.forEach((listener) => listener());
    };
    const disposables = providerLanguages.map((language) =>
      monaco.languages.registerInlineCompletionsProvider(language, {
        displayName: "OxideStudio AI",
        debounceDelayMs: 300,
        onDidChangeInlineCompletions: (listener: () => void) => {
          inlineCompletionListenersRef.current.add(listener);
          return {
            dispose: () =>
              inlineCompletionListenersRef.current.delete(listener),
          };
        },
        provideInlineCompletions: async (
          model: any,
          position: any,
          context: any,
          token: any,
        ) => {
          const uri = model.uri.toString();
          if (
            disposed ||
            uri !== documentUri ||
            (context.selectedSuggestionInfo && !isElasticsearchConsole)
          ) {
            return { items: [] };
          }
          const explicit =
            context.triggerKind ===
            monaco.languages.InlineCompletionTriggerKind.Explicit;
          const selection = mountedEditor?.getSelection?.();
          const hasSelection = Boolean(selection && !selection.isEmpty());
          const offset = model.getOffsetAt(position);
          const value = model.getValue();
          const bounded = boundedInlineContext(value, offset);
          const inlineResult = (text: string, replaceSuffixLength = 0) => {
            if (!text) return { items: [] };
            const insertText =
              text.includes("\n") &&
              position.column < model.getLineMaxColumn(position.lineNumber)
                ? text.split("\n", 1)[0]
                : text;
            const endPosition = replaceSuffixLength
              ? model.getPositionAt(
                  Math.min(value.length, offset + replaceSuffixLength),
                )
              : position;
            return {
              items: insertText
                ? [
                    {
                      insertText,
                      range: new monaco.Range(
                        position.lineNumber,
                        position.column,
                        endPosition.lineNumber,
                        endPosition.column,
                      ),
                      completeBracketPairs: true,
                      command: {
                        id: "editor.action.inlineSuggest.trigger",
                        title: "Continue inline completion",
                      },
                    },
                  ]
                : [],
            };
          };
          if (
            isElasticsearchConsole &&
            !hasSelection &&
            (explicit || settings.automaticSuggestions)
          ) {
            const consoleText = elasticsearchConsoleInlineSuggestion(
              value,
              offset,
              preferredElasticsearchIndex,
              elasticsearchServerVersion,
            );
            if (consoleText) {
              setInlineCompletionStatus("local");
              const replaceClosingQuote =
                value[offset] === '"' && consoleText.includes('"') ? 1 : 0;
              return inlineResult(consoleText, replaceClosingQuote);
            }
          }
          if (
            !shouldRequestAiInlineCompletion({
              prefix: bounded.prefix,
              hasSelection,
              automatic: settings.automaticSuggestions,
              explicit,
            })
          ) {
            return { items: [] };
          }
          const commandSnippetAdditions = isElasticsearchConsole
            ? []
            : sqlSyntaxFallbackCompletions(bounded.prefix, {
                driver: capabilities.driver,
                supportsSqlQuery: capabilities.supportsSqlQuery,
                keywordCase: editorSettings.sqlFormatting.keywordCase,
                functionCase: editorSettings.sqlFormatting.functionCase,
                snippets: editorSettings.sqlCompletion.snippets,
              })
                .filter((item) => item.kind === CompletionItemKind.Snippet)
                .map((item) => ({
                  label: item.label,
                  insertText: item.insertText || item.label,
                  kind: item.kind,
                  sortText: item.sortText,
                  preferred: item.sortText?.startsWith("0:") || false,
                }));
          const commandSnippetContext = mergeInlineCompletionCandidates(
            {},
            commandSnippetAdditions,
            {
              rankByUsage,
              usageScore: (label) => completionUsageScore(usageScope, label),
            },
          );
          const commandSnippetText = localInlineSuggestion(
            bounded.prefix,
            commandSnippetContext,
          );
          if (!lspReady || !canUseLsp) {
            setInlineCompletionStatus(commandSnippetText ? "local" : "offline");
            return inlineResult(commandSnippetText);
          }

          const modelVersion = model.getVersionId();
          await syncLspModelBeforeCompletion({
            uri,
            model,
            languageId: documentLanguageId,
            client: lspClient,
            openedDocuments: openedDocumentsRef.current,
            documentVersions: documentVersionsRef.current,
            documentTexts: documentTextsRef.current,
          });
          if (
            token.isCancellationRequested ||
            model.getVersionId() !== modelVersion
          ) {
            return { items: [] };
          }
          const lspContext = await lspClient.getInlineCompletionContext(
            uri,
            position.lineNumber - 1,
            position.column - 1,
          );
          const consoleContext = isElasticsearchConsole
            ? elasticsearchConsoleCompletionContext(value, offset)
            : null;
          const consoleRequestContext = consoleContext
            ? elasticsearchConsoleRequestContext(
                value,
                offset,
                preferredElasticsearchIndex,
              )
            : null;
          const completionContext =
            consoleRequestContext?.startOffset !== undefined
              ? boundedInlineContext(
                  consoleRequestContext.request,
                  offset - consoleRequestContext.startOffset,
                )
              : bounded;
          const scopedLspContext = consoleContext
            ? {
                ...lspContext,
                clause: `ElasticsearchConsole:${consoleContext.area}`,
                referencedObjects: consoleRequestContext?.index
                  ? [consoleRequestContext.index]
                  : [],
                expectedKinds: elasticsearchCompletionExpectsMappingField(
                  consoleContext,
                )
                  ? ["mapping-field"]
                  : [consoleContext.area],
                candidates: (lspContext.candidates || [])
                  .filter((candidate) => candidate.kind === 5)
                  .filter(
                    (candidate, index, rows) =>
                      rows.findIndex(
                        (item) =>
                          item.label.toLowerCase() ===
                          candidate.label.toLowerCase(),
                      ) === index,
                  ),
                console: {
                  ...consoleRequestContext,
                  request: consoleRequestContext?.request || "",
                  area: consoleContext.area,
                },
              }
            : mergeInlineCompletionCandidates(
                lspContext,
                commandSnippetAdditions,
                {
                  rankByUsage,
                  usageScore: (label) =>
                    completionUsageScore(usageScope, label),
                },
              );
          const canUseSchemaInlineCandidate = Boolean(
            consoleContext &&
              elasticsearchCompletionExpectsMappingField(consoleContext),
          );
          const localText =
            !isElasticsearchConsole || canUseSchemaInlineCandidate
              ? localInlineSuggestion(
                  completionContext.prefix,
                  scopedLspContext,
                )
              : "";

          // Mapping-aware LSP output is authoritative for Elasticsearch field
          // positions. Do not let a faster model response replace it with a
          // plausible but nonexistent field from another index.
          if (isElasticsearchConsole && localText) {
            setInlineCompletionStatus("local");
            return inlineResult(localText);
          }

          // Console syntax and mapping positions are deterministic. If the
          // local Console/LSP sources have no valid continuation, showing no
          // ghost text is safer than asking the model to invent a REST
          // operation, JSON key, or mapping field. AI remains available only
          // for genuinely unclassified Console content.
          if (
            isElasticsearchConsole &&
            consoleContext?.area !== "unknown"
          ) {
            setInlineCompletionStatus("local");
            return { items: [] };
          }

          const provider = inlineProviderConfig();
          if (!provider) {
            setInlineCompletionStatus(localText ? "local" : "offline");
            return inlineResult(localText);
          }
          const aiLspContext = settings.includeSchemaMetadata
            ? scopedLspContext
            : {
                dialect: scopedLspContext.dialect,
                clause: scopedLspContext.clause,
                expectedKinds: scopedLspContext.expectedKinds,
                diagnostics: scopedLspContext.diagnostics,
                errorCount: scopedLspContext.errorCount,
                console: scopedLspContext.console,
              };
          const requestBase = {
            protocol: inlineCompletionProtocol,
            config: {
              ...provider,
              model: inlineCompletionModel.trim() || provider.model,
            },
            prefix: redactSecretString(completionContext.prefix),
            suffix: redactSecretString(completionContext.suffix),
            languageId: documentLanguageId,
            dialect: driver,
            ...(activeTab?.fileRelativePath
              ? { filePath: activeTab.fileRelativePath }
              : {}),
            lspContext: aiLspContext,
            relatedSnippets: [] as Array<{
              relativePath: string;
              content: string;
            }>,
          };
          const baseCacheKey = inlineCompletionCacheKey(requestBase);
          const cached = settings.includeProjectContext
            ? undefined
            : inlineCompletionCacheRef.current.get(baseCacheKey);
          if (cached !== undefined) {
            setInlineCompletionStatus("ai");
            return inlineResult(cached);
          }

          inlineCompletionAbortRef.current?.abort();
          const abortController = new AbortController();
          inlineCompletionAbortRef.current = abortController;
          token.onCancellationRequested(() => abortController.abort());
          setInlineCompletionStatus("thinking");
          const aiPromise = (async () => {
            try {
              const relatedSnippets =
                settings.includeProjectContext && projectId && projectRootPath
                  ? await projectFilesService.getCompletionContext({
                      projectId,
                      expectedRoot: projectRootPath,
                      activeFile: activeTab?.fileRelativePath,
                      query: completionContext.prefix,
                      referencedObjects: scopedLspContext.referencedObjects,
                    })
                  : [];
              if (abortController.signal.aborted) return "";
              const request = {
                ...requestBase,
                requestId: createInlineCompletionRequestId(),
                relatedSnippets: relatedSnippets.map((snippet) => ({
                  ...snippet,
                  content: redactSecretString(snippet.content),
                })),
              };
              const cacheKey = inlineCompletionCacheKey(request);
              const cachedWithProject =
                inlineCompletionCacheRef.current.get(cacheKey);
              if (cachedWithProject !== undefined) return cachedWithProject;
              const result = await aiService.inlineCompletion(
                request,
                abortController.signal,
              );
              if (
                abortController.signal.aborted ||
                model.getVersionId() !== modelVersion
              ) {
                return "";
              }
              const completion = cleanInlineSuggestion(
                result.text,
                completionContext.prefix,
                completionContext.suffix,
              );
              if (!completion) return "";
              const nextText = `${value.slice(0, offset)}${completion}${value.slice(offset)}`;
              const nextDiagnostics = isElasticsearchConsole
                ? validateElasticsearchConsole(nextText)
                : await lspClient.validateInlineCompletion(uri, nextText);
              const baselineErrors = isElasticsearchConsole
                ? validateElasticsearchConsole(value).filter(
                    (diagnostic) => diagnostic.severity === "error",
                  ).length
                : (lspContext.errorCount ??
                  (lspContext.diagnostics || []).filter(
                    (diagnostic) => diagnostic.severity === 1,
                  ).length);
              const nextErrors = nextDiagnostics.filter((diagnostic) =>
                isElasticsearchConsole
                  ? diagnostic.severity === "error"
                  : diagnostic.severity === 1,
              ).length;
              if (nextErrors > baselineErrors) return "";
              inlineCompletionCacheRef.current.set(cacheKey, completion);
              if (!settings.includeProjectContext) {
                inlineCompletionCacheRef.current.set(baseCacheKey, completion);
              }
              if (!disposed) {
                setInlineCompletionStatus("ai");
                emitInlineCompletionChange();
              }
              return completion;
            } catch (error) {
              if (!abortController.signal.aborted && !disposed) {
                setInlineCompletionStatus(localText ? "local" : "offline");
                console.debug(
                  "[InlineCompletion] AI provider unavailable",
                  error,
                );
              }
              return "";
            } finally {
              if (inlineCompletionAbortRef.current === abortController) {
                inlineCompletionAbortRef.current = null;
              }
            }
          })();

          if (!localText) {
            return inlineResult(await aiPromise);
          }
          const fastAiText = await Promise.race([
            aiPromise,
            new Promise<string>((resolve) =>
              window.setTimeout(() => resolve(""), 120),
            ),
          ]);
          if (fastAiText) return inlineResult(fastAiText);
          setInlineCompletionStatus("local");
          void aiPromise;
          return inlineResult(localText);
        },
        disposeInlineCompletions: () => undefined,
      }),
    );

    return () => {
      disposed = true;
      inlineCompletionAbortRef.current?.abort();
      inlineCompletionAbortRef.current = null;
      disposables.forEach((disposable) => disposable.dispose());
      inlineCompletionListenersRef.current.clear();
    };
  }, [
    activeTab?.fileRelativePath,
    inlineProviderConfig,
    canUseLsp,
    capabilities.driver,
    capabilities.supportsSqlQuery,
    documentLanguageId,
    documentUri,
    driver,
    editorLanguageId,
    editorSettings.inlineCompletion,
    editorSettings.sqlFormatting.functionCase,
    editorSettings.sqlFormatting.keywordCase,
    editorSettings.sqlCompletion.snippets,
    inlineCompletionModel,
    inlineCompletionProtocol,
    isElasticsearchConsole,
    elasticsearchServerVersion,
    isActivePane,
    lspClient,
    lspReady,
    monaco,
    mountedEditor,
    projectId,
    projectRootPath,
    preferredElasticsearchIndex,
    rankByUsage,
    usageScope,
  ]);

  useEffect(() => {
    if (!monaco || !lspReady) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<LspServerNotification>(LSP_NOTIFICATION_EVENT, (event) => {
      if (
        event.payload.sessionKey &&
        event.payload.sessionKey !== lspSessionKey
      ) {
        return;
      }
      if (event.payload.method !== "textDocument/publishDiagnostics") return;
      if (!isPublishDiagnosticsParams(event.payload.params)) return;

      const { uri, diagnostics, version } = event.payload.params;
      const model = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (!model) return;
      if (
        !shouldApplyLspDiagnostics({
          diagnosticsVersion: version,
          currentDocumentVersion: documentVersionsRef.current.get(uri),
          modelText: model.getValue(),
          synchronizedText: documentTextsRef.current.get(uri),
        })
      ) {
        return;
      }
      const tabId = extractSqlDocumentTabId(uri);
      if (tabId) {
        setLspDiagnostics(tabId, diagnostics);
      }

      monaco.editor.setModelMarkers(
        model,
        "sql-lsp",
        diagnostics.map((diagnostic) =>
          lspDiagnosticToMonacoMarker(monaco, diagnostic),
        ),
      );
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [lspSessionKey, monaco, lspReady, setLspDiagnostics]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    const databaseError = activeTab?.queryError?.database;
    const documentOffset = databaseError?.documentOffset;
    const documentEndOffset = databaseError?.documentEndOffset;
    const owner = "database-query";

    if (
      !databaseError ||
      documentOffset === undefined ||
      documentOffset < 0 ||
      documentOffset > model.getValueLength()
    ) {
      monaco.editor.setModelMarkers(model, owner, []);
      return;
    }

    const start = model.getPositionAt(documentOffset);
    const end = model.getPositionAt(
      Math.min(
        model.getValueLength(),
        Math.max(documentOffset, documentEndOffset ?? documentOffset + 1),
      ),
    );
    monaco.editor.setModelMarkers(model, owner, [
      {
        severity: monaco.MarkerSeverity.Error,
        message: activeTab?.error || "Database query failed",
        source:
          databaseError.sqlState || databaseError.vendorCode !== undefined
            ? [
                databaseError.driver,
                databaseError.sqlState,
                databaseError.vendorCode,
              ]
                .filter((value) => value !== undefined)
                .join(" ")
            : databaseError.driver,
        code:
          databaseError.sqlState ||
          (databaseError.vendorCode !== undefined
            ? String(databaseError.vendorCode)
            : undefined),
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn:
          end.lineNumber === start.lineNumber && end.column === start.column
            ? start.column + 1
            : end.column,
      },
    ]);

    return () => {
      monaco.editor.setModelMarkers(model, owner, []);
    };
  }, [
    activeTab?.error,
    activeTab?.id,
    activeTab?.queryError,
    monaco,
    mountedEditor,
  ]);

  // Initialize targetSchema from currentSchema if not set
  useEffect(() => {
    if (activeTab && activeTab.targetSchema === undefined && currentSchema) {
      setTargetSchema(activeTab.id, currentSchema);
    }
  }, [activeTab, currentSchema, setTargetSchema]);

  // Close dropdown on click outside - COMMENTED OUT UNUSED
  // useEffect(() => { ... }, []);

  const openHistoryInEditor = (item: QueryHistoryItem) => {
    const savedConnection = item.connectionId
      ? connections.find((connection) => connection.id === item.connectionId)
      : undefined;
    const fallbackConnection = connections.find(
      (connection) => connection.id === effectiveConnectionId,
    );
    const targetConnectionId = item.connectionId
      ? savedConnection?.id || item.connectionId
      : fallbackConnection?.id;
    const firstLine = item.sql
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    const title = firstLine
      ? `History · ${firstLine.slice(0, 38)}`
      : "History Query";
    const tabStore = useTabStore.getState();
    const tabId = tabStore.createTab("query", title, item.sql, {
      connectionId: targetConnectionId,
      databaseName: item.databaseName || undefined,
    });
    tabStore.setTargetSchema(tabId, item.schemaName);
  };

  const rerunHistory = async (item: QueryHistoryItem) => {
    const savedConnection = item.connectionId
      ? connections.find((connection) => connection.id === item.connectionId)
      : undefined;
    if (item.connectionId && !savedConnection) {
      throw new Error(
        "The saved data source is no longer available in this project. Open the query and choose another data source.",
      );
    }
    const targetConnection =
      savedConnection ||
      connections.find((connection) => connection.id === effectiveConnectionId);
    if (!targetConnection) {
      throw new Error(
        "Choose a data source before running this history entry.",
      );
    }
    if (!confirmEditorExecution(item.sql, targetConnection.driver))
      return false;

    if (!connectedConnectionIds.includes(targetConnection.id)) {
      const connectionError = await useConnectionStore
        .getState()
        .setActiveConnection(targetConnection.id);
      if (connectionError) throw new Error(connectionError);
    }

    const tabStore = useTabStore.getState();
    const tabId = tabStore.createTab(
      "query",
      `History · ${targetConnection.name}`,
      item.sql,
      {
        connectionId: targetConnection.id,
        databaseName: item.databaseName || undefined,
      },
    );
    tabStore.setTargetSchema(tabId, item.schemaName);
    await tabStore.runTabQuery(tabId, targetConnection.id);
    const executionError = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === tabId)?.error;
    if (executionError) throw new Error(executionError);
    return true;
  };

  useEffect(() => {
    if (!isActivePane) return;

    const onRun = () => runAllActionRef.current();
    const onRunCurrent = () => void runCurrentActionRef.current();
    const onFormat = () => formatActionRef.current();
    const onInsertLineBelow = () => {
      const editor = editorRef.current;
      if (!editor) return;
      insertLineBelow(editor);
    };

    window.addEventListener(APP_EVENT_RUN_QUERY, onRun);
    window.addEventListener(APP_EVENT_RUN_CURRENT, onRunCurrent);
    window.addEventListener(APP_EVENT_FORMAT_SQL, onFormat);
    window.addEventListener(APP_EVENT_INSERT_LINE_BELOW, onInsertLineBelow);

    return () => {
      window.removeEventListener(APP_EVENT_RUN_QUERY, onRun);
      window.removeEventListener(APP_EVENT_RUN_CURRENT, onRunCurrent);
      window.removeEventListener(APP_EVENT_FORMAT_SQL, onFormat);
      window.removeEventListener(
        APP_EVENT_INSERT_LINE_BELOW,
        onInsertLineBelow,
      );
    };
  }, [isActivePane]);

  useEffect(() => {
    if (!isActivePane) return;

    const revealRange = (event: Event) => {
      const detail = (event as CustomEvent<EditorRangeNavigationDetail>).detail;
      const editor = editorRef.current;
      if (!editor || detail?.tabId !== effectiveTabId) return;
      const range = detail.range;
      editor.setSelection({
        startLineNumber: range.startLine,
        startColumn: range.startColumn,
        endLineNumber: range.endLine,
        endColumn: range.endColumn,
      });
      editor.revealRangeInCenter({
        startLineNumber: range.startLine,
        startColumn: range.startColumn,
        endLineNumber: range.endLine,
        endColumn: range.endColumn,
      });
      if (detail.focus !== false) editor.focus();
    };

    window.addEventListener(APP_EVENT_REVEAL_EDITOR_RANGE, revealRange);
    return () =>
      window.removeEventListener(APP_EVENT_REVEAL_EDITOR_RANGE, revealRange);
  }, [effectiveTabId, isActivePane]);

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

  const handleFormat = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    if (!isElasticsearchConsole) {
      editor.getAction("editor.action.formatDocument").run();
      return;
    }

    const selection = editor.getSelection();
    const cursor = editor.getPosition();
    if (!selection && !cursor) return;
    const selectionStart = selection
      ? model.getOffsetAt({
          lineNumber: selection.startLineNumber,
          column: selection.startColumn,
        })
      : model.getOffsetAt(cursor);
    const selectionEnd =
      selection && !selection.isEmpty()
        ? model.getOffsetAt({
            lineNumber: selection.endLineNumber,
            column: selection.endColumn,
          })
        : selectionStart;
    const requests = elasticsearchRequestsForSelection(
      model.getValue(),
      selectionStart,
      selectionEnd,
    );
    if (requests.length === 0) return;

    const startOffset = requests[0]!.startOffset;
    const endOffset = requests[requests.length - 1]!.endOffset;
    const source = model.getValue().slice(startOffset, endOffset);
    const formatted = formatElasticsearchConsole(source);
    if (!formatted || formatted === source) return;
    const start = model.getPositionAt(startOffset);
    const end = model.getPositionAt(endOffset);
    editor.executeEdits("oxide.elasticsearch.format", [
      {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        text: formatted,
        forceMoveMarkers: true,
      },
    ]);
  };

  runAllActionRef.current = handleRun;
  runCurrentActionRef.current = handleRunCurrent;
  formatActionRef.current = handleFormat;

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;

    if (!isElasticsearchConsole) {
      monaco.editor.setModelMarkers(model, "elasticsearch-console", []);
      return;
    }

    const applyAnalysis = (response: ElasticsearchAnalysisResponse) => {
      if (
        response.requestId !== elasticsearchAnalysisRequestIdRef.current ||
        mountedEditor.getModel() !== model
      ) {
        return;
      }

      monaco.editor.setModelMarkers(
        model,
        "elasticsearch-console",
        response.diagnostics.map((diagnostic) => {
          const start = model.getPositionAt(diagnostic.startOffset);
          const end = model.getPositionAt(
            Math.max(diagnostic.startOffset + 1, diagnostic.endOffset),
          );
          return {
            severity:
              diagnostic.severity === "error"
                ? monaco.MarkerSeverity.Error
                : monaco.MarkerSeverity.Warning,
            message: diagnostic.message,
            source: "Elasticsearch Console",
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          };
        }),
      );

      const requestLines = new Set(
        response.requestStartOffsets.map(
          (offset) => model.getPositionAt(offset).lineNumber,
        ),
      );
      elasticsearchRequestLinesRef.current = requestLines;
      elasticsearchDecorationIdsRef.current = mountedEditor.deltaDecorations(
        elasticsearchDecorationIdsRef.current,
        Array.from(requestLines).map((lineNumber) => ({
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            glyphMarginClassName: "oxide-es-run-glyph",
            glyphMarginHoverMessage: {
              value: "Run this Elasticsearch request (⌘/Ctrl+Enter)",
            },
          },
        })),
      );
    };
    elasticsearchAnalysisApplyRef.current = applyAnalysis;

    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL(
          "../../workers/elasticsearchAnalysis.worker.ts",
          import.meta.url,
        ),
        { type: "module", name: "oxide-elasticsearch-analysis" },
      );
      worker.onmessage = (
        event: MessageEvent<ElasticsearchAnalysisResponse>,
      ) => applyAnalysis(event.data);
      elasticsearchAnalysisWorkerRef.current = worker;
    } catch (error) {
      console.warn("Elasticsearch analysis worker is unavailable", error);
    }

    const mouseDisposable = mountedEditor.onMouseDown((event: any) => {
      if (
        event.target?.type !==
          monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        !elasticsearchRequestLinesRef.current.has(
          event.target.position?.lineNumber,
        )
      ) {
        return;
      }
      const position = {
        lineNumber: event.target.position.lineNumber,
        column: 1,
      };
      mountedEditor.setPosition(position);
      mountedEditor.setSelection({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: 1,
      });
      mountedEditor.focus();
      runCurrentActionRef.current();
    });

    return () => {
      elasticsearchAnalysisRequestIdRef.current += 1;
      if (elasticsearchAnalysisTimerRef.current !== null) {
        window.clearTimeout(elasticsearchAnalysisTimerRef.current);
        elasticsearchAnalysisTimerRef.current = null;
      }
      worker?.terminate();
      if (elasticsearchAnalysisWorkerRef.current === worker) {
        elasticsearchAnalysisWorkerRef.current = null;
      }
      elasticsearchAnalysisApplyRef.current = null;
      mouseDisposable.dispose();
      mountedEditor.deltaDecorations(
        elasticsearchDecorationIdsRef.current,
        [],
      );
      elasticsearchDecorationIdsRef.current = [];
      elasticsearchRequestLinesRef.current = new Set();
      monaco.editor.setModelMarkers(model, "elasticsearch-console", []);
    };
  }, [
    documentUri,
    isElasticsearchConsole,
    monaco,
    mountedEditor,
  ]);

  useEffect(() => {
    if (!mountedEditor || !isElasticsearchConsole) return;
    const model = mountedEditor.getModel();
    if (!model) return;

    if (elasticsearchAnalysisTimerRef.current !== null) {
      window.clearTimeout(elasticsearchAnalysisTimerRef.current);
    }
    const requestId = elasticsearchAnalysisRequestIdRef.current + 1;
    elasticsearchAnalysisRequestIdRef.current = requestId;
    const source = model.getValue();
    elasticsearchAnalysisTimerRef.current = window.setTimeout(() => {
      elasticsearchAnalysisTimerRef.current = null;
      const worker = elasticsearchAnalysisWorkerRef.current;
      if (worker) {
        worker.postMessage({ requestId, source });
        return;
      }

      // Worker creation can be blocked by an unusually strict host policy.
      // Keep Console usable in that environment, but defer the fallback so it
      // never runs in the input event itself.
      void import("@/lib/elasticsearchConsole").then(
        ({ parseElasticsearchConsoleRequests, validateElasticsearchConsole }) =>
          elasticsearchAnalysisApplyRef.current?.({
            requestId,
            diagnostics: validateElasticsearchConsole(source),
            requestStartOffsets: parseElasticsearchConsoleRequests(source).map(
              (request) => request.startOffset,
            ),
          }),
      );
    }, 140);

    return () => {
      if (elasticsearchAnalysisTimerRef.current !== null) {
        window.clearTimeout(elasticsearchAnalysisTimerRef.current);
        elasticsearchAnalysisTimerRef.current = null;
      }
    };
  }, [activeDocumentSql, isElasticsearchConsole, mountedEditor]);

  useEffect(() => {
    if (!monaco || !mountedEditor || !isElasticsearchConsole) return;

    const navigate = (direction: "previous" | "next") => {
      const model = mountedEditor.getModel();
      const position = mountedEditor.getPosition();
      if (!model || !position) return;
      const offset = elasticsearchRequestNavigationOffset(
        model.getValue(),
        model.getOffsetAt(position),
        direction,
      );
      if (offset === null) return;
      const target = model.getPositionAt(offset);
      mountedEditor.setPosition(target);
      mountedEditor.revealPositionInCenterIfOutsideViewport(target);
      mountedEditor.focus();
    };

    const actions = [
      mountedEditor.addAction({
        id: "oxide.elasticsearch.runCurrent",
        label: "Run current Elasticsearch request",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => runCurrentActionRef.current(),
      }),
      mountedEditor.addAction({
        id: "oxide.elasticsearch.runAll",
        label: "Run all Elasticsearch requests",
        keybindings: [
          monaco.KeyMod.CtrlCmd |
            monaco.KeyMod.Shift |
            monaco.KeyCode.Enter,
        ],
        run: () => runAllActionRef.current(),
      }),
      mountedEditor.addAction({
        id: "oxide.elasticsearch.formatCurrent",
        label: "Auto-indent current Elasticsearch request",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
        run: () => formatActionRef.current(),
      }),
      mountedEditor.addAction({
        id: "oxide.elasticsearch.nextRequest",
        label: "Go to next Elasticsearch request",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.DownArrow,
        ],
        run: () => navigate("next"),
      }),
      mountedEditor.addAction({
        id: "oxide.elasticsearch.previousRequest",
        label: "Go to previous Elasticsearch request",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.UpArrow],
        run: () => navigate("previous"),
      }),
    ];

    return () => actions.forEach((action) => action.dispose());
  }, [
    isElasticsearchConsole,
    monaco,
    mountedEditor,
  ]);

  useEffect(() => {
    if (
      !monaco ||
      !mountedEditor ||
      isElasticsearchConsole ||
      !capabilities.supportsSqlQuery
    ) {
      return;
    }
    const replaceSelections = (transform: (selected: string) => string | null) => {
      const model = mountedEditor.getModel();
      const selections = mountedEditor
        .getSelections()
        ?.filter((selection: Selection) => !selection.isEmpty());
      if (!model || !selections?.length) return;
      // Intentions are all-or-nothing across cursors: leaving one selected
      // identifier unmodified would make a batch edit look successful while
      // silently producing a mixed SQL document.
      const edits = [];
      for (const selection of selections) {
        const replacement = transform(model.getValueInRange(selection));
        if (replacement === null) return;
        edits.push({
          range: selection,
          text: replacement,
          forceMoveMarkers: true,
        });
      }
      mountedEditor.executeEdits("oxide.sql-intention", edits);
    };
    const actions = [
      mountedEditor.addAction({
        id: "oxide.sql.triggerCompletion",
        label: "Show SQL completion suggestions",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
        run: () => {
          completionTriggerOriginRef.current = "explicit";
          mountedEditor.trigger(
            "oxide.sql.explicitCompletion",
            "editor.action.triggerSuggest",
            {},
          );
          window.setTimeout(() => {
            if (completionTriggerOriginRef.current === "explicit") {
              completionTriggerOriginRef.current = null;
            }
          }, 0);
        },
      }),
      mountedEditor.addAction({
        id: "oxide.sql.quoteIdentifier",
        label: "Quote selected SQL identifier",
        contextMenuGroupId: "oxide.sql",
        contextMenuOrder: 1,
        run: () => replaceSelections((selected) => quoteSqlIdentifierSelection(driver, selected)),
      }),
      mountedEditor.addAction({
        id: "oxide.sql.unquoteIdentifier",
        label: "Unquote selected SQL identifier",
        contextMenuGroupId: "oxide.sql",
        contextMenuOrder: 2,
        run: () => replaceSelections(unquoteSqlIdentifierSelection),
      }),
      mountedEditor.addAction({
        id: "oxide.sql.pasteInList",
        label: "Paste clipboard as SQL IN list",
        contextMenuGroupId: "oxide.sql",
        contextMenuOrder: 3,
        run: async () => {
          try {
            const clipboard = await navigator.clipboard?.readText();
            const list = clipboard ? sqlInListFromClipboard(clipboard) : null;
            if (list !== null) replaceSelections(() => list);
          } catch {
            // Clipboard permission is host-controlled; leave the document
            // untouched when it is unavailable.
          }
        },
      }),
    ];
    return () => actions.forEach((action) => action.dispose());
  }, [
    capabilities.supportsSqlQuery,
    driver,
    isElasticsearchConsole,
    monaco,
    mountedEditor,
  ]);

  const { mode } = (useContext(ThemeContext) as any) || { mode: "dark" };
  const editorOptions = useMemo(
    () => buildQueryEditorOptions(editorSettings, isElasticsearchConsole),
    [
      editorSettings.fontSize,
      editorSettings.keybindingMode,
      editorSettings.inlineCompletion.enabled,
      editorSettings.minimap,
      editorSettings.sqlCompletion.triggerMode,
      editorSettings.tabSize,
      editorSettings.vim.relativeLineNumbers,
      editorSettings.wordWrap,
      isElasticsearchConsole,
    ],
  );

  const handleEditorMount = useCallback(
    (editor: any, monacoInstance: any) => {
      // Keep this callback stable across execution/result state updates. The
      // Monaco React wrapper is memoized; changing this prop needlessly sends
      // the editor subtree through another render on every query run.
      if (!editor || !monacoInstance) return;
      editorRef.current = editor;
      setMountedEditor(editor);
      inlineKeysContextRef.current = editor.createContextKey(
        "oxideInlineCompletionKeysEnabled",
        editorSettings.keybindingMode !== "vim",
      );
      monacoInstance.editor.setTheme(
        mode === "light" ? "vs" : "oxide-dark",
      );
    },
    [editorSettings.keybindingMode, mode],
  );

  const handleEditorBeforeMount = useCallback((monacoInstance: any) => {
    registerElasticsearchConsoleLanguage(monacoInstance);
    monacoInstance.editor.defineTheme("oxide-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#1c1d20",
        "editorLineNumber.foreground": "#6f7786",
        "editorCursor.foreground": "#75a7ff",
        "editor.selectionBackground": "#2c4573",
        "editor.inactiveSelectionBackground": "#263247",
        "editor.lineHighlightBackground": "#24272d",
        "editorIndentGuide.background1": "#2a2d33",
        "editorIndentGuide.activeBackground1": "#414754",
        "editorRuler.foreground": "#2b2e34",
        "editorGutter.background": "#1c1d20",
        "editorWidget.background": "#272a30",
        "editorWidget.border": "#3a414d",
        "editorSuggestWidget.background": "#272a30",
        "editorSuggestWidget.border": "#3a414d",
        "editorSuggestWidget.foreground": "#e1e5eb",
        "editorSuggestWidget.selectedBackground": "#354967",
        "editorSuggestWidget.selectedForeground": "#f2f5f9",
        "editorSuggestWidget.highlightForeground": "#8db8ff",
        "editorSuggestWidget.focusHighlightForeground": "#c5dcff",
        "editorSuggestWidgetStatus.foreground": "#aeb7c4",
        "editorHoverWidget.background": "#272a30",
        "editorHoverWidget.border": "#3a414d",
      },
    });
  }, []);

  // Update Monaco theme when app theme changes
  useEffect(() => {
    if (!monaco) return;
    monaco.editor.setTheme(mode === "light" ? "vs" : "oxide-dark");
  }, [monaco, mode]);

  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model || model.getLanguageId() === editorLanguageId) return;
    monaco.editor.setModelLanguage(model, editorLanguageId);
  }, [documentUri, editorLanguageId, monaco, mountedEditor]);

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
  });
  if (!activeTab) return null;

  return (
    <div
      className="wb-query-editor relative flex h-full w-full flex-col bg-[hsl(var(--wb-editor))]"
      data-editor-group-id={editorGroupId}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
    >
      <SqlScriptImportDialog
        open={Boolean(pendingSqlScriptImport)}
        preview={pendingSqlScriptImport?.preview || null}
        target={pendingSqlScriptImport?.target.label || "selected data source"}
        isSubmitting={isSqlScriptImporting}
        onClose={closeSqlScriptImport}
        onImport={handleConfirmSqlScriptImport}
      />
      {activeTab.agentFileDiffPreview ? (
        <AgentFileDiffReviewBar preview={activeTab.agentFileDiffPreview} />
      ) : activeTab.gitFileDiffPreview ? (
        <GitFileDiffReviewBar preview={activeTab.gitFileDiffPreview} />
      ) : isProjectFilePreview && activeTab.filePreview ? (
        <div className="wb-editor-commandbar justify-between gap-2">
          <div
            className="flex min-w-0 items-center gap-1.5 truncate text-[10px] wb-muted"
            title={activeTab.fileRelativePath}
          >
            <ImageIcon size={12} className="shrink-0 text-violet-400" />
            <span className="truncate">{activeTab.fileRelativePath}</span>
          </div>
          <span className="shrink-0 text-[9px] uppercase tracking-wide wb-muted">
            Image preview · Read only
          </span>
        </div>
      ) : activeProjectFileLanguage && !canExecuteDocument ? (
        <div className="wb-editor-commandbar justify-between gap-2">
          <div
            className="min-w-0 truncate text-[10px] wb-muted"
            title={activeTab.fileRelativePath}
          >
            {activeTab.fileRelativePath}
            <span className="ml-2 uppercase opacity-70">
              {activeProjectFileLanguage.editorLanguageId}
            </span>
          </div>
          <button
            type="button"
            className={cn(
              "wb-text-button h-6 shrink-0 gap-1.5 px-2 text-[10px]",
              activeTab.isDirty && "text-[hsl(var(--wb-accent))]",
            )}
            onClick={() => void saveProjectFileTab(activeTab.id)}
            disabled={!activeTab.isDirty}
            title={
              activeTab.isDirty
                ? "Save Project File (Ctrl+S)"
                : "Project File Saved"
            }
          >
            <Save size={12} />
            Save
          </button>
        </div>
      ) : (
        <EditorActionBar
          connectionId={effectiveConnectionId}
          currentSchema={activeTab.targetSchema ?? currentSchema}
          onSchemaChange={handleSchemaChange}
          databases={
            canBrowseDatabaseCatalogs ? catalogDatabases : undefined
          }
          currentDatabase={
            canBrowseDatabaseCatalogs
              ? activeTab.databaseName ||
                configuredCatalogDatabase ||
                catalogDatabases[0] ||
                null
              : null
          }
          onDatabaseChange={
            canBrowseDatabaseCatalogs ? handleDatabaseChange : undefined
          }
          isDatabaseRefreshing={postgresDatabaseDiscovery.isRefreshing}
          databaseSelectionDisabled={activeTransactionState === "active"}
          transactionMode={transactionMode}
          transactionState={activeTransactionState}
          transactionOperation={transactionOperation}
          onTransactionModeChange={handleTransactionModeChange}
          onBeginTransaction={handleBeginTransaction}
          onCommitTransaction={handleCommitTransaction}
          onRollbackTransaction={handleRollbackTransaction}
          onFormat={handleFormat}
          onRun={handleRun}
          onRunCurrent={handleRunCurrent}
          onExplain={handleExplain}
          onCancelRun={handleCancelRun}
          onImportSqlScript={
            capabilities.supportsSqlQuery ? handleImportSqlScript : undefined
          }
          onImportConsoleRequests={
            isElasticsearchConsole ? handleImportConsoleRequests : undefined
          }
          onExportConsoleRequests={
            isElasticsearchConsole ? handleExportConsoleRequests : undefined
          }
          fileOperation={editorFileOperation}
          isExecuting={activeTab.isExecuting}
          isConnected={Boolean(effectiveConnectionId && canExecuteDocument)}
          supportsExplainPlan={
            capabilities.supportsExplainPlan && canExecuteDocument
          }
          savedQueries={savedQueries}
          onOpenHistory={openHistoryInEditor}
          onRerunHistory={rerunHistory}
          onLoadQuery={(sql: string) => updateTabSql(activeTab.id, sql)}
          onSaveQuery={(_name: string, _sql: string) =>
            saveQuery(_name, activeTab.sql)
          }
          onDeleteQuery={deleteQuery}
          supportsTransactions={supportsTransactions && canExecuteDocument}
          isProjectFile={Boolean(activeTab.fileRelativePath)}
          isFileDirty={Boolean(activeTab.isDirty)}
          onSaveFile={() => void saveProjectFileTab(activeTab.id)}
          parameterCount={canExecuteDocument ? parameterCount : 0}
          onConfigureParameters={handleConfigureParameters}
          queryLanguage={
            driver === "elasticsearch"
              ? activeTab.queryLanguage || "elasticsearch-dsl"
              : undefined
          }
          onQueryLanguageChange={(queryLanguage) =>
            setQueryLanguage(activeTab.id, queryLanguage)
          }
          elasticsearchVariableNames={elasticsearchVariableNames}
          elasticsearchVariables={activeTab.elasticsearchVariables}
          onElasticsearchVariableChange={(name, value) =>
            setElasticsearchVariables(activeTab.id, {
              ...activeTab.elasticsearchVariables,
              [name]: value,
            })
          }
        />
      )}

      {!isProjectFilePreview &&
        !activeTab.gitFileDiffPreview &&
        parameterExecution && (
        <SqlParametersPanel
          sql={parameterExecution.sql}
          dialect={driver}
          isConnected={Boolean(effectiveConnectionId && canExecuteDocument)}
          isExecuting={activeTab.isExecuting}
          onClose={closeParameterExecution}
          onRun={handleRunParameterizedSql}
        />
      )}

      {!isProjectFilePreview &&
        !activeTab.agentFileDiffPreview &&
        !activeTab.gitFileDiffPreview &&
        activeTab.editorPatchPreview && (
        <EditorPatchPreviewPanel
          key={activeTab.editorPatchPreview.id}
          patch={activeTab.editorPatchPreview}
          stale={
            documentTextRevision(activeTab.fileRevision, activeTab.sql) !==
            activeTab.editorPatchPreview.expectedRevision
          }
          onValidate={
            capabilities.supportsSqlQuery
              ? async () => {
                  const patch = activeTab.editorPatchPreview!;
                  const virtualDocument = applyEditorTextPatch(
                    activeTab.sql,
                    patch.range,
                    patch.originalText,
                    patch.replacement,
                  );
                  if (virtualDocument.status !== "success") {
                    throw new Error(virtualDocument.message);
                  }
                  return queryService.validateSqlSyntax(
                    driver,
                    virtualDocument.text,
                    lspLanguageIdForCapabilities(capabilities),
                    lspServerDialectForCapabilities(capabilities),
                  );
                }
              : undefined
          }
          onComparePlans={
            capabilities.supportsExplainPlan &&
            effectiveConnectionId &&
            connectedConnectionIds.includes(effectiveConnectionId)
              ? (signal) => {
                  const patch = activeTab.editorPatchPreview!;
                  const documents = completePatchSqlDocuments(
                    activeTab.sql,
                    patch,
                  );
                  const schemaContext = querySchemaContextForTab(
                    activeTab,
                    currentSchema,
                    driver,
                  );
                  return comparePatchExplainPlans({
                    connectionId: effectiveConnectionId,
                    beforeSql: documents.beforeSql,
                    afterSql: documents.afterSql,
                    schema: activeTab.databaseName
                      ? undefined
                      : schemaContext || undefined,
                    database: activeTab.databaseName || undefined,
                    signal,
                    explainQuery: queryService.explainQuery,
                    cancelQuery: queryService.cancelQuery,
                  });
                }
              : undefined
          }
          onAnalyzeAfterPlan={
            capabilities.supportsExplainPlan &&
            effectiveConnectionId &&
            connectedConnectionIds.includes(effectiveConnectionId)
              ? async (signal) => {
                  const patch = activeTab.editorPatchPreview!;
                  const documents = completePatchSqlDocuments(
                    activeTab.sql,
                    patch,
                  );
                  const schemaContext = querySchemaContextForTab(
                    activeTab,
                    currentSchema,
                    driver,
                  );
                  const plan = await analyzePatchExplainPlan({
                    connectionId: effectiveConnectionId,
                    sql: documents.afterSql,
                    schema: activeTab.databaseName
                      ? undefined
                      : schemaContext || undefined,
                    database: activeTab.databaseName || undefined,
                    signal,
                    explainQuery: queryService.explainQuery,
                    cancelQuery: queryService.cancelQuery,
                  });
                  return reviewRuntimeExplainPlan(plan);
                }
              : undefined
          }
          onDismiss={() =>
            dismissEditorPatch(activeTab.id, activeTab.editorPatchPreview!.id)
          }
          onApply={() => {
            const result = applyEditorPatchPreview(
              activeTab.id,
              activeTab.editorPatchPreview!.id,
            );
            if (result.status === "success") {
              window.requestAnimationFrame(() =>
                requestEditorRangeReveal({
                  tabId: activeTab.id,
                  range: result.appliedRange,
                  focus: true,
                }),
              );
            }
            return result;
          }}
        />
      )}

      {activeTab.fileError && (
        <div className="flex min-h-7 items-center border-b border-red-500/25 bg-red-500/10 px-3 text-[10px] text-red-200">
          {activeTab.fileError}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {activeTab.agentFileDiffPreview ? (
          <DiffEditor
            height="100%"
            language={editorLanguageId}
            original={activeTab.agentFileDiffPreview.originalContent}
            modified={activeTab.agentFileDiffPreview.proposedContent}
            originalModelPath={`oxide-agent-diff://original/${activeTab.agentFileDiffPreview.turnId}/${activeTab.agentFileDiffPreview.callId}/${activeTab.agentFileDiffPreview.relativePath}`}
            modifiedModelPath={`oxide-agent-diff://proposed/${activeTab.agentFileDiffPreview.turnId}/${activeTab.agentFileDiffPreview.callId}/${activeTab.agentFileDiffPreview.relativePath}`}
            beforeMount={handleEditorBeforeMount}
            theme={mode === "light" ? "vs" : "oxide-dark"}
            options={{
              ...editorOptions,
              readOnly: true,
              originalEditable: false,
              renderSideBySide: true,
              renderOverviewRuler: true,
              diffCodeLens: false,
              enableSplitViewResizing: true,
              renderIndicators: true,
              ignoreTrimWhitespace: false,
              minimap: { enabled: false },
              glyphMargin: false,
            }}
          />
        ) : activeTab.gitFileDiffPreview ? (
          <DiffEditor
            height="100%"
            language={editorLanguageId}
            original={activeTab.gitFileDiffPreview.originalContent}
            modified={activeTab.gitFileDiffPreview.modifiedContent}
            originalModelPath={`oxide-git-diff://original/${activeTab.gitFileDiffPreview.scope}/${activeTab.gitFileDiffPreview.relativePath}`}
            modifiedModelPath={`oxide-git-diff://modified/${activeTab.gitFileDiffPreview.scope}/${activeTab.gitFileDiffPreview.relativePath}`}
            beforeMount={handleEditorBeforeMount}
            theme={mode === "light" ? "vs" : "oxide-dark"}
            options={{
              ...editorOptions,
              readOnly: true,
              originalEditable: false,
              renderSideBySide: true,
              renderOverviewRuler: true,
              diffCodeLens: false,
              enableSplitViewResizing: true,
              renderIndicators: true,
              ignoreTrimWhitespace: false,
              minimap: { enabled: false },
              glyphMargin: false,
            }}
          />
        ) : activeTab.filePreview?.kind === "image" ? (
          <ProjectFileImagePreview
            dataUrl={activeTab.filePreview.dataUrl}
            fileName={activeTab.title}
            mediaType={activeTab.filePreview.mediaType}
            size={activeTab.filePreview.size}
          />
        ) : (
          <Editor
            height="100%"
            defaultLanguage="sql"
            language={editorLanguageId}
            path={documentUri}
            keepCurrentModel
            value={activeTab.sql}
            onChange={handleEditorContentChange}
            onMount={handleEditorMount}
            beforeMount={handleEditorBeforeMount}
            // Theme is updated via useEffect to ensure it responds to context
            options={editorOptions}
          />
        )}
      </div>
      {isActivePane &&
        !isProjectFilePreview &&
        !activeTab.agentFileDiffPreview &&
        !activeTab.gitFileDiffPreview && (
        <StatusBarPortal>
          <div className="flex h-full items-center text-[10px] text-[hsl(var(--wb-text-muted))]">
            <span className="whitespace-nowrap px-2">
              {cursorPosition.line}:{cursorPosition.column}
            </span>
            <span className="wb-editor-status-secondary whitespace-nowrap px-2">
              LF
            </span>
            <span className="wb-editor-status-secondary whitespace-nowrap px-2">
              UTF-8
            </span>
            <span className="wb-editor-status-secondary whitespace-nowrap px-2">
              {editorSettings.tabSize} spaces
            </span>
            {editorSettings.keybindingMode === "vim" && (
              <span
                ref={vimStatusNodeRef}
                className="min-w-28 max-w-72 flex-1 truncate px-2 font-mono text-[9px] text-[hsl(var(--wb-accent))] [&_input]:h-5 [&_input]:max-w-48 [&_input]:border-0 [&_input]:bg-transparent [&_input]:font-mono [&_input]:text-[hsl(var(--wb-text))] [&_input]:outline-none"
                aria-label="Vim status"
              />
            )}
            {editorSettings.inlineCompletion.enabled && (
              <span
                className="wb-editor-status-secondary whitespace-nowrap px-2"
                title="Inline completion status"
              >
                AI {inlineCompletionStatus}
              </span>
            )}
            {executionNotice && (
              <span
                role="status"
                aria-live="polite"
                className="max-w-64 truncate px-2 text-[hsl(var(--wb-accent))]"
                title={executionNotice}
              >
                {executionNotice}
              </span>
            )}
            <span
              className="flex h-full w-7 items-center justify-center"
              title="SQL execution is permission-gated"
            >
              <LockKeyhole size={11} />
            </span>
            {canUseLsp && (
              <span
                className="wb-editor-status-lsp flex items-center gap-1 whitespace-nowrap px-2"
                title={
                  lspError ||
                  `${
                    isElasticsearchConsole
                      ? "Elasticsearch DSL completion"
                      : usesGenericSqlLsp
                        ? "Generic SQL completion: catalog objects are available, but vendor-specific syntax diagnostics are not claimed"
                      : "SQL language service"
                  }: ${lspStatus}${
                    visibleLspSemanticPresentation
                      ? ` — ${visibleLspSemanticPresentation.title}`
                      : ""
                  }`
                }
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    lspStatus === "error"
                        ? "bg-red-400"
                        : !lspReady || visibleLspSemanticPresentation?.attention
                          ? "bg-amber-400"
                          : lspReady
                            ? "bg-emerald-400"
                        : "bg-amber-400",
                  )}
                />
                {isElasticsearchConsole
                  ? "DSL"
                  : usesGenericSqlLsp
                    ? "SQL generic"
                    : "SQL"}{" "}
                {lspReady
                  ? "ready"
                  : lspStatus === "error"
                    ? "error"
                    : "starting"}
                {visibleLspSemanticPresentation
                  ? ` · ${visibleLspSemanticPresentation.label}`
                  : ""}
              </span>
            )}
          </div>
        </StatusBarPortal>
      )}
    </div>
  );
}
