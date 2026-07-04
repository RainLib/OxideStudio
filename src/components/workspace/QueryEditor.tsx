import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { EditorActionBar } from "./EditorActionBar";
import { ThemeContext } from "@/theme/ThemeProvider";
import Editor, { useMonaco } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, useContext } from "react";
// import { queryService, schemaService } from "@/services/tauri";
import { useLspClient } from "@/hooks/useLspClient";
import {
  DEFAULT_DATABASE_DRIVER,
  lspLanguageId,
  queryEditorLanguageId,
  supportsLspLanguageId,
} from "@/lib/databaseDialect";
import { getSqlDocumentUri, LSP_NOTIFICATION_EVENT } from "@/services/lsp";
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
} from "@/hooks/useShortcuts";

type TransactionMode = "auto" | "manual";
type TransactionState = "idle" | "active";

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

export function QueryEditor() {
  const {
    tabs,
    activeTabId,
    updateTabSql,
    runTabQuery,
    cancelTabQuery,
    setTargetSchema,
  } = useTabStore(); // line 15...
  const { activeConnectionId, connections } = useConnectionStore();
  const { currentSchema, loadSchemas, loadTables, bumpMetadataVersion } =
    useSchemaStore();
  const history = useHistoryStore((s) => s.history);
  const { savedQueries, saveQuery, deleteQuery } = useSavedQueryStore();

  // const [saveName, setSaveName] = useState("");
  // const [isSaveOpen, setIsSaveOpen] = useState(false);
  // const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const [transactionMode, setTransactionMode] =
    useState<TransactionMode>("auto");
  const [transactionStates, setTransactionStates] = useState<
    Record<string, TransactionState>
  >({});
  // const dropdownRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const openedDocumentsRef = useRef<Set<string>>(new Set());
  const documentVersionsRef = useRef<Map<string, number>>(new Map());
  const activeTransactionsRef = useRef<
    Map<string, { connectionId: string; transactionId: string }>
  >(new Map());

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const effectiveConnectionId = activeTab?.connectionId || activeConnectionId;
  const activeConnection = connections.find((c) => c.id === effectiveConnectionId);
  const driver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  const documentUri = activeTab ? getSqlDocumentUri(activeTab.id, driver) : "";
  const documentLanguageId = lspLanguageId(driver);
  const editorLanguageId = queryEditorLanguageId(driver);
  const canUseLsp = supportsLspLanguageId(driver);
  const activeDocumentSql = activeTab?.sql || "";
  const monaco = useMonaco();
  const { isReady: lspReady, client: lspClient } = useLspClient(); // Added LSP client state
  const activeTransactionState = activeTab
    ? transactionStates[activeTab.id] || "idle"
    : "idle";

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
          return getSqlDocumentUri(tab.id, tabDriver);
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
    const existingTabIds = new Set(tabs.map((tab) => tab.id));
    const staleTabIds: string[] = [];

    for (const [tabId, session] of activeTransactionsRef.current.entries()) {
      if (!existingTabIds.has(tabId)) {
        staleTabIds.push(tabId);
        void transactionService.rollbackTransaction(
          session.connectionId,
          session.transactionId
        );
        activeTransactionsRef.current.delete(tabId);
      }
    }

    if (staleTabIds.length > 0) {
      setTransactionStates((state) => {
        const next = { ...state };
        staleTabIds.forEach((tabId) => delete next[tabId]);
        return next;
      });
    }
  }, [tabs]);

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
    if (!monaco || !lspReady) return;

    console.log("[QueryEditor] Registering LSP providers");

    const completionDisposable = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [" ", ".", "(", ","],
      provideCompletionItems: async (model: any, position: any) => {
        try {
          const uri = model.uri.toString();

          // Now request completions with synchronized state
          const items = await lspClient.getCompletions(
            uri,
            position.lineNumber - 1, // LSP uses 0-indexed lines
            position.column - 1 // LSP uses 0-indexed columns
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

          // Convert LSP completion items to Monaco format
          const suggestions = items.map((item) => ({
            label: item.label,
            kind: item.kind || monaco.languages.CompletionItemKind.Field,
            detail: item.detail,
            documentation: item.documentation,
            insertText: item.insertText || item.label,
            insertTextRules:
              item.insertTextFormat === 2
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            range: range,
          }));

          return { suggestions };
        } catch (error) {
          console.error("[LSP] Completion failed:", error);
          return { suggestions: [] };
        }
      },
    });

    const hoverDisposable = monaco.languages.registerHoverProvider("sql", {
      provideHover: async (model: any, position: any) => {
        const hover = await lspClient.getHover(
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1
        );

        if (!hover) return null;

        return {
          contents: [{ value: hover.contents }],
          range: hover.range ? toMonacoRange(monaco, hover.range) : undefined,
        };
      },
    });

    const definitionDisposable = monaco.languages.registerDefinitionProvider("sql", {
      provideDefinition: async (model: any, position: any) => {
        const locations = await lspClient.getDefinitions(
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1
        );

        return locations.map((location) => ({
          uri: monaco.Uri.parse(location.uri),
          range: toMonacoRange(monaco, location.range),
        }));
      },
    });

    const referencesDisposable = monaco.languages.registerReferenceProvider("sql", {
      provideReferences: async (model: any, position: any) => {
        const locations = await lspClient.getReferences(
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1
        );

        return locations.map((location) => ({
          uri: monaco.Uri.parse(location.uri),
          range: toMonacoRange(monaco, location.range),
        }));
      },
    });

    const formattingDisposable =
      monaco.languages.registerDocumentFormattingEditProvider("sql", {
        provideDocumentFormattingEdits: async (model: any, options: any) => {
          const edits = await lspClient.formatDocument(
            model.uri.toString(),
            options.tabSize || 2,
            options.insertSpaces !== false
          );

          return edits.map((edit) => ({
            range: toMonacoRange(monaco, edit.range),
            text: edit.newText,
          }));
        },
      });

    return () => {
      console.log("[QueryEditor] Disposing LSP providers");
      completionDisposable.dispose();
      hoverDisposable.dispose();
      definitionDisposable.dispose();
      referencesDisposable.dispose();
      formattingDisposable.dispose();
    };
  }, [monaco, lspReady, lspClient]);

  useEffect(() => {
    if (!monaco || !lspReady) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<LspServerNotification>(LSP_NOTIFICATION_EVENT, (event) => {
      if (event.payload.method !== "textDocument/publishDiagnostics") return;
      if (!isPublishDiagnosticsParams(event.payload.params)) return;

      const { uri, diagnostics } = event.payload.params;
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
  }, [monaco, lspReady]);

  // Initialize targetSchema from currentSchema if not set
  useEffect(() => {
    if (activeTab && activeTab.targetSchema === undefined && currentSchema) {
      setTargetSchema(activeTab.id, currentSchema);
    }
  }, [activeTab, currentSchema, setTargetSchema]);

  // Close dropdown on click outside - COMMENTED OUT UNUSED
  // useEffect(() => { ... }, []);

  const handleRun = () => {
    if (effectiveConnectionId && activeTab) {
      const transactionId =
        transactionMode === "manual" && activeTransactionState === "active"
          ? getTransactionId() || undefined
          : undefined;
      runTabQuery(activeTab.id, effectiveConnectionId, undefined, transactionId);
    }
  };

  const handleCancelRun = () => {
    if (activeTab) {
      void cancelTabQuery(activeTab.id);
    }
  };

  const handleRunCurrent = () => {
    if (!effectiveConnectionId || !activeTab || !editorRef.current) return;

    const selection = editorRef.current.getSelection();
    const model = editorRef.current.getModel();
    if (!selection || !model) return;

    const selectedText = model.getValueInRange(selection);
    const transactionId =
      transactionMode === "manual" && activeTransactionState === "active"
        ? getTransactionId() || undefined
        : undefined;

    // If something is selected, run only that.
    if (selectedText && selectedText.trim()) {
      runTabQuery(activeTab.id, effectiveConnectionId, selectedText, transactionId);
    } else {
      // Otherwise run the full tab query
      runTabQuery(activeTab.id, effectiveConnectionId, undefined, transactionId);
    }
  };

  useEffect(() => {
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
  }, [activeConnectionId, activeTab]);

  const handleSchemaChange = (schema: string) => {
    if (activeTab) {
      setTargetSchema(activeTab.id, schema);
    }
  };

  const handleFormat = () => {
    if (editorRef.current) {
      editorRef.current.getAction("editor.action.formatDocument").run();
    }
  };

  const handleTransactionModeChange = (mode: TransactionMode) => {
    setTransactionMode(mode);
    if (mode === "auto" && activeTransactionState === "active") {
      void handleCommitTransaction();
    }
  };

  const handleBeginTransaction = async () => {
    if (!activeTab || !effectiveConnectionId) return;
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

  // Update Monaco theme when app theme changes
  useEffect(() => {
    if (!monaco) return;
    monaco.editor.setTheme(mode === "light" ? "vs" : "oxide-dark");
  }, [monaco, mode]);

  if (!activeTab) return null;

  return (
    <div className="relative h-full w-full bg-background flex flex-col">
      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          language={editorLanguageId}
          path={documentUri}
          value={activeTab.sql}
          onChange={(value) => updateTabSql(activeTab.id, value || "")}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            // Force theme update on mount
            monaco.editor.setTheme(mode === "light" ? "vs" : "vs-dark");

          }}
          beforeMount={(monaco) => {
            // Optional: Define a custom theme that perfectly matches our app's background
            monaco.editor.defineTheme("oxide-dark", {
              base: "vs-dark",
              inherit: true,
              rules: [],
              colors: {
                "editor.background": "#09090b", // zinc-950
              },
            });
          }}
          // Theme is updated via useEffect to ensure it responds to context
          options={{
            minimap: { enabled: false },
            fontSize: 16,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 24, bottom: 16 },
            lineNumbers: "on",
            renderLineHighlight: "all",
            smoothScrolling: true,
            cursorBlinking: "smooth",
            quickSuggestions: { other: true, comments: true, strings: true },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnCommitCharacter: false,
          }}
        />
      </div>

      {/* Action Bar at Bottom */}
      <EditorActionBar
        currentSchema={activeTab.targetSchema ?? currentSchema}
        onSchemaChange={handleSchemaChange}
        transactionMode={transactionMode}
        transactionState={activeTransactionState}
        onTransactionModeChange={handleTransactionModeChange}
        onBeginTransaction={handleBeginTransaction}
        onCommitTransaction={handleCommitTransaction}
        onRollbackTransaction={handleRollbackTransaction}
        onFormat={handleFormat}
        onRun={handleRun}
        onCancelRun={handleCancelRun}
        isExecuting={activeTab.isExecuting}
        isConnected={!!effectiveConnectionId}
        history={history}
        savedQueries={savedQueries}
        onLoadQuery={(sql: string) => updateTabSql(activeTab.id, sql)}
        onSaveQuery={(_name: string, _sql: string) =>
          saveQuery(_name, activeTab.sql)
        }
        onDeleteQuery={deleteQuery}
      />
    </div>
  );
}
