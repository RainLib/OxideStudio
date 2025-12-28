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

    const disposable = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [" ", ".", "(", ","],
      provideCompletionItems: async (model: any, position: any) => {
        const fullText = model.getValue();
        const offset = model.getOffsetAt(position);

        // Use the current connection ID from the store
        const { activeConnectionId } = useConnectionStore.getState();
        const { currentSchema, tables } = useSchemaStore.getState();

        if (!activeConnectionId) return { suggestions: [] };

        try {
          // Get context from Rust backend

          const response = await api.getSqlCompletion(fullText, offset);
          console.log("Completion response:", response);

          if (!response.success || !response.data) {
            return { suggestions: [] };
          }

          const { suggestionType, relevantTable, matchString } = response.data;
          const suggestions: any[] = [];

          // Calculate replacement range
          // If matchString is "s", we want to replace "s" with "SELECT"
          // Range is [position.lineNumber, position.column - matchString.length] to [position.lineNumber, position.column]
          let range: any = undefined;
          if (matchString) {
            const startColumn = position.column - matchString.length;
            range = new monaco.Range(
              position.lineNumber,
              startColumn,
              position.lineNumber,
              position.column
            );
          }

          // Rust returns camelCase values due to #[serde(rename_all = "camelCase")]
          // e.g. "table", "column", "keyword"
          const type = suggestionType.toLowerCase();

          if (type === "table") {
            // Suggest tables from the store
            tables.forEach((t) => {
              suggestions.push({
                label: t.name,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: t.name,
                detail: t.schema || currentSchema,
                // range: range,
              });
            });
          } else if (type === "column") {
            // Suggest columns
            let targetTable = relevantTable;
            const targetSchema = currentSchema || "public";

            if (targetTable) {
              // Fetch columns for this table
              const colsRes = await api.getColumns(
                activeConnectionId,
                targetSchema,
                targetTable
              );
              if (colsRes.success && colsRes.data) {
                colsRes.data.forEach((col: any) => {
                  suggestions.push({
                    label: col.name,
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: col.name,
                    detail: col.data_type,
                    // range: range,
                  });
                });
              }
            }
          } else if (type === "keyword" || type === "none") {
            // Suggest keywords returned from Rust backend
            const candidates = response.data.candidates || [];
            candidates.forEach((k) => {
              suggestions.push({
                label: k,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: k,
                // range: range, // Let Monaco handle word replacement for now
              });
            });
          }

          return { suggestions };
        } catch (e) {
          console.error("Completion error:", e);
          return { suggestions: [] };
        }
      },
    });

    return () => disposable.dispose();
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
