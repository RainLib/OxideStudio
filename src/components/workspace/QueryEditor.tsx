import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { EditorActionBar } from "./EditorActionBar";
import { QUERY_EDITOR_OPTIONS } from "./queryEditorOptions";
import { ThemeContext } from "@/theme/ThemeProvider";
import Editor, { useMonaco } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, useContext, useMemo } from "react";
// import { queryService, schemaService } from "@/services/tauri";
import { useLspClient } from "@/hooks/useLspClient";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  lspLanguageId,
  queryEditorLanguageId,
  supportsLspLanguageId,
} from "@/lib/databaseDialect";
import {
  completionFilterText,
  completionInsertText,
  completionSortText,
  filterCompletionsForSqlContext,
  isCompletedSqlContextKeyword,
  sqlContextKeywordBeforeCursor,
  toLspCompletionContext,
  toMonacoCompletionKind,
} from "@/lib/lspCompletion";
import {
  collectStaleTransactionTabIds,
  removeTransactionStates,
  type QueryTransactionSession,
  type QueryTransactionTabContext,
} from "@/lib/queryTransactionLifecycle";
import {
  extractLspDocumentIdentity,
  extractSqlDocumentTabId,
  getLspDocumentUri,
  LSP_NOTIFICATION_EVENT,
} from "@/services/lsp";
import { transactionService } from "@/services/tauri";
import type {
  Diagnostic,
  LspServerNotification,
  PublishDiagnosticsParams,
  Range as LspRange,
} from "@/services/lsp";
import {
  APP_EVENT_RUN_QUERY,
  APP_EVENT_RUN_CURRENT,
  APP_EVENT_FORMAT_SQL,
  APP_EVENT_INLINE_COMPLETION_ACCEPT,
  APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD,
  APP_EVENT_INLINE_COMPLETION_HIDE,
  APP_EVENT_INLINE_COMPLETION_TRIGGER,
} from "@/lib/actions";
import { editorExecutionConfirmation } from "@/lib/sqlExecutionGate";
import { StatusBarPortal } from "./StatusBarPortal";
import { Image as ImageIcon, LockKeyhole, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeKeybinding } from "@/lib/keybindings";
import { redactSecretString } from "@/lib/redaction";
import {
  attachVimMode,
  restoreStandardEditorState,
  type VimModeController,
} from "@/lib/vimMode";
import { saveProjectFileTab } from "@/lib/projectFileTabs";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useProjectStore } from "@/store/useProjectStore";
import { usePostgresDatabaseDiscovery } from "@/hooks/usePostgresDatabaseDiscovery";
import { postgresConnectionDatabaseName } from "./PostgresDatabaseTree";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import {
  projectFileLanguage,
  projectFileModelUri,
} from "@/lib/projectFileLanguage";
import { extractSqlParameters } from "@/lib/sqlParameters";
import { SqlParametersPanel } from "./SqlParametersPanel";
import { aiService } from "@/services/tauri/ai.service";
import {
  projectFilesService,
  supportsProjectFilePreview,
} from "@/services/tauri/project-files.service";
import { ProjectFileImagePreview } from "./ProjectFileImagePreview";
import {
  boundedInlineContext,
  cleanInlineSuggestion,
  inlineCompletionCacheKey,
  InlineCompletionCache,
  localInlineSuggestion,
  shouldRequestAiInlineCompletion,
  type InlineCompletionStatus,
} from "@/lib/inlineCompletion";

type TransactionMode = "auto" | "manual";
type TransactionState = "idle" | "active";
type ParameterExecutionRequest = {
  tabId: string;
  connectionId: string;
  sql: string;
  transactionId?: string;
};
const LSP_PROVIDER_LANGUAGES = ["sql", "json", "plaintext"] as const;

function isSupportedLspModelUri(uri: string) {
  const identity = extractLspDocumentIdentity(uri);
  return Boolean(identity?.driver && supportsLspLanguageId(identity.driver));
}

function createInlineCompletionRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `inline-${crypto.randomUUID()}`;
  }
  return `inline-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
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

function isPublishDiagnosticsParams(
  value: unknown
): value is PublishDiagnosticsParams {
  if (!value || typeof value !== "object") return false;
  const params = value as PublishDiagnosticsParams;
  return typeof params.uri === "string" && Array.isArray(params.diagnostics);
}

function toMonacoRange(monaco: any, range: LspRange) {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1
  );
}

function toMarkerSeverity(monaco: any, severity?: number) {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Warning;
  }
}

function toMarker(monaco: any, diagnostic: Diagnostic) {
  const startLineNumber = diagnostic.range.start.line + 1;
  const startColumn = diagnostic.range.start.character + 1;
  const endLineNumber = diagnostic.range.end.line + 1;
  let endColumn = diagnostic.range.end.character + 1;

  if (startLineNumber === endLineNumber && endColumn <= startColumn) {
    endColumn = startColumn + 1;
  }

  return {
    severity: toMarkerSeverity(monaco, diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source || "sql-lsp",
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
  };
}

type LspDocumentSyncClient = {
  didOpen: (
    uri: string,
    text: string,
    version: number,
    languageId: string
  ) => Promise<void>;
  didChange: (uri: string, text: string, version: number) => Promise<void>;
};

export async function syncLspModelBeforeCompletion(options: {
  uri: string;
  model: { getValue: () => string };
  languageId: string;
  client: LspDocumentSyncClient;
  openedDocuments: Set<string>;
  documentVersions: Map<string, number>;
}) {
  const { uri, model, languageId, client, openedDocuments, documentVersions } =
    options;
  const text = model.getValue();
  const version = (documentVersions.get(uri) || 0) + 1;
  documentVersions.set(uri, version);

  if (openedDocuments.has(uri)) {
    await client.didChange(uri, text, version);
    return;
  }

  openedDocuments.add(uri);
  await client.didOpen(uri, text, version, languageId);
}

interface QueryEditorProps {
  tabId?: string | null;
  isActivePane?: boolean;
  onActivate?: () => void;
}

export function QueryEditor({
  tabId,
  isActivePane = true,
  onActivate,
}: QueryEditorProps = {}) {
  const {
    tabs,
    activeTabId,
    updateTabSql,
    runTabQuery,
    cancelTabQuery,
    setTargetSchema,
    setTargetDatabase,
    setEditorSelection,
    setLspDiagnostics,
  } = useTabStore(); // line 15...
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId
  );
  const connections = useConnectionStore((state) => state.connections);
  const connectedConnectionIds = useConnectionStore(
    (state) => state.connectedConnectionIds
  );
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const metadataVersion = useSchemaStore((state) => state.metadataVersion);
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const loadTables = useSchemaStore((state) => state.loadTables);
  const bumpMetadataVersion = useSchemaStore(
    (state) => state.bumpMetadataVersion
  );
  const history = useHistoryStore((s) => s.history);
  const { savedQueries, saveQuery, deleteQuery } = useSavedQueryStore();
  const editorSettings = useSettingsStore((state) => state.settings.editor);
  const keymap = useSettingsStore((state) => state.settings.keymap);
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiProviderConfig = useAiSettingsStore((state) => state.providerConfig);
  const inlineCompletionProtocol = useAiSettingsStore(
    (state) => state.inlineCompletionProtocol
  );
  const inlineCompletionModel = useAiSettingsStore(
    (state) => state.inlineCompletionModel
  );
  const projectId = useProjectFilesStore((state) => state.projectId);
  const projectRootPath = useProjectFilesStore((state) => state.rootPath);

  // const [saveName, setSaveName] = useState("");
  // const [isSaveOpen, setIsSaveOpen] = useState(false);
  // const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const [transactionMode, setTransactionMode] =
    useState<TransactionMode>("auto");
  const [transactionStates, setTransactionStates] = useState<
    Record<string, TransactionState>
  >({});
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [parameterExecution, setParameterExecution] =
    useState<ParameterExecutionRequest | null>(null);
  const [inlineCompletionStatus, setInlineCompletionStatus] =
    useState<InlineCompletionStatus>("off");
  // const dropdownRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const [mountedEditor, setMountedEditor] = useState<any>(null);
  const effectiveTabId = tabId === undefined ? activeTabId : tabId;
  const activeTabIdRef = useRef<string | null>(effectiveTabId);
  const selectionDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const vimControllerRef = useRef<VimModeController | null>(null);
  const vimModeRef = useRef("NORMAL");
  const inlineKeysContextRef = useRef<{ set: (value: boolean) => void } | null>(
    null
  );
  const vimStatusNodeRef = useRef<HTMLSpanElement | null>(null);
  const openedDocumentsRef = useRef<Set<string>>(new Set());
  const documentVersionsRef = useRef<Map<string, number>>(new Map());
  const inlineCompletionCacheRef = useRef(new InlineCompletionCache());
  const inlineCompletionAbortRef = useRef<AbortController | null>(null);
  const inlineCompletionListenersRef = useRef(new Set<() => void>());
  const activeTransactionsRef = useRef<Map<string, QueryTransactionSession>>(
    new Map()
  );

  const activeTab = tabs.find((t) => t.id === effectiveTabId);
  const effectiveConnectionId = activeTab?.connectionId || activeConnectionId;
  const activeConnection = connections.find((c) => c.id === effectiveConnectionId);
  const driver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  const configuredPostgresDatabase =
    activeConnection?.driver === "postgres"
      ? postgresConnectionDatabaseName(activeConnection)
      : null;
  const postgresDatabaseDiscovery = usePostgresDatabaseDiscovery({
    projectId: activeProjectId,
    connectionId: effectiveConnectionId || null,
    driver: activeConnection?.driver,
    isConnectionReady: Boolean(
      effectiveConnectionId && connectedConnectionIds.includes(effectiveConnectionId)
    ),
    refreshVersion: metadataVersion,
  });
  const postgresDatabases = useMemo(() => {
    if (!configuredPostgresDatabase) return [];
    const discovered =
      postgresDatabaseDiscovery.connectionId === effectiveConnectionId
        ? postgresDatabaseDiscovery.databases
        : [];
    return [configuredPostgresDatabase, ...discovered]
      .filter(
        (database, index, rows) =>
          Boolean(database) && rows.indexOf(database) === index
      )
      .sort((left, right) =>
        left.localeCompare(right, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      );
  }, [
    configuredPostgresDatabase,
    effectiveConnectionId,
    postgresDatabaseDiscovery.connectionId,
    postgresDatabaseDiscovery.databases,
  ]);
  const isProjectFilePreview = Boolean(activeTab?.filePreview);
  const activeProjectFileLanguage =
    activeTab?.fileRelativePath && !isProjectFilePreview
      ? projectFileLanguage(activeTab.fileRelativePath, driver)
      : null;
  const documentLanguageId =
    activeProjectFileLanguage?.lspLanguageId || lspLanguageId(driver);
  const documentUri = activeTab
    ? activeProjectFileLanguage && !activeProjectFileLanguage.usesDatabaseLsp
      ? projectFileModelUri(activeTab.id, activeProjectFileLanguage)
      : getLspDocumentUri(activeTab.id, driver, documentLanguageId)
    : "";
  const editorLanguageId =
    activeProjectFileLanguage?.editorLanguageId || queryEditorLanguageId(driver);
  const canUseLsp =
    !isProjectFilePreview &&
    supportsLspLanguageId(driver) &&
    (!activeProjectFileLanguage || activeProjectFileLanguage.usesDatabaseLsp);
  const canExecuteDocument =
    !isProjectFilePreview &&
    (!activeProjectFileLanguage || activeProjectFileLanguage.executable);
  const capabilities = defaultDatabaseCapabilities(driver);
  const supportsTransactions =
    capabilities.supportsTransactions && !activeTab?.databaseName;
  const activeDocumentSql = activeTab?.sql || "";
  const monaco = useMonaco();
  const {
    isReady: lspReady,
    client: lspClient,
    sessionKey: lspSessionKey,
  } = useLspClient({
    connectionId: effectiveConnectionId,
    driver,
    enabled: Boolean(activeTab && effectiveConnectionId && canUseLsp),
  });
  const activeTransactionState = activeTab
    ? transactionStates[activeTab.id] || "idle"
    : "idle";
  const parameterTargetSql =
    activeTab?.editorSelection?.text?.trim() || activeTab?.sql || "";
  const parameterCount = useMemo(
    () => extractSqlParameters(parameterTargetSql, driver).length,
    [driver, parameterTargetSql]
  );

  useEffect(() => {
    activeTabIdRef.current = effectiveTabId;
  }, [effectiveTabId]);

  useEffect(() => {
    setParameterExecution(null);
  }, [effectiveTabId]);

  useEffect(() => {
    if (!isProjectFilePreview) return;
    selectionDisposableRef.current?.dispose();
    selectionDisposableRef.current = null;
    editorRef.current = null;
    setMountedEditor(null);
  }, [isProjectFilePreview]);

  useEffect(() => {
    return () => {
      selectionDisposableRef.current?.dispose();
      selectionDisposableRef.current = null;
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
      onWrite: () =>
        saveProjectFileTab(activeTabIdRef.current || undefined),
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
        const files = useProjectFilesStore.getState();
        files.syncActiveProject();
        try {
          if (supportsProjectFilePreview(relativePath)) {
            const preview = await files.readPreview(relativePath);
            useTabStore
              .getState()
              .openProjectFilePreviewTab(
                files.projectId,
                preview.relativePath,
                preview.mediaType,
                preview.dataBase64,
                preview.revision,
                preview.size,
                files.rootPath
              );
            return;
          }
          const document = await files.readFile(relativePath);
          useTabStore
            .getState()
            .openProjectFileTab(
              files.projectId,
              document.relativePath,
              document.content,
              document.revision,
              files.rootPath
            );
        } catch (error) {
          const tabId = activeTabIdRef.current;
          if (!tabId) return;
          const message = error instanceof Error ? error.message : String(error);
          useTabStore.setState((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === tabId
                ? { ...tab, fileError: `Failed to open file: ${message}` }
                : tab
            ),
          }));
        }
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
  ]);

  useEffect(() => {
    inlineKeysContextRef.current?.set(
      editorSettings.keybindingMode !== "vim" || vimModeRef.current === "INSERT"
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
      [APP_EVENT_INLINE_COMPLETION_TRIGGER, () => run("editor.action.inlineSuggest.trigger")],
      [APP_EVENT_INLINE_COMPLETION_ACCEPT, () => run("editor.action.inlineSuggest.commit")],
      [
        APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD,
        () => run("editor.action.inlineSuggest.acceptNextWord"),
      ],
      [APP_EVENT_INLINE_COMPLETION_HIDE, () => run("editor.action.inlineSuggest.hide")],
    ];
    handlers.forEach(([event, handler]) => window.addEventListener(event, handler));
    return () => {
      handlers.forEach(([event, handler]) =>
        window.removeEventListener(event, handler)
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
      "oxideInlineCompletionKeysEnabled && editorTextFocus"
    );
    addRules(
      "editor.inlineCompletion.accept",
      "editor.action.inlineSuggest.commit",
      visibleWhen
    );
    addRules(
      "editor.inlineCompletion.acceptNextWord",
      "editor.action.inlineSuggest.acceptNextWord",
      visibleWhen
    );
    addRules(
      "editor.inlineCompletion.hide",
      "editor.action.inlineSuggest.hide",
      visibleWhen
    );

    const normalizedAccept = (keymap["editor.inlineCompletion.accept"] || []).map(
      normalizeKeybinding
    );
    const normalizedWord = (
      keymap["editor.inlineCompletion.acceptNextWord"] || []
    ).map(normalizeKeybinding);
    const normalizedHide = (keymap["editor.inlineCompletion.hide"] || []).map(
      normalizeKeybinding
    );
    if (!normalizedAccept.includes("tab")) {
      rules.push({ keybinding: monaco.KeyCode.Tab, command: null, when: visibleWhen });
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

  const getTransactionId = () => {
    if (!activeTab || !effectiveConnectionId) return null;
    return `${effectiveConnectionId}:${activeTab.id}`;
  };

  useEffect(() => {
    if (!lspReady || !activeTab || !documentUri || !canUseLsp) return;

    const previousVersion = documentVersionsRef.current.get(documentUri) || 0;
    const version = previousVersion + 1;
    documentVersionsRef.current.set(documentUri, version);

    if (openedDocumentsRef.current.has(documentUri)) {
      void lspClient.didChange(documentUri, activeDocumentSql, version);
    } else {
      openedDocumentsRef.current.add(documentUri);
      void lspClient.didOpen(
        documentUri,
        activeDocumentSql,
        version,
        documentLanguageId
      );
    }
  }, [
    activeTab?.id,
    activeDocumentSql,
    canUseLsp,
    documentLanguageId,
    documentUri,
    lspClient,
    lspReady,
  ]);

  useEffect(() => {
    if (!lspReady) return;

    const currentDocumentUris = new Set(
      tabs
        .filter((tab) => tab.type === "query")
        .map((tab) => {
          const tabConnectionId = tab.connectionId || activeConnectionId;
          const tabConnection = connections.find(
            (connection) => connection.id === tabConnectionId
          );
          const tabDriver = tabConnection?.driver || DEFAULT_DATABASE_DRIVER;
          return getLspDocumentUri(tab.id, tabDriver, lspLanguageId(tabDriver));
        })
    );

    for (const uri of Array.from(openedDocumentsRef.current)) {
      if (currentDocumentUris.has(uri)) continue;

      openedDocumentsRef.current.delete(uri);
      documentVersionsRef.current.delete(uri);
      void lspClient.didClose(uri);

      if (monaco) {
        const model = monaco.editor.getModel(monaco.Uri.parse(uri));
        if (model) {
          monaco.editor.setModelMarkers(model, "sql-lsp", []);
        }
      }
    }
  }, [activeConnectionId, connections, lspClient, lspReady, monaco, tabs]);

  useEffect(() => {
    return () => {
      for (const uri of openedDocumentsRef.current) {
        void lspClient.didClose(uri);
        if (monaco) {
          const model = monaco.editor.getModel(monaco.Uri.parse(uri));
          if (model) {
            monaco.editor.setModelMarkers(model, "sql-lsp", []);
          }
        }
      }
      openedDocumentsRef.current.clear();
      documentVersionsRef.current.clear();
    };
  }, [lspClient, monaco]);

  useEffect(() => {
    openedDocumentsRef.current.clear();
    documentVersionsRef.current.clear();
  }, [lspSessionKey]);

  useEffect(() => {
    const contexts: QueryTransactionTabContext[] = tabs.map((tab) => {
      const tabConnectionId = tab.connectionId || activeConnectionId || null;
      const tabConnection = connections.find(
        (connection) => connection.id === tabConnectionId
      );
      const tabDriver = tabConnection?.driver || DEFAULT_DATABASE_DRIVER;

      return {
        tabId: tab.id,
        connectionId: tabConnectionId,
        supportsTransactions:
          defaultDatabaseCapabilities(tabDriver).supportsTransactions,
      };
    });

    const staleTabIds = collectStaleTransactionTabIds(
      activeTransactionsRef.current,
      contexts
    );

    if (staleTabIds.length > 0) {
      for (const tabId of staleTabIds) {
        const session = activeTransactionsRef.current.get(tabId);
        if (!session) continue;

        void transactionService.rollbackTransaction(
          session.connectionId,
          session.transactionId
        );
        activeTransactionsRef.current.delete(tabId);
      }

      setTransactionStates((state) =>
        removeTransactionStates(state, staleTabIds)
      );
    }
  }, [activeConnectionId, connections, tabs]);

  useEffect(() => {
    return () => {
      for (const session of activeTransactionsRef.current.values()) {
        void transactionService.rollbackTransaction(
          session.connectionId,
          session.transactionId
        );
      }
      activeTransactionsRef.current.clear();
    };
  }, []);

  // Register LSP providers (completion, hover, navigation, formatting)
  useEffect(() => {
    if (!isActivePane || !monaco || !lspReady) return;

    console.log("[QueryEditor] Registering LSP providers");

    const completionDisposables = LSP_PROVIDER_LANGUAGES.map((language) =>
      monaco.languages.registerCompletionItemProvider(language, {
        triggerCharacters: [" ", ".", "(", ",", '"', "@"],
        provideCompletionItems: async (
          model: any,
          position: any,
          context: any
        ) => {
          try {
            const uri = model.uri.toString();
            if (!isSupportedLspModelUri(uri)) return { suggestions: [] };

            const identity = extractLspDocumentIdentity(uri);
            const languageId = identity?.driver
              ? lspLanguageId(identity.driver)
              : "sql";
            await syncLspModelBeforeCompletion({
              uri,
              model,
              languageId,
              client: lspClient,
              openedDocuments: openedDocumentsRef.current,
              documentVersions: documentVersionsRef.current,
            });

            // Now request completions with synchronized state
            const items = await lspClient.getCompletions(
              uri,
              position.lineNumber - 1, // LSP uses 0-indexed lines
              position.column - 1, // LSP uses 0-indexed columns
              toLspCompletionContext(context)
            );

            console.log(`[LSP] Got ${items.length} completion items`);

            // Get the word being typed for range calculation
            const word = model.getWordUntilPosition(position);
            const range = new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn
            );
            const typedWord = model.getValueInRange(range);
            const completedContextKeyword =
              isCompletedSqlContextKeyword(typedWord);
            const textBeforeCursor = model.getValueInRange(
              new monaco.Range(1, 1, position.lineNumber, position.column)
            );
            const sqlContextKeyword =
              sqlContextKeywordBeforeCursor(textBeforeCursor);
            const insertRange = completedContextKeyword
              ? new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                )
              : range;
            const filteredItems = filterCompletionsForSqlContext(
              items,
              sqlContextKeyword
            );

            // Convert LSP completion items to Monaco format
            const suggestions = filteredItems.map((item) => ({
              label: item.label,
              kind: toMonacoCompletionKind(monaco, item.kind),
              detail: item.detail,
              documentation: item.documentation,
              insertText: completionInsertText(item, completedContextKeyword),
              sortText: completionSortText(item),
              filterText: completionFilterText(
                item,
                typedWord,
                completedContextKeyword
              ),
              preselect: item.preselect,
              insertTextRules:
                item.insertTextFormat === 2
                  ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
              range: item.textEdit
                ? toMonacoRange(monaco, item.textEdit.range)
                : insertRange,
            }));

            return { suggestions };
          } catch (error) {
            console.error("[LSP] Completion failed:", error);
            return { suggestions: [] };
          }
        },
      })
    );

    const hoverDisposables = LSP_PROVIDER_LANGUAGES.map((language) =>
      monaco.languages.registerHoverProvider(language, {
        provideHover: async (model: any, position: any) => {
          const uri = model.uri.toString();
          if (!isSupportedLspModelUri(uri)) return null;

          const hover = await lspClient.getHover(
            uri,
            position.lineNumber - 1,
            position.column - 1
          );

          if (!hover) return null;

          return {
            contents: [{ value: hover.contents }],
            range: hover.range ? toMonacoRange(monaco, hover.range) : undefined,
          };
        },
      })
    );

    const definitionDisposables = LSP_PROVIDER_LANGUAGES.map((language) =>
      monaco.languages.registerDefinitionProvider(language, {
        provideDefinition: async (model: any, position: any) => {
          const uri = model.uri.toString();
          if (!isSupportedLspModelUri(uri)) return [];

          const locations = await lspClient.getDefinitions(
            uri,
            position.lineNumber - 1,
            position.column - 1
          );

          return locations.map((location) => ({
            uri: monaco.Uri.parse(location.uri),
            range: toMonacoRange(monaco, location.range),
          }));
        },
      })
    );

    const referencesDisposables = LSP_PROVIDER_LANGUAGES.map((language) =>
      monaco.languages.registerReferenceProvider(language, {
        provideReferences: async (model: any, position: any) => {
          const uri = model.uri.toString();
          if (!isSupportedLspModelUri(uri)) return [];

          const locations = await lspClient.getReferences(
            uri,
            position.lineNumber - 1,
            position.column - 1
          );

          return locations.map((location) => ({
            uri: monaco.Uri.parse(location.uri),
            range: toMonacoRange(monaco, location.range),
          }));
        },
      })
    );

    const formattingDisposables = LSP_PROVIDER_LANGUAGES.map((language) =>
      monaco.languages.registerDocumentFormattingEditProvider(language, {
        provideDocumentFormattingEdits: async (model: any, options: any) => {
          const uri = model.uri.toString();
          if (!isSupportedLspModelUri(uri)) return [];

          const edits = await lspClient.formatDocument(
            uri,
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

    return () => {
      console.log("[QueryEditor] Disposing LSP providers");
      [
        ...completionDisposables,
        ...hoverDisposables,
        ...definitionDisposables,
        ...referencesDisposables,
        ...formattingDisposables,
      ].forEach((disposable) => disposable.dispose());
    };
  }, [isActivePane, monaco, lspReady, lspClient]);

  useEffect(() => {
    const settings = editorSettings.inlineCompletion;
    if (
      !isActivePane ||
      !monaco ||
      !lspReady ||
      !settings.enabled ||
      !canUseLsp
    ) {
      inlineCompletionAbortRef.current?.abort();
      setInlineCompletionStatus(settings.enabled ? "offline" : "off");
      return;
    }

    let disposed = false;
    const emitInlineCompletionChange = () => {
      inlineCompletionListenersRef.current.forEach((listener) => listener());
    };
    const disposables = LSP_PROVIDER_LANGUAGES.map((language) =>
      monaco.languages.registerInlineCompletionsProvider(language, {
        displayName: "OxideStudio AI",
        debounceDelayMs: 300,
        onDidChangeInlineCompletions: (listener: () => void) => {
          inlineCompletionListenersRef.current.add(listener);
          return {
            dispose: () => inlineCompletionListenersRef.current.delete(listener),
          };
        },
        provideInlineCompletions: async (
          model: any,
          position: any,
          context: any,
          token: any
        ) => {
          const uri = model.uri.toString();
          if (
            disposed ||
            uri !== documentUri ||
            !isSupportedLspModelUri(uri) ||
            context.selectedSuggestionInfo
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

          const modelVersion = model.getVersionId();
          await syncLspModelBeforeCompletion({
            uri,
            model,
            languageId: documentLanguageId,
            client: lspClient,
            openedDocuments: openedDocumentsRef.current,
            documentVersions: documentVersionsRef.current,
          });
          if (token.isCancellationRequested || model.getVersionId() !== modelVersion) {
            return { items: [] };
          }
          const lspContext = await lspClient.getInlineCompletionContext(
            uri,
            position.lineNumber - 1,
            position.column - 1
          );
          const localText = localInlineSuggestion(bounded.prefix, lspContext);
          const inlineResult = (text: string) => {
            if (!text) return { items: [] };
            const insertText =
              text.includes("\n") &&
              position.column < model.getLineMaxColumn(position.lineNumber)
                ? text.split("\n", 1)[0]
                : text;
            return {
              items: insertText
                ? [
                    {
                      insertText,
                      range: new monaco.Range(
                        position.lineNumber,
                        position.column,
                        position.lineNumber,
                        position.column
                      ),
                      completeBracketPairs: true,
                    },
                  ]
                : [],
            };
          };

          const provider = aiProviderConfig();
          if (!aiEnabled || !provider) {
            setInlineCompletionStatus(localText ? "local" : "offline");
            return inlineResult(localText);
          }
          const aiLspContext = settings.includeSchemaMetadata
            ? lspContext
            : {
                dialect: lspContext.dialect,
                clause: lspContext.clause,
                expectedKinds: lspContext.expectedKinds,
                diagnostics: lspContext.diagnostics,
                errorCount: lspContext.errorCount,
              };
          const requestBase = {
            protocol: inlineCompletionProtocol,
            config: {
              ...provider,
              model: inlineCompletionModel.trim() || provider.model,
              timeoutMs: 4_000,
            },
            prefix: redactSecretString(bounded.prefix),
            suffix: redactSecretString(bounded.suffix),
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
                      query: bounded.prefix,
                      referencedObjects: lspContext.referencedObjects,
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
              const cachedWithProject = inlineCompletionCacheRef.current.get(cacheKey);
              if (cachedWithProject !== undefined) return cachedWithProject;
              const result = await aiService.inlineCompletion(
                request,
                abortController.signal
              );
              if (
                abortController.signal.aborted ||
                model.getVersionId() !== modelVersion
              ) {
                return "";
              }
              const completion = cleanInlineSuggestion(
                result.text,
                bounded.prefix,
                bounded.suffix
              );
              if (!completion) return "";
              const nextText = `${value.slice(0, offset)}${completion}${value.slice(offset)}`;
              const nextDiagnostics = await lspClient.validateInlineCompletion(
                uri,
                nextText
              );
              const baselineErrors =
                lspContext.errorCount ??
                (lspContext.diagnostics || []).filter(
                  (diagnostic) => diagnostic.severity === 1
                ).length;
              const nextErrors = nextDiagnostics.filter(
                (diagnostic) => diagnostic.severity === 1
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
                console.debug("[InlineCompletion] AI provider unavailable", error);
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
              window.setTimeout(() => resolve(""), 120)
            ),
          ]);
          if (fastAiText) return inlineResult(fastAiText);
          setInlineCompletionStatus("local");
          void aiPromise;
          return inlineResult(localText);
        },
        disposeInlineCompletions: () => undefined,
      })
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
    editorSettings.inlineCompletion,
    inlineCompletionModel,
    inlineCompletionProtocol,
    isActivePane,
    lspClient,
    lspReady,
    monaco,
    mountedEditor,
    projectId,
    projectRootPath,
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
        diagnostics.map((diagnostic) => toMarker(monaco, diagnostic))
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

  // Initialize targetSchema from currentSchema if not set
  useEffect(() => {
    if (activeTab && activeTab.targetSchema === undefined && currentSchema) {
      setTargetSchema(activeTab.id, currentSchema);
    }
  }, [activeTab, currentSchema, setTargetSchema]);

  // Close dropdown on click outside - COMMENTED OUT UNUSED
  // useEffect(() => { ... }, []);

  const confirmEditorExecution = (sql: string) => {
    if (!editorSettings.confirmDestructiveSql) return true;
    const confirmation = editorExecutionConfirmation(sql, driver);
    if (!confirmation.required) return true;
    return window.confirm(confirmation.message || "Execute this query?");
  };

  const transactionIdForExecution = () =>
    supportsTransactions &&
    transactionMode === "manual" &&
    activeTransactionState === "active"
      ? getTransactionId() || undefined
      : undefined;

  const requestParameterizedExecution = (
    sql: string,
    transactionId?: string
  ) => {
    if (
      !activeTab ||
      !effectiveConnectionId ||
      extractSqlParameters(sql, driver).length === 0
    ) {
      return false;
    }

    setParameterExecution({
      tabId: activeTab.id,
      connectionId: effectiveConnectionId,
      sql,
      transactionId,
    });
    return true;
  };

  const currentEditorExecutionSql = () => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (!selection || !model) return activeTab?.sql || "";

    const selectedText = model.getValueInRange(selection);
    return selectedText && selectedText.trim()
      ? selectedText
      : model.getValue();
  };

  const handleRun = () => {
    if (canExecuteDocument && effectiveConnectionId && activeTab) {
      const sql = editorRef.current?.getModel()?.getValue() ?? activeTab.sql;
      const transactionId = transactionIdForExecution();
      if (requestParameterizedExecution(sql, transactionId)) return;
      if (!confirmEditorExecution(sql)) return;
      updateTabSql(activeTab.id, sql);
      runTabQuery(activeTab.id, effectiveConnectionId, undefined, transactionId);
    }
  };

  const handleCancelRun = () => {
    if (activeTab) {
      void cancelTabQuery(activeTab.id);
    }
  };

  const handleRunCurrent = () => {
    if (
      !canExecuteDocument ||
      !effectiveConnectionId ||
      !activeTab ||
      !editorRef.current
    ) {
      return;
    }

    const selection = editorRef.current.getSelection();
    const model = editorRef.current.getModel();
    if (!selection || !model) return;

    const selectedText = model.getValueInRange(selection);
    const transactionId = transactionIdForExecution();

    // If something is selected, run only that.
    if (selectedText && selectedText.trim()) {
      if (requestParameterizedExecution(selectedText, transactionId)) return;
      if (!confirmEditorExecution(selectedText)) return;
      runTabQuery(activeTab.id, effectiveConnectionId, selectedText, transactionId);
    } else {
      // Otherwise run the full tab query
      const sql = model.getValue();
      if (requestParameterizedExecution(sql, transactionId)) return;
      if (!confirmEditorExecution(sql)) return;
      updateTabSql(activeTab.id, sql);
      runTabQuery(activeTab.id, effectiveConnectionId, undefined, transactionId);
    }
  };

  const handleConfigureParameters = () => {
    requestParameterizedExecution(
      currentEditorExecutionSql(),
      transactionIdForExecution()
    );
  };

  const handleRunParameterizedSql = (compiledSql: string) => {
    if (!parameterExecution) return;
    if (!confirmEditorExecution(compiledSql)) return;

    void runTabQuery(
      parameterExecution.tabId,
      parameterExecution.connectionId,
      compiledSql,
      parameterExecution.transactionId
    );
    setParameterExecution(null);
  };

  useEffect(() => {
    if (!isActivePane) return;

    const onRun = () => handleRun();
    const onRunCurrent = () => handleRunCurrent();
    const onFormat = () => handleFormat();

    window.addEventListener(APP_EVENT_RUN_QUERY, onRun);
    window.addEventListener(APP_EVENT_RUN_CURRENT, onRunCurrent);
    window.addEventListener(APP_EVENT_FORMAT_SQL, onFormat);

    return () => {
      window.removeEventListener(APP_EVENT_RUN_QUERY, onRun);
      window.removeEventListener(APP_EVENT_RUN_CURRENT, onRunCurrent);
      window.removeEventListener(APP_EVENT_FORMAT_SQL, onFormat);
    };
  }, [
    activeConnectionId,
    activeTab,
    activeTransactionState,
    canExecuteDocument,
    effectiveConnectionId,
    isActivePane,
    runTabQuery,
    supportsTransactions,
    transactionMode,
  ]);

  const handleSchemaChange = (schema: string) => {
    if (activeTab) {
      setTargetSchema(activeTab.id, schema);
    }
  };

  const handleDatabaseChange = (database: string) => {
    if (!activeTab || !configuredPostgresDatabase) return;
    setTargetDatabase(
      activeTab.id,
      database === configuredPostgresDatabase ? null : database
    );
  };

  const handleFormat = () => {
    if (editorRef.current) {
      editorRef.current.getAction("editor.action.formatDocument").run();
    }
  };

  const handleTransactionModeChange = (mode: TransactionMode) => {
    if (!supportsTransactions) return;
    setTransactionMode(mode);
    if (mode === "auto" && activeTransactionState === "active") {
      void handleCommitTransaction();
    }
  };

  const handleBeginTransaction = async () => {
    if (!supportsTransactions || !activeTab || !effectiveConnectionId) return;
    const transactionId = getTransactionId();
    if (!transactionId) return;

    try {
      await transactionService.beginTransaction(
        effectiveConnectionId,
        transactionId,
        activeTab.targetSchema ?? currentSchema
      );
      activeTransactionsRef.current.set(activeTab.id, {
        connectionId: effectiveConnectionId,
        transactionId,
      });
      setTransactionStates((state) => ({
        ...state,
        [activeTab.id]: "active",
      }));
    } catch (error) {
      console.error("Begin transaction failed:", error);
    }
  };

  const handleCommitTransaction = async () => {
    if (!supportsTransactions) return;
    if (!activeTab) return;
    const session = activeTransactionsRef.current.get(activeTab.id);
    if (!session) return;

    try {
      await transactionService.commitTransaction(
        session.connectionId,
        session.transactionId
      );
      activeTransactionsRef.current.delete(activeTab.id);
      setTransactionStates((state) => ({
        ...state,
        [activeTab.id]: "idle",
      }));
      await loadSchemas(session.connectionId, true);
      const schemaToRefresh = useSchemaStore.getState().currentSchema ||
        activeTab.targetSchema ||
        currentSchema;
      if (schemaToRefresh) {
        await loadTables(session.connectionId, schemaToRefresh, true);
      }
      bumpMetadataVersion();
    } catch (error) {
      console.error("Commit transaction failed:", error);
    }
  };

  const handleRollbackTransaction = async () => {
    if (!supportsTransactions) return;
    if (!activeTab) return;
    const session = activeTransactionsRef.current.get(activeTab.id);
    if (!session) return;

    try {
      await transactionService.rollbackTransaction(
        session.connectionId,
        session.transactionId
      );
      activeTransactionsRef.current.delete(activeTab.id);
      setTransactionStates((state) => ({
        ...state,
        [activeTab.id]: "idle",
      }));
    } catch (error) {
      console.error("Rollback transaction failed:", error);
    }
  };

  const { mode } = (useContext(ThemeContext) as any) || { mode: "dark" };
  const editorOptions = useMemo(
    () => ({
      ...QUERY_EDITOR_OPTIONS,
      fontSize: editorSettings.fontSize,
      tabSize: editorSettings.tabSize,
      wordWrap: editorSettings.wordWrap,
      minimap: { enabled: editorSettings.minimap },
      inlineSuggest: { enabled: editorSettings.inlineCompletion.enabled },
      lineNumbers:
        editorSettings.keybindingMode === "vim" &&
        editorSettings.vim.relativeLineNumbers
          ? ("relative" as const)
          : ("on" as const),
    }),
    [
      editorSettings.fontSize,
      editorSettings.keybindingMode,
      editorSettings.inlineCompletion.enabled,
      editorSettings.minimap,
      editorSettings.tabSize,
      editorSettings.vim.relativeLineNumbers,
      editorSettings.wordWrap,
    ]
  );

  // Update Monaco theme when app theme changes
  useEffect(() => {
    if (!monaco) return;
    monaco.editor.setTheme(mode === "light" ? "vs" : "oxide-dark");
  }, [monaco, mode]);

  if (!activeTab) return null;

  return (
    <div
      className="wb-query-editor relative flex h-full w-full flex-col bg-[hsl(var(--wb-editor))]"
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
    >
      {isProjectFilePreview && activeTab.filePreview ? (
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
          <div className="min-w-0 truncate text-[10px] wb-muted" title={activeTab.fileRelativePath}>
            {activeTab.fileRelativePath}
            <span className="ml-2 uppercase opacity-70">
              {activeProjectFileLanguage.editorLanguageId}
            </span>
          </div>
          <button
            type="button"
            className={cn(
              "wb-text-button h-6 shrink-0 gap-1.5 px-2 text-[10px]",
              activeTab.isDirty && "text-[hsl(var(--wb-accent))]"
            )}
            onClick={() => void saveProjectFileTab(activeTab.id)}
            disabled={!activeTab.isDirty}
            title={activeTab.isDirty ? "Save Project File (Ctrl+S)" : "Project File Saved"}
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
          databases={driver === "postgres" ? postgresDatabases : undefined}
          currentDatabase={
            driver === "postgres"
              ? activeTab.databaseName || configuredPostgresDatabase
              : null
          }
          onDatabaseChange={
            driver === "postgres" ? handleDatabaseChange : undefined
          }
          isDatabaseRefreshing={postgresDatabaseDiscovery.isRefreshing}
          databaseSelectionDisabled={activeTransactionState === "active"}
          transactionMode={transactionMode}
          transactionState={activeTransactionState}
          onTransactionModeChange={handleTransactionModeChange}
          onBeginTransaction={handleBeginTransaction}
          onCommitTransaction={handleCommitTransaction}
          onRollbackTransaction={handleRollbackTransaction}
          onFormat={handleFormat}
          onRun={handleRun}
          onRunCurrent={handleRunCurrent}
          onCancelRun={handleCancelRun}
          isExecuting={activeTab.isExecuting}
          isConnected={Boolean(effectiveConnectionId && canExecuteDocument)}
          history={history}
          savedQueries={savedQueries}
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
        />
      )}

      {!isProjectFilePreview && parameterExecution && (
        <SqlParametersPanel
          sql={parameterExecution.sql}
          dialect={driver}
          isConnected={Boolean(effectiveConnectionId && canExecuteDocument)}
          isExecuting={activeTab.isExecuting}
          onClose={() => setParameterExecution(null)}
          onRun={handleRunParameterizedSql}
        />
      )}

      {activeTab.fileError && (
        <div className="flex min-h-7 items-center border-b border-red-500/25 bg-red-500/10 px-3 text-[10px] text-red-200">
          {activeTab.fileError}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {activeTab.filePreview?.kind === "image" ? (
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
            onChange={(value) => updateTabSql(activeTab.id, value || "")}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              setMountedEditor(editor);
              inlineKeysContextRef.current = editor.createContextKey(
                "oxideInlineCompletionKeysEnabled",
                editorSettings.keybindingMode !== "vim"
              );
              selectionDisposableRef.current?.dispose();
              selectionDisposableRef.current =
                editor.onDidChangeCursorSelection((event: any) => {
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
                      : null
                  );
                });
              const initialPosition = editor.getPosition();
              if (initialPosition) {
                setCursorPosition({
                  line: initialPosition.lineNumber,
                  column: initialPosition.column,
                });
              }
              monaco.editor.setTheme(mode === "light" ? "vs" : "oxide-dark");
            }}
            beforeMount={(monaco) => {
              // Optional: Define a custom theme that perfectly matches our app's background
              monaco.editor.defineTheme("oxide-dark", {
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
            }}
            // Theme is updated via useEffect to ensure it responds to context
            options={editorOptions}
          />
        )}
      </div>
      {isActivePane && !isProjectFilePreview && (
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
                title="LSP status"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    lspReady ? "bg-emerald-400" : "bg-amber-400"
                  )}
                />
                SQL
              </span>
            )}
          </div>
        </StatusBarPortal>
      )}
    </div>
  );
}
