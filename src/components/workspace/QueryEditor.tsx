import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { EditorActionBar } from "./EditorActionBar";
import Editor, { useMonaco } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

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

        // If no connection, return static SQL keywords
        if (!activeConnectionId) {
          console.log("[PROVIDER] No connection, returning static keywords");
          return {
            suggestions: [
              {
                label: "SELECT",
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: "SELECT",
                range,
              },
              {
                label: "FROM",
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: "FROM",
                range,
              },
              {
                label: "WHERE",
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: "WHERE",
                range,
              },
              {
                label: "INSERT",
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: "INSERT",
                range,
              },
              {
                label: "UPDATE",
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: "UPDATE",
                range,
              },
              {
                label: "DELETE",
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: "DELETE",
                range,
              },
            ],
          };
        }

        try {
          // Call Rust backend for context analysis
          const response = await api.getSqlCompletion(fullText, offset);
          console.log("[PROVIDER] Backend response:", response);

          if (!response.success || !response.data) {
            console.warn(
              "[PROVIDER] Backend failed, returning static keywords"
            );
            return {
              suggestions: [
                {
                  label: "SELECT",
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: "SELECT",
                  range,
                },
                {
                  label: "FROM",
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: "FROM",
                  range,
                },
                {
                  label: "WHERE",
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: "WHERE",
                  range,
                },
              ],
            };
          }

          const { suggestionType, relevantTable, candidates } = response.data;
          const suggestions: any[] = [];
          const type = suggestionType.toLowerCase();

          console.log(
            `[PROVIDER] Type: ${type}, Candidates: ${candidates?.length || 0}`
          );

          // Handle different suggestion types
          if (type === "table") {
            // Suggest tables from schema
            tables.forEach((t) => {
              suggestions.push({
                label: t.name,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: t.name,
                detail: `Table (${t.schema || currentSchema})`,
                range,
              });
            });
          } else if (type === "column") {
            // Suggest columns from the relevant table
            if (relevantTable) {
              const targetSchema = currentSchema || "public";
              try {
                const colsRes = await api.getColumns(
                  activeConnectionId,
                  targetSchema,
                  relevantTable
                );
                if (colsRes.success && colsRes.data) {
                  colsRes.data.forEach((col: any) => {
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
          } else if (type === "keyword" || type === "none") {
            // Use keywords from backend
            console.log(`[PROVIDER] Processing keywords:`, candidates);
            if (candidates && candidates.length > 0) {
              candidates.forEach((k) => {
                const item = {
                  label: k,
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: k,
                  detail: "SQL Keyword",
                  range,
                };
                console.log(`[PROVIDER] Adding keyword:`, k, item);
                suggestions.push(item);
              });
            }
          }

          console.log(`[PROVIDER] Final suggestions array:`, suggestions);
          console.log(`[PROVIDER] Returning ${suggestions.length} suggestions`);
          return { suggestions };
        } catch (e) {
          console.error("[PROVIDER] Error:", e);
          // Return static keywords on error
          return {
            suggestions: [
              {
                label: "SELECT",
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: "SELECT",
                range,
              },
              {
                label: "FROM",
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: "FROM",
                range,
              },
            ],
          };
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

  if (!activeTab) return null;

  return (
    <div className="relative h-full w-full bg-[#1e1e1e] flex flex-col">
      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={activeTab.sql}
          onChange={(value) => updateTabSql(activeTab.id, value || "")}
          onMount={(editor) => (editorRef.current = editor)}
          theme="vs-dark"
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
