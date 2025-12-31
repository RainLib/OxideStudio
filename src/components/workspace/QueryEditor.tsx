import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { EditorActionBar } from "./EditorActionBar";
import { ThemeContext } from "@/theme/ThemeProvider";
import Editor, { useMonaco } from "@monaco-editor/react";
import { useEffect, useRef, useState, useContext } from "react";
import { queryService, schemaService } from "@/services/tauri";
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

  // Register SQL completion provider
  useEffect(() => {
    if (!monaco) return;

    console.log("[SETUP] Registering SQL completion provider");

    const disposable = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [" ", ".", "(", ","],
      provideCompletionItems: async (model: any, position: any) => {
        console.log("[PROVIDER] Called at position:", position);

        const fullText = model.getValue();
        const offset = model.getOffsetAt(position);

        // Get the word being typed for range calculation
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        );

        // Get state from stores
        const { activeConnectionId } = useConnectionStore.getState();
        const { currentSchema, tables } = useSchemaStore.getState();

        console.log("[PROVIDER] Connection state:", {
          activeConnectionId,
          currentSchema,
          tablesCount: tables.length,
        });

        try {
          // Call Rust backend for context analysis
          // Note: SQL parsing doesn't require a DB connection
          const response = await queryService.getSqlCompletion(
            fullText,
            offset
          );
          console.log("[PROVIDER] Backend response:", response);

          if (!response) {
            console.warn("[PROVIDER] Backend failed");
            return { suggestions: [] };
          }

          const { suggestionType, relevantTable, candidates } = response;
          const suggestions: any[] = [];

          console.log(
            `[PROVIDER] Type: ${suggestionType}, Candidates: ${
              candidates?.length || 0
            }`
          );

          // Handle different suggestion types based on backend analysis
          switch (suggestionType.toLowerCase()) {
            case "table":
              // Suggest tables from schema store (requires connection)
              console.log(`[PROVIDER] Suggesting tables from schema`);
              if (activeConnectionId && tables.length > 0) {
                tables.forEach((t) => {
                  suggestions.push({
                    label: t.name,
                    kind: monaco.languages.CompletionItemKind.Class,
                    insertText: t.name,
                    detail: `Table (${t.schema || currentSchema})`,
                    range,
                  });
                });
              } else {
                console.log(`[PROVIDER] No connection or tables available`);
              }
              break;

            case "column":
              // Suggest columns from the relevant table
              console.log(
                `[PROVIDER] Suggesting columns for table: ${relevantTable}`
              );
              if (relevantTable) {
                const targetSchema = currentSchema || "public";
                if (activeConnectionId) {
                  try {
                    const cols = await schemaService.getColumns(
                      activeConnectionId,
                      targetSchema,
                      relevantTable
                    );
                    if (cols) {
                      cols.forEach((col: any) => {
                        suggestions.push({
                          label: col.name,
                          kind: monaco.languages.CompletionItemKind.Field,
                          insertText: col.name,
                          detail: `${col.data_type} (${relevantTable})`,
                          range,
                        });
                      });
                    }
                  } catch (err) {
                    console.error("[PROVIDER] Failed to fetch columns:", err);
                  }
                }
              }
              break;

            case "keyword":
            case "none":
            default:
              // Use keywords from backend (already filtered by prefix)
              console.log(
                `[PROVIDER] Using ${
                  candidates?.length || 0
                } keywords from backend`
              );
              if (candidates && candidates.length > 0) {
                candidates.forEach((keyword) => {
                  suggestions.push({
                    label: keyword,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    detail: "SQL Keyword",
                    range,
                  });
                });
              }
              break;
          }

          console.log(`[PROVIDER] Returning ${suggestions.length} suggestions`);
          return { suggestions };
        } catch (e) {
          console.error("[PROVIDER] Error:", e);
          return { suggestions: [] };
        }
      },
    });

    return () => {
      console.log("[SETUP] Disposing SQL completion provider");
      disposable.dispose();
    };
  }, [monaco]);

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
            "suggest.filterGraceful": false,
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
