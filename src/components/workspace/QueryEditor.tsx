import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { EditorActionBar } from "./EditorActionBar";
import { ThemeContext } from "@/theme/ThemeProvider";
import Editor, { useMonaco } from "@monaco-editor/react";
import { useEffect, useRef, useState, useContext } from "react";
// import { queryService, schemaService } from "@/services/tauri";
import { useLspClient } from "@/hooks/useLspClient";
import {
  APP_EVENT_RUN_QUERY,
  APP_EVENT_RUN_CURRENT,
  APP_EVENT_FORMAT_SQL,
} from "@/hooks/useShortcuts";

type TransactionMode = "auto" | "manual";
type TransactionState = "idle" | "active";

export function QueryEditor() {
  const { tabs, activeTabId, updateTabSql, runTabQuery, setTargetSchema } =
    useTabStore(); // line 15...
  const { activeConnectionId } = useConnectionStore();
  const { currentSchema } = useSchemaStore();
  const history = useHistoryStore((s) => s.history);
  const { savedQueries, saveQuery, deleteQuery } = useSavedQueryStore();

  // const [saveName, setSaveName] = useState("");
  // const [isSaveOpen, setIsSaveOpen] = useState(false);
  // const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const [transactionMode, setTransactionMode] =
    useState<TransactionMode>("auto");
  const [transactionState, setTransactionState] =
    useState<TransactionState>("idle");
  // const dropdownRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const monaco = useMonaco();
  const { isReady: lspReady, client: lspClient } = useLspClient(); // Added LSP client state

  // Register LSP completion provider (replacing tree-sitter)
  useEffect(() => {
    if (!monaco || !lspReady) return;

    console.log("[QueryEditor] Registering LSP completion provider");

    const disposable = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [" ", ".", "(", ","],
      provideCompletionItems: async (model: any, position: any) => {
        try {
          // Get completions from LSP server
          const items = await lspClient.getCompletions(
            model.uri.toString(),
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
            insertText: item.label,
            range: range,
          }));

          return { suggestions };
        } catch (error) {
          console.error("[LSP] Completion failed:", error);
          return { suggestions: [] };
        }
      },
    });

    return () => {
      console.log("[QueryEditor] Disposing LSP completion provider");
      disposable.dispose();
    };
  }, [monaco, lspReady, lspClient]);

  // Initialize targetSchema from currentSchema if not set
  useEffect(() => {
    if (activeTab && activeTab.targetSchema === undefined && currentSchema) {
      setTargetSchema(activeTab.id, currentSchema);
    }
  }, [activeTab, currentSchema, setTargetSchema]);

  // Close dropdown on click outside - COMMENTED OUT UNUSED
  // useEffect(() => { ... }, []);

  const handleRun = () => {
    if (activeConnectionId && activeTab) {
      runTabQuery(activeTab.id, activeConnectionId);
    }
  };

  const handleRunCurrent = () => {
    if (!activeConnectionId || !activeTab || !editorRef.current) return;

    const selection = editorRef.current.getSelection();
    const model = editorRef.current.getModel();
    if (!selection || !model) return;

    const selectedText = model.getValueInRange(selection);

    // If something is selected, run only that.
    if (selectedText && selectedText.trim()) {
      runTabQuery(activeTab.id, activeConnectionId, selectedText);
    } else {
      // Otherwise run the full tab query
      runTabQuery(activeTab.id, activeConnectionId);
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
    if (mode === "auto" && transactionState === "active") {
      // Auto-commit any pending transaction
      setTransactionState("idle");
    }
  };

  const handleBeginTransaction = () => {
    // TODO: Send BEGIN command to backend
    setTransactionState("active");
    console.log("Begin transaction");
  };

  const handleCommitTransaction = () => {
    // TODO: Send COMMIT command to backend
    setTransactionState("idle");
    console.log("Commit transaction");
  };

  const handleRollbackTransaction = () => {
    // TODO: Send ROLLBACK command to backend
    setTransactionState("idle");
    console.log("Rollback transaction");
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
          value={activeTab.sql}
          onChange={(value) => updateTabSql(activeTab.id, value || "")}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            // Force theme update on mount
            monaco.editor.setTheme(mode === "light" ? "vs" : "vs-dark");

            // Register model change listener for LSP
            const model = editor.getModel();
            if (model && lspReady) {
              const uri = model.uri.toString();
              // Notify didOpen
              lspClient.didOpen(uri, model.getValue(), model.getVersionId());

              // Notify didChange
              const changeDisposable = model.onDidChangeContent((e) => {
                lspClient.didChange(
                  uri,
                  model.getValue(),
                  model.getVersionId()
                );
              });

              // Cleanup on model dispose (tab close)
              editor.onDidDispose(() => {
                changeDisposable.dispose();
                lspClient.didClose(uri);
              });
            }
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
        transactionState={transactionState}
        onTransactionModeChange={handleTransactionModeChange}
        onBeginTransaction={handleBeginTransaction}
        onCommitTransaction={handleCommitTransaction}
        onRollbackTransaction={handleRollbackTransaction}
        onFormat={handleFormat}
        onRun={handleRun}
        isExecuting={activeTab.isExecuting}
        isConnected={!!activeConnectionId}
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
