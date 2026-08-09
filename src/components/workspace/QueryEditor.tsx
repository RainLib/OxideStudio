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
  type DatabaseCapabilities,
  type TableInfo,
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
import { lspForeignKeyRelationships } from "@/services/lsp/relationshipIndex";
import type { LspServerNotification } from "@/services/lsp";
import {
  APP_EVENT_RUN_QUERY,
  APP_EVENT_RUN_CURRENT,
  APP_EVENT_FORMAT_SQL,
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
import { sqlInsertValueHints } from "@/lib/sqlInsertValueHints";
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
import {
  revealLspDatabaseDefinition,
  revealLspProjectDefinition,
} from "@/lib/lspNavigation";
import { lspSemanticStatusPresentation } from "@/lib/lspSemanticStatus";
import { useTaskStore } from "@/store/useTaskStore";
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
  cachedSqlJoinTargetContext,
  cachedSqlRelationForFieldCompletion,
  cachedSqlRelationTargetPrefix,
} from "@/lib/queryEditorCachedCompletion";
import {
  buildQueryEditorTableHoverMarkdown,
  findQueryEditorHoverTable,
  isSqlRelationIdentifierContext,
  sqlIdentifierAtColumn,
} from "@/lib/queryEditorTableHover";
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
  shouldOfferElasticsearchCompletions,
  shouldTriggerElasticsearchCompletions,
  validateElasticsearchConsole,
} from "@/lib/elasticsearchConsole";
import type { ElasticsearchAnalysisResponse } from "@/workers/elasticsearchAnalysis.worker";
import type { ElasticsearchServerVersion } from "@/lib/elasticsearchConsole";
import type {
  ConstraintInfo,
  SqlScriptImportPreview,
} from "@/services/tauri/types";
import {
  shouldOfferMongoDbCompletions,
  shouldTriggerMongoDbCompletions,
} from "@/lib/mongodbCompletion";
import {
  buildQueryEditorOptions,
  appendSqlCompletionSpace,
  completionFilterTextForQuery,
  completionMatchScore,
  completionMatches,
  containsHan,
  currentStatementLineFrames,
  elasticsearchJsonStringCompletionRange,
  editorDocumentIdentity,
  enqueueLspDocumentSync,
  ensurePinyinCompletionSupport,
  flattenLspSelectionRanges,
  isPublishDiagnosticsParams,
  lspDiagnosticToMonacoMarker,
  lspCompletionItemsToMonacoSuggestions,
  lspDocumentationForMonaco,
  mergeCatalogNames,
  mergeCompletionFallbackSuggestions,
  mongodbCommandRangeAtCursor,
  parseElasticsearchConsoleServerVersion,
  quoteSqlIdentifierSelection,
  recordSqlCompletionTelemetry,
  sqlInListFromClipboard,
  sqlForeignKeyJoinCompletions,
  sqlJoinConstraintsFromRelationshipIndex,
  sqlSyntaxFallbackCompletions,
  sqlCompletionItemType,
  sqlCompletionIdentifierPrefix,
  sqlCompletionTriggerDecision,
  syncLspModelBeforeCompletion,
  toMonacoRange,
  toMonacoWorkspaceEdit,
  unquoteSqlIdentifierSelection,
  useQueryExecutionController,
  useQueryTransactionController,
} from "@/features/query-editor";

type PendingSqlScriptImport = {
  connectionId: string;
  filePath: string;
  schema?: string;
  database?: string;
  target: string;
  preview: SqlScriptImportPreview;
  taskId: string;
};
const RECORD_COMPLETION_USAGE_COMMAND = "oxide.sqlCompletion.recordUsage";
const SQL_COMPLETION_CONTEXT_MAX_CHARACTERS = 128 * 1024;
const RELATION_COMPLETION_CONTEXTS = new Set([
  "from",
  "join",
  "into",
  "update",
  "table",
  "truncate",
  "describe",
  "desc",
]);

export function boundedSqlCompletionTextBeforeCursor(
  monaco: any,
  model: any,
  position: any,
) {
  if (
    typeof model.getOffsetAt !== "function" ||
    typeof model.getPositionAt !== "function"
  ) {
    return model.getValueInRange(
      new monaco.Range(1, 1, position.lineNumber, position.column),
    );
  }
  const cursorOffset = model.getOffsetAt(position);
  const requestedStart = Math.max(
    0,
    cursorOffset - SQL_COMPLETION_CONTEXT_MAX_CHARACTERS,
  );
  const requestedPosition = model.getPositionAt(requestedStart);
  // Start at the beginning of the containing line so an identifier or SQL
  // keyword is never split merely because the bounded window starts there.
  return model.getValueInRange(
    new monaco.Range(
      requestedPosition.lineNumber,
      1,
      position.lineNumber,
      position.column,
    ),
  );
}

export function cachedRelationCompletionSuggestions(
  monaco: any,
  model: any,
  position: any,
  tables: TableInfo[],
  textBeforeCursor = boundedSqlCompletionTextBeforeCursor(
    monaco,
    model,
    position,
  ),
) {
  const relationPrefix = cachedSqlRelationTargetPrefix(textBeforeCursor);
  if (
    relationPrefix === null &&
    !RELATION_COMPLETION_CONTEXTS.has(
      sqlContextKeywordBeforeCursor(textBeforeCursor) || "",
    )
  ) {
    return [];
  }
  const word = model.getWordUntilPosition(position);
  const range = new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
  const query = relationPrefix ?? "";
  return tables
    .filter((table) => completionMatches(table.name, query))
    .map((table) => ({
    label: table.name,
    kind: monaco.languages.CompletionItemKind.Struct,
    detail: "Cached database object",
    documentation: table.comment
      ? { value: table.comment }
      : { value: "Available from cached database metadata." },
    insertText: table.name,
    filterText: completionFilterTextForQuery(table.name, query),
    sortText: `0:${String(9_999 - Math.max(0, completionMatchScore(table.name, query))).padStart(4, "0")}:${table.name.toLocaleLowerCase()}`,
    range,
  }));
}

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
  const {
    tabs,
    activeTabId,
    updateTabSql,
    setQueryLanguage,
    setElasticsearchVariables,
    runTabQuery,
    runExplainPlan,
    cancelTabQuery,
    setTargetSchema,
    setTargetDatabase,
    setEditorSelection,
    setLspDiagnostics,
    applyEditorPatchPreview,
    dismissEditorPatch,
  } = useTabStore(); // line 15...
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
  const metadataVersion = useSchemaStore((state) => state.metadataVersion);
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const loadTables = useSchemaStore((state) => state.loadTables);
  const bumpMetadataVersion = useSchemaStore(
    (state) => state.bumpMetadataVersion,
  );
  const { savedQueries, saveQuery, deleteQuery } = useSavedQueryStore();
  const editorSettings = useSettingsStore((state) => state.settings.editor);
  const keymap = useSettingsStore((state) => state.settings.keymap);
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiProviderConfig = useAiSettingsStore((state) => state.providerConfig);
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
  const [pendingSqlScriptImport, setPendingSqlScriptImport] =
    useState<PendingSqlScriptImport | null>(null);
  const [isSqlScriptImporting, setIsSqlScriptImporting] = useState(false);
  const [inlineCompletionStatus, setInlineCompletionStatus] =
    useState<InlineCompletionStatus>("off");
  const [elasticsearchServerVersion, setElasticsearchServerVersion] =
    useState<ElasticsearchServerVersion | undefined>();
  // const dropdownRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const [mountedEditor, setMountedEditor] = useState<any>(null);
  const effectiveTabId = tabId === undefined ? activeTabId : tabId;
  const activeTabIdRef = useRef<string | null>(effectiveTabId);
  const selectionDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const elasticsearchSuggestDisposableRef = useRef<{
    dispose: () => void;
  } | null>(null);
  const elasticsearchSuggestTimerRef = useRef<number | null>(null);
  const vimControllerRef = useRef<VimModeController | null>(null);
  const vimModeRef = useRef("NORMAL");
  const inlineKeysContextRef = useRef<{ set: (value: boolean) => void } | null>(
    null,
  );
  const vimStatusNodeRef = useRef<HTMLSpanElement | null>(null);
  const openedDocumentsRef = useRef<Set<string>>(new Set());
  const documentSessionsRef = useRef<
    Map<
      string,
      {
        sessionKey: string;
        client: { didClose: (uri: string) => Promise<void> };
      }
    >
  >(new Map());
  const documentVersionsRef = useRef<Map<string, number>>(new Map());
  const documentTextsRef = useRef<Map<string, string>>(new Map());
  const documentSyncChainsRef = useRef<Map<string, Promise<void>>>(new Map());
  const activeLspDocumentUriRef = useRef<string | null>(null);
  const lastLspSessionKeyRef = useRef<string | null>(null);
  const completionRequestGenerationRef = useRef<Map<string, number>>(new Map());
  const completionTriggerOriginRef = useRef<"explicit" | null>(null);
  const inlineCompletionCacheRef = useRef(new InlineCompletionCache());
  const inlineCompletionAbortRef = useRef<AbortController | null>(null);
  const inlineCompletionListenersRef = useRef(new Set<() => void>());
  const runAllActionRef = useRef<() => void>(() => {});
  const runCurrentActionRef = useRef<() => void>(() => {});
  const formatActionRef = useRef<() => void>(() => {});
  const elasticsearchAnalysisWorkerRef = useRef<Worker | null>(null);
  const elasticsearchAnalysisTimerRef = useRef<number | null>(null);
  const elasticsearchAnalysisRequestIdRef = useRef(0);
  const elasticsearchAnalysisApplyRef = useRef<
    ((response: ElasticsearchAnalysisResponse) => void) | null
  >(null);
  const elasticsearchDecorationIdsRef = useRef<string[]>([]);
  const currentStatementDecorationIdsRef = useRef<string[]>([]);
  const currentStatementTimerRef = useRef<number | null>(null);
  const currentStatementRequestRef = useRef(0);
  const elasticsearchRequestLinesRef = useRef<Set<number>>(new Set());
  const elasticsearchFieldCacheRef = useRef<
    Map<string, Array<{ name: string; dataType: string }>>
  >(new Map());
  const sqlFieldCacheRef = useRef<
    Map<
      string,
      Array<{ name: string; dataType: string; comment?: string | null }>
    >
  >(new Map());
  const sqlJoinConstraintCacheRef = useRef<Map<string, ConstraintInfo[]>>(
    new Map(),
  );
  const pendingElasticsearchSqlRef = useRef<{
    tabId: string;
    value: string;
  } | null>(null);
  const pendingElasticsearchSqlTimerRef = useRef<number | null>(null);
  const activeTab = tabs.find((t) => t.id === effectiveTabId);
  const effectiveConnectionId = activeTab?.connectionId || activeConnectionId;
  const activeConnection = connections.find(
    (c) => c.id === effectiveConnectionId,
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
    tabs,
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
    supportsExplainPlan: capabilities.supportsExplainPlan,
    confirmExecution: confirmEditorExecution,
    editorRef,
    transactionIdForExecution,
    updateTabSql,
    runTabQuery,
    runExplainPlan,
    cancelTabQuery,
  });
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

  useEffect(() => {
    if (!isProjectFilePreview) return;
    selectionDisposableRef.current?.dispose();
    selectionDisposableRef.current = null;
    elasticsearchSuggestDisposableRef.current?.dispose();
    elasticsearchSuggestDisposableRef.current = null;
    editorRef.current = null;
    setMountedEditor(null);
  }, [isProjectFilePreview]);

  useEffect(() => {
    return () => {
      selectionDisposableRef.current?.dispose();
      selectionDisposableRef.current = null;
      elasticsearchSuggestDisposableRef.current?.dispose();
      elasticsearchSuggestDisposableRef.current = null;
      if (elasticsearchSuggestTimerRef.current !== null) {
        window.clearTimeout(elasticsearchSuggestTimerRef.current);
        elasticsearchSuggestTimerRef.current = null;
      }
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
    if (!lspReady || !activeTab || !documentUri || !canUseLsp) {
      activeLspDocumentUriRef.current = null;
      return;
    }
    activeLspDocumentUriRef.current = documentUri;

    // A connection can be pinned to a driver package whose LSP dialect differs
    // from the current catalog default. Close that tab's former virtual model
    // before opening the new URI so the server never keeps two dialects for
    // one editor tab alive at once.
    for (const staleUri of Array.from(openedDocumentsRef.current)) {
      const staleIdentity = extractLspDocumentIdentity(staleUri);
      if (staleUri === documentUri || staleIdentity?.tabId !== activeTab.id) {
        continue;
      }
      openedDocumentsRef.current.delete(staleUri);
      documentVersionsRef.current.delete(staleUri);
      documentTextsRef.current.delete(staleUri);
      documentSyncChainsRef.current.delete(staleUri);
      completionRequestGenerationRef.current.delete(staleUri);
      const staleOwner = documentSessionsRef.current.get(staleUri);
      documentSessionsRef.current.delete(staleUri);
      if (staleOwner) void staleOwner.client.didClose(staleUri);
    }

    // Serialize writes to a URI. A fast typing burst becomes didOpen(text 1)
    // followed by didChange(text 2), rather than racing didOpen calls that
    // share a version. The helper commits local shadow state only after the
    // LSP accepts the write, so a restart remains retryable.
    void enqueueLspDocumentSync(
      documentSyncChainsRef.current,
      documentUri,
      async () => {
        if (activeLspDocumentUriRef.current !== documentUri) return;
        const owner = documentSessionsRef.current.get(documentUri);
        if (owner?.sessionKey !== lspSessionKey) {
          documentSessionsRef.current.delete(documentUri);
          if (owner) {
            await owner.client.didClose(documentUri).catch(() => undefined);
          }
        }

        await syncLspModelBeforeCompletion({
          uri: documentUri,
          model: { getValue: () => activeDocumentSql },
          languageId: documentLanguageId,
          client: lspClient,
          openedDocuments: openedDocumentsRef.current,
          documentVersions: documentVersionsRef.current,
          documentTexts: documentTextsRef.current,
        });

        if (
          activeLspDocumentUriRef.current === documentUri &&
          openedDocumentsRef.current.has(documentUri)
        ) {
          documentSessionsRef.current.set(documentUri, {
            sessionKey: lspSessionKey,
            client: lspClient,
          });
        }
      },
    )
      .catch((error) => {
        // Completion retries the exact failed revision through the same
        // coordinator; a transient LSP restart must not tear down Monaco.
        console.debug("[LSP] Deferred document synchronization failed:", error);
      });
  }, [
    activeTab?.id,
    activeDocumentSql,
    canUseLsp,
    documentLanguageId,
    documentUri,
    editorLanguageId,
    lspClient,
    lspReady,
    lspSessionKey,
    driverCatalogStatus,
  ]);

  useEffect(() => {
    if (lspReady) return;
    activeLspDocumentUriRef.current = null;
    for (const [uri, owner] of documentSessionsRef.current) {
      documentSessionsRef.current.delete(uri);
      openedDocumentsRef.current.delete(uri);
      documentVersionsRef.current.delete(uri);
      documentTextsRef.current.delete(uri);
      documentSyncChainsRef.current.delete(uri);
      completionRequestGenerationRef.current.delete(uri);
      void owner.client.didClose(uri).catch(() => undefined);
    }
  }, [lspReady, lspSessionKey]);

  useEffect(() => {
    if (!lspReady) return;

    const currentDocumentTabIds = new Set(
      tabs
        .filter((tab) => tab.type === "query")
        .map((tab) => tab.id),
    );

    for (const uri of Array.from(openedDocumentsRef.current)) {
      const identity = extractLspDocumentIdentity(uri);
      if (identity && currentDocumentTabIds.has(identity.tabId)) continue;

      openedDocumentsRef.current.delete(uri);
      documentVersionsRef.current.delete(uri);
      documentTextsRef.current.delete(uri);
      documentSyncChainsRef.current.delete(uri);
      completionRequestGenerationRef.current.delete(uri);
      const owner = documentSessionsRef.current.get(uri);
      documentSessionsRef.current.delete(uri);
      if (owner) void owner.client.didClose(uri);

      if (monaco) {
        const model = monaco.editor.getModel(monaco.Uri.parse(uri));
        if (model) {
          monaco.editor.setModelMarkers(model, "sql-lsp", []);
        }
      }
    }
  }, [lspReady, monaco, tabs]);

  useEffect(() => {
    return () => {
      for (const [uri, owner] of documentSessionsRef.current) {
        void owner.client.didClose(uri);
        if (monaco) {
          const model = monaco.editor.getModel(monaco.Uri.parse(uri));
          if (model) {
            monaco.editor.setModelMarkers(model, "sql-lsp", []);
          }
        }
      }
      openedDocumentsRef.current.clear();
      documentSessionsRef.current.clear();
      documentVersionsRef.current.clear();
      documentTextsRef.current.clear();
      documentSyncChainsRef.current.clear();
      completionRequestGenerationRef.current.clear();
    };
  }, [monaco]);

  useEffect(() => {
    const previousSessionKey = lastLspSessionKeyRef.current;
    lastLspSessionKeyRef.current = lspSessionKey;
    if (!previousSessionKey || previousSessionKey === lspSessionKey) return;
    for (const [uri, owner] of documentSessionsRef.current) {
      if (owner.sessionKey === lspSessionKey) continue;
      documentSessionsRef.current.delete(uri);
      void owner.client.didClose(uri).catch(() => undefined);
    }
    openedDocumentsRef.current.clear();
    documentVersionsRef.current.clear();
    documentTextsRef.current.clear();
    documentSyncChainsRef.current.clear();
    completionRequestGenerationRef.current.clear();
  }, [lspSessionKey]);

  useEffect(() => {
    elasticsearchFieldCacheRef.current.clear();
    sqlFieldCacheRef.current.clear();
    sqlJoinConstraintCacheRef.current.clear();
  }, [effectiveConnectionId, metadataVersion]);

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
          if (!expectsMappingField) {
            return { suggestions: [] };
          }

          const requestContext = elasticsearchConsoleRequestContext(
            source,
            offset,
            preferredElasticsearchIndex,
          );
          const indexName = requestContext.index?.trim();
          if (!indexName) {
            return { suggestions: [] };
          }

          const cacheKey = [
            activeProjectId || "local",
            effectiveConnectionId,
            elasticsearchMetadataNamespace,
            indexName,
          ].join("\u0000");
          const modelVersion = model.getVersionId();
          let fields = elasticsearchFieldCacheRef.current.get(cacheKey);
          if (!fields) {
            try {
              const metadataOptions = {
                projectId: activeProjectId || undefined,
                connectionId: effectiveConnectionId,
                driver: "elasticsearch" as const,
                schema: elasticsearchMetadataNamespace,
                table: indexName,
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
              fields = metadata.columns.map((column) => ({
                name: column.name,
                dataType: column.data_type || "field",
              }));
              elasticsearchFieldCacheRef.current.set(cacheKey, fields);
            } catch (error) {
              console.debug(
                `[Elasticsearch Console] Mapping fields unavailable for ${indexName}`,
                error,
              );
              fields = [];
            }
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
          let fieldCompletions = elasticsearchMappingFieldCompletions(
            fields,
            completionContext,
            indexName,
          );

          // Keep the already-synchronized LSP catalog as a fallback when the
          // live Mapping request is unavailable (for example during a brief
          // reconnect). This provider owns field positions, so results remain
          // deduplicated instead of being emitted by two Monaco providers.
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

  // Register LSP providers (completion, hover, navigation, formatting)
  useEffect(() => {
    // Keep cached relation completion available while the semantic server is
    // starting or recovering. It is deliberately limited to existing Explorer
    // metadata and relation-only SQL contexts; the full LSP still owns fields,
    // keywords, diagnostics, and every vendor-specific proposal once ready.
    if (!isActivePane || !monaco) return;

    console.log("[QueryEditor] Registering LSP providers");
    // Monaco providers are global per language. Register only the language of
    // this model instead of multiplying every provider across SQL, JSON,
    // plaintext and console languages on each active editor.
    const providerLanguages = [editorLanguageId];

    const usageScope = completionUsageScope([
      activeProjectId,
      effectiveConnectionId,
      activeTab?.databaseName,
      activeTab?.targetSchema || currentSchema,
      driver,
    ]);
    const rankByUsage = editorSettings.sqlCompletion.rankByUsage;
    // Monaco providers are global per language. Scope them to the document
    // owned by this editor instance so a background tab cannot be served by
    // the active connection's LSP client or its pinned driver package.
    const isCurrentLspModelUri = (uri: string) =>
      uri === documentUri && canUseLsp;
    const usageCommandDisposable = monaco.editor.registerCommand(
      RECORD_COMPLETION_USAGE_COMMAND,
      (_accessor: unknown, scope: string, label: string) => {
        if (rankByUsage && scope === usageScope) {
          recordCompletionUsage(scope, label);
        }
      },
    );

    const completionDisposables = providerLanguages.map((language) =>
      monaco.languages.registerCompletionItemProvider(language, {
        triggerCharacters:
          language === ELASTICSEARCH_CONSOLE_LANGUAGE_ID
            ? ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS
            : [" ", ".", "(", ",", '"', "@", "/", "{", ":"],
        provideCompletionItems: async (
          model: any,
          position: any,
          context: any,
          token: { isCancellationRequested?: boolean },
        ) => {
          const completionStartedAt = performance.now();
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
          const isSqlCompletionDocument = ![
            "elasticsearch",
            "elastic",
            "mongodb",
          ].includes(completionDriver);
          const explicitCompletion =
            completionTriggerOriginRef.current === "explicit";
          completionTriggerOriginRef.current = null;
          if (isSqlCompletionDocument) {
            const trigger = sqlCompletionTriggerDecision(
              editorSettings.sqlCompletion.triggerMode,
              textBeforeCursor,
              explicitCompletion,
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
          const cachedRelationSuggestions = async () => {
            if (["elasticsearch", "elastic", "mongodb"].includes(completionDriver)) {
              return [];
            }
            const relationPrefix = cachedSqlRelationTargetPrefix(textBeforeCursor);
            if (
              relationPrefix &&
              /^[a-z0-9]+$/iu.test(relationPrefix) &&
              schemaTables.some((table) => containsHan(table.name))
            ) {
              await ensurePinyinCompletionSupport();
            }
            return cachedRelationCompletionSuggestions(
              monaco,
              model,
              position,
              schemaTables,
              textBeforeCursor,
            );
          };
          const cachedJoinSuggestions = async () => {
            if (
              !effectiveConnectionId ||
              ["elasticsearch", "elastic", "mongodb"].includes(
                completionDriver,
              )
            ) {
              return [];
            }
            const joinContext = cachedSqlJoinTargetContext(textBeforeCursor);
            const sourceRelation = joinContext?.sourceRelations
              .slice()
              .reverse()
              .find((relation) => !relation.isCte);
            if (!joinContext || !sourceRelation) return [];

            const schema =
              sourceRelation.schema ||
              activeTab?.targetSchema ||
              currentSchema ||
              activeTab?.databaseName ||
              undefined;
            if (!schema) return [];
            const databaseName =
              sourceRelation.database || activeTab?.databaseName || undefined;
            const cacheKey = [
              activeProjectId || "local",
              effectiveConnectionId,
              driver,
              databaseName || "",
              schema,
              sourceRelation.table,
              "foreign-keys",
            ].join("\u0000");
            const modelVersion = model.getVersionId();
            let constraints = sqlJoinConstraintCacheRef.current.get(cacheKey);
            if (!constraints) {
              const indexedConstraints =
                sqlJoinConstraintsFromRelationshipIndex(
                  sourceRelation,
                  schema,
                  lspForeignKeyRelationships({
                    connectionId: effectiveConnectionId,
                    driver,
                    databaseName,
                    schema,
                  }),
                );
              try {
                const metadata = await loadTableMetadata({
                  projectId: activeProjectId || undefined,
                  connectionId: effectiveConnectionId,
                  driver,
                  databaseName,
                  schema,
                  table: sourceRelation.table,
                  includeIndexes: false,
                  includeConstraints: true,
                });
                constraints = [...indexedConstraints, ...metadata.constraints];
              } catch (error) {
                console.debug(
                  `[QueryEditor] Foreign-key metadata unavailable for ${sourceRelation.table}`,
                  error,
                );
                constraints = indexedConstraints;
              }
              sqlJoinConstraintCacheRef.current.set(cacheKey, constraints);
            }
            if (
              token?.isCancellationRequested ||
              model.getVersionId() !== modelVersion
            ) {
              return [];
            }
            const joinPrefix = joinContext.targetFragment
              .split(".")
              .pop()
              ?.trim() || "";
            if (
              /^[a-z0-9]+$/iu.test(joinPrefix) &&
              constraints.some((constraint) =>
                containsHan(constraint.referenced_table || ""),
              )
            ) {
              await ensurePinyinCompletionSupport();
            }

            const word = model.getWordUntilPosition(position);
            const range = new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn,
            );
            return sqlForeignKeyJoinCompletions(
              joinContext,
              sourceRelation,
              constraints,
              {
                driver,
                defaultSchema: schema,
                keywordCase:
                  editorSettings.sqlCompletion.keywordCase === "preserve"
                    ? undefined
                    : editorSettings.sqlCompletion.keywordCase,
              },
            ).map((completion) => ({
              ...completion,
              kind: monaco.languages.CompletionItemKind.Reference,
              documentation: { value: completion.documentation },
              range,
            }));
          };
          const cachedFieldSuggestions = async () => {
            if (
              !effectiveConnectionId ||
              ["elasticsearch", "elastic", "mongodb"].includes(
                completionDriver,
              )
            ) {
              return [];
            }
            if (
              RELATION_COMPLETION_CONTEXTS.has(
                sqlContextKeywordBeforeCursor(textBeforeCursor) || "",
              )
            ) {
              return [];
            }
            const relation = cachedSqlRelationForFieldCompletion(textBeforeCursor);
            if (!relation) return [];
            const fieldQuery = sqlCompletionIdentifierPrefix(textBeforeCursor);

            const word = model.getWordUntilPosition(position);
            const range = new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn,
            );
            // A CTE shadows physical objects with the same name. Only an
            // explicit CTE column list is losslessly available to this
            // fallback; otherwise wait for the language service instead of
            // querying unrelated table metadata.
            if (relation.isCte || relation.isDerived) {
              const relationKind = relation.isDerived
                ? "Derived table"
                : "CTE";
              const declaredColumns = relation.cteColumns || [];
              if (
                /^[a-z0-9]+$/iu.test(fieldQuery) &&
                declaredColumns.some(containsHan)
              ) {
                await ensurePinyinCompletionSupport();
              }
              return declaredColumns
                .filter((column) => completionMatches(column, fieldQuery))
                .map((column) => ({
                label: column,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${relationKind} column`,
                documentation: {
                  value: `Column declared by ${relationKind.toLocaleLowerCase()} ${relation.table}.`,
                },
                insertText: column,
                filterText: completionFilterTextForQuery(column, fieldQuery),
                sortText: `0:${String(9_999 - Math.max(0, completionMatchScore(column, fieldQuery))).padStart(4, "0")}:${column.toLocaleLowerCase()}`,
                range,
              }));
            }

            const schema =
              relation.schema ||
              activeTab?.targetSchema ||
              currentSchema ||
              activeTab?.databaseName ||
              undefined;
            // Table metadata is namespace-scoped. Do not turn an ambiguous
            // unqualified relation into a request with a fabricated schema:
            // the normal relation/keyword fallback remains available until
            // the editor has a concrete namespace context.
            if (!schema) return [];
            const databaseName =
              relation.database || activeTab?.databaseName || undefined;
            const cacheKey = [
              activeProjectId || "local",
              effectiveConnectionId,
              driver,
              databaseName || "",
              schema,
              relation.table,
            ].join("\u0000");
            let columns = sqlFieldCacheRef.current.get(cacheKey);
            if (!columns) {
              try {
                const metadata = await loadTableMetadata({
                  projectId: activeProjectId || undefined,
                  connectionId: effectiveConnectionId,
                  driver,
                  databaseName,
                  schema,
                  table: relation.table,
                  includeIndexes: false,
                  includeConstraints: false,
                });
                columns = metadata.columns.map((column) => ({
                  name: column.name,
                  dataType: column.data_type || "column",
                  comment: column.comment,
                }));
                sqlFieldCacheRef.current.set(cacheKey, columns);
              } catch (error) {
                console.debug(
                  `[QueryEditor] Cached field metadata unavailable for ${relation.table}`,
                  error,
                );
                return [];
              }
            }
            if (token?.isCancellationRequested) return [];
            if (
              /^[a-z0-9]+$/iu.test(fieldQuery) &&
              columns.some((column) => containsHan(column.name))
            ) {
              await ensurePinyinCompletionSupport();
            }
            return columns
              .filter((column) => completionMatches(column.name, fieldQuery))
              .map((column) => ({
              label: column.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `Cached ${column.dataType}`,
              documentation: column.comment
                ? { value: column.comment }
                : { value: `Column from cached metadata for ${relation.table}.` },
              insertText: column.name,
              filterText: completionFilterTextForQuery(
                column.name,
                fieldQuery,
              ),
              sortText: `0:${String(9_999 - Math.max(0, completionMatchScore(column.name, fieldQuery))).padStart(4, "0")}:${column.name.toLocaleLowerCase()}`,
              range,
            }));
          };
          const cachedMetadataSuggestions = async () => {
            const fields = await cachedFieldSuggestions();
            return fields.length > 0 ? fields : cachedRelationSuggestions();
          };
          const cachedSuggestions = async () => {
            const joins = await cachedJoinSuggestions();
            return mergeCompletionFallbackSuggestions(
              joins,
              await cachedMetadataSuggestions(),
            );
          };
          const fallbackSuggestions = async () => {
            const cached = await cachedSuggestions();
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
              keywordCase: editorSettings.sqlCompletion.keywordCase,
              snippets: editorSettings.sqlCompletion.snippets,
            }).map((item) => ({
              label: item.label,
              kind: toMonacoCompletionKind(monaco, item.kind),
              detail: item.detail || "SQL syntax",
              documentation: item.documentation
                ? { value: item.documentation }
                : { value: "Available SQL syntax for the current clause." },
              // Use the same completed-keyword replacement semantics as a
              // live LSP response. In particular, an offline/restarting LSP
              // must append ` DISTINCT` after a typed `SELECT`, not replace
              // the statement keyword with the fallback proposal.
              insertText: appendSqlCompletionSpace(
                completionInsertText(item, completedContextKeyword),
                {
                  enabled: editorSettings.sqlCompletion.appendSpace,
                  itemType: sqlCompletionItemType(item),
                  nextCharacter,
                },
              ),
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
              command: rankByUsage
                ? {
                    id: RECORD_COMPLETION_USAGE_COMMAND,
                    title: "Record SQL completion usage",
                    arguments: [usageScope, item.label],
                  }
                : undefined,
              insertTextRules:
                item.insertTextFormat === 2
                  ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
              range: insertRange,
            }));
            return mergeCompletionFallbackSuggestions(cached, syntax);
          };
          const result = (
            suggestions: any[],
            outcome: "lsp" | "fallback" | "empty" | "discarded" | "error",
            reason?: string,
          ) => {
            recordSqlCompletionTelemetry({
              scope: usageScope,
              outcome,
              durationMs: performance.now() - completionStartedAt,
              suggestionCount: suggestions.length,
              reason,
            });
            return { suggestions };
          };
          try {
            const uri = model.uri.toString();
            if (!isCurrentLspModelUri(uri)) return { suggestions: [] };
            const modelVersion = model.getVersionId();
            const requestGeneration =
              (completionRequestGenerationRef.current.get(uri) || 0) + 1;
            completionRequestGenerationRef.current.set(uri, requestGeneration);

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
            if (
              elasticsearchContext &&
              elasticsearchContext.area !== "path"
            ) {
              // Console syntax owns methods, REST operations, and Query DSL
              // keys. Mapping fields are supplied by the current-index
              // provider below, which does not have to wait for a full LSP
              // catalog sync and cannot leak fields from another index.
              return result([], "empty", "consoleSyntaxOwned");
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
            const items = await lspClient.getCompletions(
              uri,
              position.lineNumber - 1, // LSP uses 0-indexed lines
              position.column - 1, // LSP uses 0-indexed columns
              toLspCompletionContext(context),
            );

            if (
              token?.isCancellationRequested ||
              model.getVersionId() !== modelVersion ||
              completionRequestGenerationRef.current.get(uri) !==
                requestGeneration
            ) {
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
                    keywordCase: editorSettings.sqlCompletion.keywordCase,
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
              appendSpace: editorSettings.sqlCompletion.appendSpace,
              nextCharacter,
            });
            const suggestionsWithMetadata = mergeCompletionFallbackSuggestions(
              suggestions,
              await cachedMetadataSuggestions(),
            );
            const suggestionsWithSmartJoins =
              mergeCompletionFallbackSuggestions(
                await cachedJoinSuggestions(),
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
            if (suggestionsWithSmartJoins.length > 0) {
              return result(suggestionsWithSmartJoins, "lsp");
            }
            const fallback = await fallbackSuggestions();
            return result(
              fallback,
              fallback.length > 0 ? "fallback" : "empty",
              fallback.length > 0 ? "emptyLsp" : "emptyLspNoFallback",
            );
          } catch (error) {
            console.error("[LSP] Completion failed:", error);
            const fallback = await fallbackSuggestions();
            return result(fallback, "error", fallback.length > 0 ? "lspErrorFallback" : "lspErrorEmpty");
          }
        },
      }),
    );

    const hoverDisposables = providerLanguages.map((language) =>
      monaco.languages.registerHoverProvider(language, {
        provideHover: async (model: any, position: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return null;
          const hoverModelVersion = model.getVersionId();
          try {
            const identity = extractLspDocumentIdentity(uri);
            await syncLspModelBeforeCompletion({
              uri,
              model,
              languageId:
                identity?.driver?.toLowerCase() === driver.toLowerCase()
                  ? documentLanguageId
                  : identity?.driver
                    ? lspLanguageId(identity.driver)
                    : "sql",
              client: lspClient,
              openedDocuments: openedDocumentsRef.current,
              documentVersions: documentVersionsRef.current,
              documentTexts: documentTextsRef.current,
            });
          } catch {
            // Keep the cached server hover available during a transient sync
            // failure; metadata hover below remains independent and cached.
          }
          if (model.getVersionId() !== hoverModelVersion) return null;
          const line = model.getLineContent(position.lineNumber);
          const identifier = sqlIdentifierAtColumn(line, position.column);
          const relation =
            effectiveConnectionId &&
            capabilities.supportsTableBrowsing &&
            isSqlRelationIdentifierContext(line, position.column)
              ? findQueryEditorHoverTable(schemaTables, identifier)
              : null;
          const hoverSchema = activeTab?.targetSchema || currentSchema;
          const hoverConnectionId = effectiveConnectionId;
          const modelVersion = model.getVersionId();
          const [lspHover, metadata] = await Promise.all([
            lspClient
              .getHover(uri, position.lineNumber - 1, position.column - 1)
              .catch(() => null),
            relation && hoverSchema && hoverConnectionId
              ? loadTableMetadata({
                  projectId: activeProjectId || undefined,
                  connectionId: hoverConnectionId,
                  driver,
                  databaseName: activeTab?.databaseName || undefined,
                  schema: hoverSchema,
                  table: relation.name,
                  includeIndexes: true,
                  includeConstraints: false,
                }).catch(() => null)
              : Promise.resolve(null),
          ]);
          if (model.getVersionId() !== modelVersion) return null;

          const contents = [
            ...(metadata
              ? [
                  {
                    value: buildQueryEditorTableHoverMarkdown({
                      schema: hoverSchema,
                      table: { name: relation!.name, tableType: relation!.type },
                      columns: metadata.columns,
                      indexes: metadata.indexes,
                    }),
                  },
                ]
              : []),
            ...(lspHover ? [{ value: lspHover.contents }] : []),
          ];
          if (contents.length === 0) return null;
          const word = model.getWordAtPosition(position);
          const fallbackRange = word
            ? new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn,
              )
            : undefined;
          return {
            contents,
            range: lspHover?.range
              ? toMonacoRange(monaco, lspHover.range)
              : fallbackRange,
          };
        },
      }),
    );

    return () => {
      console.log("[QueryEditor] Disposing completion and hover providers");
      [
        usageCommandDisposable,
        ...completionDisposables,
        ...hoverDisposables,
      ].forEach((disposable) => disposable.dispose());
    };
  }, [
    isActivePane,
    activeProjectId,
    monaco,
    lspReady,
    lspClient,
    preferredElasticsearchIndex,
    activeTab?.databaseName,
    activeTab?.targetSchema,
    currentSchema,
    schemaTables,
    capabilities,
    driver,
    driverCatalogStatus,
    canUseLsp,
    documentLanguageId,
    documentUri,
    editorLanguageId,
    effectiveConnectionId,
    editorSettings.sqlCompletion.appendSpace,
    editorSettings.sqlCompletion.keywordCase,
    editorSettings.sqlCompletion.rankByUsage,
    editorSettings.sqlCompletion.snippets,
    editorSettings.sqlCompletion.triggerMode,
  ]);

  // Stable protocol providers do not depend on schema metadata or completion
  // preferences. Keeping them in their own lifecycle avoids tearing down
  // navigation, formatting, rename and semantic providers every time Explorer
  // metadata or a snippet setting changes.
  useEffect(() => {
    if (!isActivePane || !monaco) return;

    console.log("[QueryEditor] Registering core LSP providers");
    const providerLanguages = [editorLanguageId];
    const isCurrentLspModelUri = (uri: string) =>
      uri === documentUri && canUseLsp;

    const definitionDisposables = providerLanguages.map((language) =>
      monaco.languages.registerDefinitionProvider(language, {
        provideDefinition: async (model: any, position: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return [];

          const locations = await lspClient.getDefinitions(
            uri,
            position.lineNumber - 1,
            position.column - 1,
          );

          const editorLocations = [];
          for (const location of locations) {
            if (
              await revealLspDatabaseDefinition(
                location.uri,
                activeProjectId || "local"
              )
            ) {
              continue;
            }
            if (
              await revealLspProjectDefinition(
                location.uri,
                activeProjectId || "local",
              )
            ) {
              continue;
            }
            editorLocations.push({
              uri: monaco.Uri.parse(location.uri),
              range: toMonacoRange(monaco, location.range),
            });
          }
          return editorLocations;
        },
      }),
    );

    const referencesDisposables = providerLanguages.map((language) =>
      monaco.languages.registerReferenceProvider(language, {
        provideReferences: async (model: any, position: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return [];

          const locations = await lspClient.getReferences(
            uri,
            position.lineNumber - 1,
            position.column - 1,
          );

          return locations.map((location) => ({
            uri: monaco.Uri.parse(location.uri),
            range: toMonacoRange(monaco, location.range),
          }));
        },
      }),
    );

    const formattingDisposables = providerLanguages.map((language) =>
      monaco.languages.registerDocumentFormattingEditProvider(language, {
        provideDocumentFormattingEdits: async (model: any, options: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return [];

          const edits = await lspClient.formatDocument(
            uri,
            options.tabSize || 2,
            options.insertSpaces !== false,
          );

          return edits.map((edit) => ({
            range: toMonacoRange(monaco, edit.range),
            text: edit.newText,
          }));
        },
      }),
    );

    const rangeFormattingDisposables = providerLanguages.map((language) =>
      monaco.languages.registerDocumentRangeFormattingEditProvider(language, {
        provideDocumentRangeFormattingEdits: async (
          model: any,
          range: any,
          options: any
        ) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return [];
          const edits = await lspClient.formatRange(
            uri,
            {
              start: {
                line: range.startLineNumber - 1,
                character: range.startColumn - 1,
              },
              end: {
                line: range.endLineNumber - 1,
                character: range.endColumn - 1,
              },
            },
            options.tabSize || 2,
            options.insertSpaces !== false
          );
          return edits.map((edit) => ({
            range: toMonacoRange(monaco, edit.range),
            text: edit.newText,
          }));
        },
      })
    );

    const signatureDisposables = providerLanguages.map((language) =>
      monaco.languages.registerSignatureHelpProvider(language, {
        signatureHelpTriggerCharacters: ["(", ","],
        signatureHelpRetriggerCharacters: [","],
        provideSignatureHelp: async (model: any, position: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return null;
          const help = await lspClient.getSignatureHelp(
            uri,
            position.lineNumber - 1,
            position.column - 1
          );
          if (!help) return null;
          return {
            value: {
              signatures: help.signatures.map((signature) => ({
                label: signature.label,
                documentation: lspDocumentationForMonaco(signature.documentation),
                parameters: (signature.parameters || []).map((parameter) => ({
                  label: parameter.label,
                  documentation: lspDocumentationForMonaco(parameter.documentation),
                })),
                activeParameter: signature.activeParameter,
              })),
              activeSignature: help.activeSignature || 0,
              activeParameter: help.activeParameter || 0,
            },
            dispose: () => undefined,
          };
        },
      })
    );

    const renameDisposables = providerLanguages.map((language) =>
      monaco.languages.registerRenameProvider(language, {
        resolveRenameLocation: async (model: any, position: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
              text: "",
              rejectReason: "Database LSP is not active for this document.",
            };
          }
          const range = await lspClient.prepareRename(
            uri,
            position.lineNumber - 1,
            position.column - 1
          );
          if (!range) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
              text: "",
              rejectReason: "This symbol cannot be safely renamed.",
            };
          }
          return {
            range: toMonacoRange(monaco, range),
            text: model.getValueInRange(toMonacoRange(monaco, range)),
          };
        },
        provideRenameEdits: async (
          model: any,
          position: any,
          newName: string
        ) => {
          const uri = model.uri.toString();
          const edit = await lspClient.rename(
            uri,
            position.lineNumber - 1,
            position.column - 1,
            newName
          );
          return edit
            ? toMonacoWorkspaceEdit(monaco, edit)
            : { edits: [], rejectReason: "No safe rename edits were found." };
        },
      })
    );

    const codeActionDisposables = providerLanguages.map((language) =>
      monaco.languages.registerCodeActionProvider(
        language,
        {
          provideCodeActions: async (
            model: any,
            range: any,
            context: any
          ) => {
            const uri = model.uri.toString();
            if (!isCurrentLspModelUri(uri)) {
              return { actions: [], dispose: () => undefined };
            }
            const actions = await lspClient.getCodeActions(
              uri,
              {
                start: {
                  line: range.startLineNumber - 1,
                  character: range.startColumn - 1,
                },
                end: {
                  line: range.endLineNumber - 1,
                  character: range.endColumn - 1,
                },
              },
              (context.markers || []).map((marker: any) => ({
                range: {
                  start: {
                    line: marker.startLineNumber - 1,
                    character: marker.startColumn - 1,
                  },
                  end: {
                    line: marker.endLineNumber - 1,
                    character: marker.endColumn - 1,
                  },
                },
                severity:
                  marker.severity === monaco.MarkerSeverity.Error
                    ? 1
                    : marker.severity === monaco.MarkerSeverity.Warning
                      ? 2
                      : marker.severity === monaco.MarkerSeverity.Info
                        ? 3
                        : 4,
                code:
                  typeof marker.code === "object"
                    ? marker.code?.value
                    : marker.code,
                source: marker.source,
                message: marker.message,
              }))
            );
            return {
              actions: actions.map((action) => ({
                title: action.title,
                kind: action.kind,
                edit: action.edit
                  ? toMonacoWorkspaceEdit(monaco, action.edit)
                  : undefined,
                isPreferred: action.isPreferred,
                disabled: action.disabled?.reason,
              })),
              dispose: () => undefined,
            };
          },
        },
        {
          providedCodeActionKinds: ["quickfix", "refactor.rewrite", "source"],
        }
      )
    );

    const symbolDisposables = providerLanguages.map((language) =>
      monaco.languages.registerDocumentSymbolProvider(language, {
        displayName: "Database symbols",
        provideDocumentSymbols: async (model: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return [];
          const symbols = await lspClient.getDocumentSymbols(uri);
          const convertSymbol = (symbol: any): any => ({
            name: symbol.name,
            detail: symbol.detail || "",
            kind: Math.max(0, (symbol.kind || 1) - 1),
            tags: [],
            range: toMonacoRange(monaco, symbol.range),
            selectionRange: toMonacoRange(monaco, symbol.selectionRange),
            children: symbol.children?.map(convertSymbol),
          });
          return symbols.map(convertSymbol);
        },
      })
    );

    const foldingDisposables = providerLanguages.map((language) =>
      monaco.languages.registerFoldingRangeProvider(language, {
        provideFoldingRanges: async (model: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return [];
          return (await lspClient.getFoldingRanges(uri)).map((range) => ({
            start: range.startLine + 1,
            end: range.endLine + 1,
          }));
        },
      })
    );

    const selectionDisposables = providerLanguages.map((language) =>
      monaco.languages.registerSelectionRangeProvider(language, {
        provideSelectionRanges: async (model: any, positions: any[]) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) return [];
          const selections = await lspClient.getSelectionRanges(
            uri,
            positions.map((position) => ({
              line: position.lineNumber - 1,
              character: position.column - 1,
            }))
          );
          return positions.map((_, index) =>
            flattenLspSelectionRanges(monaco, selections[index])
          );
        },
      })
    );

    const semanticTokenDisposables = providerLanguages.map((language) =>
      monaco.languages.registerDocumentSemanticTokensProvider(language, {
        getLegend: () => ({
          tokenTypes: [
            "namespace",
            "class",
            "property",
            "function",
            "variable",
          ],
          tokenModifiers: [],
        }),
        provideDocumentSemanticTokens: async (
          model: any,
          _lastResultId: string | null,
          token: { isCancellationRequested?: boolean }
        ) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) {
            return { data: new Uint32Array() };
          }
          const result = await lspClient.getSemanticTokens(uri);
          if (token.isCancellationRequested || !result) {
            return { data: new Uint32Array() };
          }
          return {
            resultId: result.resultId,
            data: Uint32Array.from(result.data),
          };
        },
        releaseDocumentSemanticTokens: () => undefined,
      })
    );

    const inlayHintDisposables = providerLanguages.map((language) =>
      monaco.languages.registerInlayHintsProvider(language, {
        displayName: "Database parameter and INSERT column hints",
        provideInlayHints: async (model: any, range: any) => {
          const uri = model.uri.toString();
          if (!isCurrentLspModelUri(uri)) {
            return { hints: [], dispose: () => undefined };
          }
          const hints = await lspClient.getInlayHints(uri, {
            start: {
              line: range.startLineNumber - 1,
              character: range.startColumn - 1,
            },
            end: {
              line: range.endLineNumber - 1,
              character: range.endColumn - 1,
            },
          });
          const lspInlayHints = hints.map((hint) => ({
              position: {
                lineNumber: hint.position.line + 1,
                column: hint.position.character + 1,
              },
              label:
                typeof hint.label === "string"
                  ? hint.label
                  : hint.label.map((part) => ({
                      label: part.value,
                      tooltip: part.tooltip,
                    })),
              kind:
                hint.kind === 1
                  ? monaco.languages.InlayHintKind.Type
                  : monaco.languages.InlayHintKind.Parameter,
              tooltip: lspDocumentationForMonaco(hint.tooltip),
              textEdits: hint.textEdits?.map((edit) => ({
                range: toMonacoRange(monaco, edit.range),
                text: edit.newText,
              })),
              paddingLeft: hint.paddingLeft,
              paddingRight: hint.paddingRight,
            }));
          // DBX's positional INSERT labels are useful even when the language
          // server is temporarily unavailable. We only derive them from an
          // explicit column list, so this provider never performs metadata
          // reads or guesses a table's physical column order while typing.
          const rangeStart = model.getOffsetAt({
            lineNumber: range.startLineNumber,
            column: range.startColumn,
          });
          const rangeEnd = model.getOffsetAt({
            lineNumber: range.endLineNumber,
            column: range.endColumn,
          });
          const lspPositions = new Set(
            lspInlayHints.map(
              (hint) => `${hint.position.lineNumber}:${hint.position.column}`,
            ),
          );
          const insertValueHints = sqlInsertValueHints(model.getValue())
            .filter((hint) => hint.offset >= rangeStart && hint.offset <= rangeEnd)
            .map((hint) => ({
              position: model.getPositionAt(hint.offset),
              label: `${hint.column}:`,
              kind: monaco.languages.InlayHintKind.Parameter,
              tooltip: "Column matched from this INSERT statement's explicit column list.",
              paddingRight: true,
            }))
            .filter(
              (hint) =>
                !lspPositions.has(
                  `${hint.position.lineNumber}:${hint.position.column}`,
                ),
            );
          return {
            hints: [...lspInlayHints, ...insertValueHints],
            dispose: () => undefined,
          };
        },
      })
    );

    return () => {
      console.log("[QueryEditor] Disposing core LSP providers");
      [
        ...definitionDisposables,
        ...referencesDisposables,
        ...formattingDisposables,
        ...rangeFormattingDisposables,
        ...signatureDisposables,
        ...renameDisposables,
        ...codeActionDisposables,
        ...symbolDisposables,
        ...foldingDisposables,
        ...selectionDisposables,
        ...semanticTokenDisposables,
        ...inlayHintDisposables,
      ].forEach((disposable) => disposable.dispose());
    };
  }, [
    isActivePane,
    activeProjectId,
    monaco,
    lspClient,
    canUseLsp,
    documentUri,
    editorLanguageId,
  ]);

  useEffect(() => {
    const settings = editorSettings.inlineCompletion;
    if (
      !isActivePane ||
      !monaco ||
      !settings.enabled ||
      ((!lspReady || !canUseLsp) && !isElasticsearchConsole)
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
          if (!lspReady || !canUseLsp) {
            setInlineCompletionStatus("offline");
            return { items: [] };
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
            : lspContext;
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

          const provider = aiProviderConfig();
          if (!aiEnabled || !provider) {
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
              timeoutMs: 4_000,
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
    aiEnabled,
    aiProviderConfig,
    canUseLsp,
    documentLanguageId,
    documentUri,
    driver,
    editorLanguageId,
    editorSettings.inlineCompletion,
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

      const { uri, diagnostics } = event.payload.params;
      const tabId = extractSqlDocumentTabId(uri);
      if (tabId) {
        setLspDiagnostics(tabId, diagnostics);
      }

      const model = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (!model) return;

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
      Math.min(model.getValueLength(), documentOffset + 1),
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

  const handleImportSqlScript = async () => {
    if (
      !effectiveConnectionId ||
      !activeTab ||
      !capabilities.supportsSqlQuery
    ) {
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "SQL scripts", extensions: ["sql"] }],
    });
    if (typeof selected !== "string") return;
    const selectedFileName = selected.split(/[\\/]/).pop() || "SQL script";
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "import",
      title: `Review ${selectedFileName}`,
      detail: activeConnection?.name || effectiveConnectionId,
    });
    let preview;
    try {
      preview = await queryService.previewSqlScriptImport(
        effectiveConnectionId,
        selected,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      taskStore.failTask(taskId, message, "SQL script review failed");
      return;
    }
    taskStore.setTaskWaiting(taskId, "Awaiting SQL script review");
    setPendingSqlScriptImport({
      connectionId: effectiveConnectionId,
      filePath: selected,
      schema: activeTab.targetSchema ?? currentSchema ?? undefined,
      database: activeTab.databaseName,
      target: activeConnection?.name || effectiveConnectionId,
      preview,
      taskId,
    });
  };

  const handleConfirmSqlScriptImport = async () => {
    const pending = pendingSqlScriptImport;
    if (!pending) return;
    const taskStore = useTaskStore.getState();
    setIsSqlScriptImporting(true);
    taskStore.setTaskRunning(pending.taskId, pending.target);
    taskStore.updateTask(pending.taskId, { title: `Import ${pending.preview.fileName}` });
    try {
      const imported = await queryService.importSqlScript(
        pending.connectionId,
        pending.filePath,
        pending.preview.reviewDigest,
        pending.schema,
        pending.database,
      );
      taskStore.finishTask(
        pending.taskId,
        `${imported.statementsExecuted.toLocaleString()} statements · ${imported.rowsAffected.toLocaleString()} rows affected`,
      );
      await loadSchemas(pending.connectionId, true);
      const schemaToRefresh = pending.schema;
      if (schemaToRefresh) {
        await loadTables(pending.connectionId, schemaToRefresh, true);
      }
      bumpMetadataVersion();
      setPendingSqlScriptImport(null);
    } catch (error: any) {
      taskStore.failTask(pending.taskId, error?.message || String(error));
    } finally {
      setIsSqlScriptImporting(false);
    }
  };

  const handleImportConsoleRequests = async () => {
    if (!activeTab || !isElasticsearchConsole) return;
    if (
      activeTab.sql.trim() &&
      !window.confirm(
        "Importing Console requests replaces the current editor content. Continue?",
      )
    ) {
      return;
    }

    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "import",
      title: "Import Elasticsearch Console requests",
    });
    try {
      const imported = await queryService.importElasticsearchConsoleFile();
      if (!imported) {
        tasks.cancelTask(taskId, "Import cancelled");
        return;
      }
      updateTabSql(activeTab.id, imported.content);
      tasks.finishTask(
        taskId,
        `${imported.fileName} · ${imported.content.length.toLocaleString()} characters`,
      );
      window.requestAnimationFrame(() => {
        editorRef.current?.setPosition({ lineNumber: 1, column: 1 });
        editorRef.current?.focus();
      });
    } catch (error) {
      tasks.failTask(
        taskId,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleExportConsoleRequests = async () => {
    if (!activeTab || !isElasticsearchConsole) return;
    const source = editorRef.current?.getModel()?.getValue() ?? activeTab.sql;
    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "export",
      title: "Export Elasticsearch Console requests",
    });
    try {
      const exported =
        await queryService.exportElasticsearchConsoleFile(source);
      if (!exported.exported) {
        tasks.cancelTask(taskId, "Export cancelled");
        return;
      }
      tasks.finishTask(
        taskId,
        `${exported.byteCount.toLocaleString()} bytes`,
      );
    } catch (error) {
      tasks.failTask(
        taskId,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

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

    window.addEventListener(APP_EVENT_RUN_QUERY, onRun);
    window.addEventListener(APP_EVENT_RUN_CURRENT, onRunCurrent);
    window.addEventListener(APP_EVENT_FORMAT_SQL, onFormat);

    return () => {
      window.removeEventListener(APP_EVENT_RUN_QUERY, onRun);
      window.removeEventListener(APP_EVENT_RUN_CURRENT, onRunCurrent);
      window.removeEventListener(APP_EVENT_FORMAT_SQL, onFormat);
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
      elasticsearchSuggestDisposableRef.current?.dispose();
      const scheduleElasticsearchSuggestions = (
        model: any,
        insertedText: string,
        allowDeletion: boolean,
      ) => {
        if (!editor.hasTextFocus()) return;
        const identity = extractLspDocumentIdentity(model.uri.toString());
        const isElasticsearchModel =
          model.getLanguageId() === ELASTICSEARCH_CONSOLE_LANGUAGE_ID;
        const isMongoDbModel =
          model.getLanguageId() === "json" && identity?.driver === "mongodb";
        if (!isElasticsearchModel && !isMongoDbModel) return;
        const position = editor.getPosition();
        if (!position) return;
        const offset = model.getOffsetAt(position);
        const source = model.getValue();
        const shouldTrigger = isElasticsearchModel
          ? shouldTriggerElasticsearchCompletions(
              source,
              offset,
              insertedText,
            )
          : shouldTriggerMongoDbCompletions(source, offset, insertedText);
        const shouldOfferAfterDeletion = isElasticsearchModel
          ? shouldOfferElasticsearchCompletions(source, offset)
          : shouldOfferMongoDbCompletions(source, offset);
        if (!shouldTrigger && !(allowDeletion && shouldOfferAfterDeletion)) {
          return;
        }

        if (elasticsearchSuggestTimerRef.current !== null) {
          window.clearTimeout(elasticsearchSuggestTimerRef.current);
        }
        const version = model.getVersionId();
        elasticsearchSuggestTimerRef.current = window.setTimeout(() => {
          elasticsearchSuggestTimerRef.current = null;
          if (
            editor.getModel() !== model ||
            model.getVersionId() !== version ||
            !editor.hasTextFocus()
          ) {
            return;
          }
          editor.trigger(
            isElasticsearchModel
              ? "oxide.elasticsearch.autoSuggest"
              : "oxide.mongodb.autoSuggest",
            "editor.action.triggerSuggest",
            {},
          );
        }, 45);
      };
      elasticsearchSuggestDisposableRef.current =
        editor.onDidChangeModelContent((event: any) => {
          const model = editor.getModel();
          if (!model) return;
          const insertedText = event.changes
            .map((change: { text?: string }) => change.text || "")
            .join("");
          const deletedText = event.changes.some(
            (change: { rangeLength?: number }) =>
              (change.rangeLength || 0) > 0,
          );
          scheduleElasticsearchSuggestions(
            model,
            insertedText,
            deletedText && !insertedText,
          );
        });
      selectionDisposableRef.current?.dispose();
      selectionDisposableRef.current = editor.onDidChangeCursorSelection(
        (event: any) => {
          const tabId = activeTabIdRef.current;
          const model = editor.getModel();
          if (!tabId || !model || !event.selection) return;

          setCursorPosition({
            line: event.selection.positionLineNumber,
            column: event.selection.positionColumn,
          });

          const selectedText = model.getValueInRange(event.selection);
          setEditorSelection(
            tabId,
            selectedText.trim()
              ? {
                  text: selectedText,
                  startLineNumber: event.selection.startLineNumber,
                  startColumn: event.selection.startColumn,
                  endLineNumber: event.selection.endLineNumber,
                  endColumn: event.selection.endColumn,
                }
              : null,
          );
        },
      );
      const initialPosition = editor.getPosition();
      if (initialPosition) {
        setCursorPosition({
          line: initialPosition.lineNumber,
          column: initialPosition.column,
        });
      }
      monacoInstance.editor.setTheme(
        mode === "light" ? "vs" : "oxide-dark",
      );
    },
    [editorSettings.keybindingMode, mode, setEditorSelection],
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

  useEffect(() => {
    if (!mountedEditor || !monaco) return;
    const clear = () => {
      if (currentStatementTimerRef.current !== null) {
        window.clearTimeout(currentStatementTimerRef.current);
        currentStatementTimerRef.current = null;
      }
      currentStatementRequestRef.current += 1;
      currentStatementDecorationIdsRef.current = mountedEditor.deltaDecorations(
        currentStatementDecorationIdsRef.current,
        [],
      );
    };

    if (
      !canExecuteDocument ||
      (!capabilities.supportsSqlQuery && !isMongoDbConsole) ||
      !effectiveConnectionId ||
      isElasticsearchConsole
    ) {
      clear();
      return;
    }

    const decorate = (startOffset: number, endOffset: number) => {
      const model = mountedEditor.getModel();
      if (!model || endOffset <= startOffset) {
        currentStatementDecorationIdsRef.current =
          mountedEditor.deltaDecorations(
            currentStatementDecorationIdsRef.current,
            [],
          );
        return;
      }
      const decorations = currentStatementLineFrames(
        model,
        startOffset,
        endOffset,
      ).map((frame) => ({
          range: new monaco.Range(frame.lineNumber, 1, frame.lineNumber, 1),
          options: {
            isWholeLine: true,
            className: frame.className,
          },
        }));
      currentStatementDecorationIdsRef.current = mountedEditor.deltaDecorations(
        currentStatementDecorationIdsRef.current,
        decorations,
      );
    };

    const resolve = () => {
      if (currentStatementTimerRef.current !== null) {
        window.clearTimeout(currentStatementTimerRef.current);
      }
      const model = mountedEditor.getModel();
      const selection = mountedEditor.getSelection();
      if (!model || !selection) return;
      currentStatementTimerRef.current = window.setTimeout(async () => {
        currentStatementTimerRef.current = null;
        const currentModel = mountedEditor.getModel();
        const currentSelection = mountedEditor.getSelection();
        if (!currentModel || currentModel !== model || !currentSelection) return;
        if (!currentSelection.isEmpty()) {
          decorate(
            currentModel.getOffsetAt(currentSelection.getStartPosition()),
            currentModel.getOffsetAt(currentSelection.getEndPosition()),
          );
          return;
        }
        const position = mountedEditor.getPosition();
        if (!position) return;
        if (isMongoDbConsole) {
          const command = mongodbCommandRangeAtCursor(
            currentModel.getValue(),
            currentModel.getOffsetAt(position),
          );
          if (command) decorate(command.from, command.to);
          else decorate(0, 0);
          return;
        }
        const requestId = currentStatementRequestRef.current + 1;
        currentStatementRequestRef.current = requestId;
        try {
          const statement = await queryService.resolveSqlStatementAtCursor(
            effectiveConnectionId,
            currentModel.getValue(),
            currentModel.getOffsetAt(position),
          );
          if (
            currentStatementRequestRef.current !== requestId ||
            mountedEditor.getModel() !== currentModel
          ) {
            return;
          }
          if (statement) decorate(statement.startOffset, statement.endOffset);
          else decorate(0, 0);
        } catch {
          if (currentStatementRequestRef.current === requestId) decorate(0, 0);
        }
      }, 80);
    };

    const cursorDisposable = mountedEditor.onDidChangeCursorSelection(resolve);
    const contentDisposable = mountedEditor.onDidChangeModelContent(resolve);
    const modelDisposable = mountedEditor.onDidChangeModel(resolve);
    resolve();
    return () => {
      cursorDisposable.dispose();
      contentDisposable.dispose();
      modelDisposable.dispose();
      clear();
    };
  }, [
    canExecuteDocument,
    capabilities.supportsSqlQuery,
    documentUri,
    effectiveConnectionId,
    isElasticsearchConsole,
    isMongoDbConsole,
    monaco,
    mountedEditor,
  ]);

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
        target={pendingSqlScriptImport?.target || "selected data source"}
        isSubmitting={isSqlScriptImporting}
        onClose={() => {
          if (pendingSqlScriptImport) {
            useTaskStore
              .getState()
              .cancelTask(pendingSqlScriptImport.taskId, "SQL script review cancelled");
          }
          setPendingSqlScriptImport(null);
        }}
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
