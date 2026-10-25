import { confirmAction } from "@/lib/appDialogs";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { queryService } from "@/services/tauri";
import { useTaskStore } from "@/store/useTaskStore";

export type ConsoleFileOperation = "import" | "export" | null;

type ConsoleFileTab = {
  id: string;
  sql: string;
};

type ConsoleFileEditor = {
  getModel: () => { getValue: () => string } | null;
  setPosition: (position: { lineNumber: number; column: number }) => void;
  focus: () => void;
};

type ConsoleFileControllerOptions = {
  activeTab?: ConsoleFileTab | null;
  enabled: boolean;
  editorRef: RefObject<ConsoleFileEditor | null>;
  updateTabSql: (tabId: string, sql: string) => void;
};

/** Owns Elasticsearch Console file import/export and rejects stale imports. */
export function useConsoleFileController({
  activeTab,
  enabled,
  editorRef,
  updateTabSql,
}: ConsoleFileControllerOptions) {
  const [operation, setOperation] = useState<ConsoleFileOperation>(null);
  const operationRef = useRef<Exclude<ConsoleFileOperation, null> | null>(null);
  const mountedRef = useRef(false);
  const contextKey = enabled && activeTab ? activeTab.id : null;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      contextKeyRef.current = null;
    };
  }, []);

  const beginOperation = useCallback(
    (next: Exclude<ConsoleFileOperation, null>) => {
      if (operationRef.current) return false;
      operationRef.current = next;
      setOperation(next);
      return true;
    },
    [],
  );

  const finishOperation = useCallback(() => {
    operationRef.current = null;
    if (mountedRef.current) setOperation(null);
  }, []);

  const handleImportConsoleRequests = useCallback(async () => {
    if (!enabled || !activeTab || !contextKey || operationRef.current) return;
    if (
      activeTab.sql.trim() &&
      !(await confirmAction(
        "Importing Console requests replaces the current editor content. Continue?",
      ))
    ) {
      return;
    }
    if (!beginOperation("import")) return;

    const tabId = activeTab.id;
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
      if (!mountedRef.current || contextKeyRef.current !== contextKey) {
        tasks.cancelTask(taskId, "Editor changed before import completed");
        return;
      }
      updateTabSql(tabId, imported.content);
      tasks.finishTask(
        taskId,
        `${imported.fileName} · ${imported.content.length.toLocaleString()} characters`,
      );
      window.requestAnimationFrame(() => {
        if (!mountedRef.current || contextKeyRef.current !== contextKey) return;
        editorRef.current?.setPosition({ lineNumber: 1, column: 1 });
        editorRef.current?.focus();
      });
    } catch (error) {
      tasks.failTask(
        taskId,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      finishOperation();
    }
  }, [
    activeTab,
    beginOperation,
    contextKey,
    editorRef,
    enabled,
    finishOperation,
    updateTabSql,
  ]);

  const handleExportConsoleRequests = useCallback(async () => {
    if (!enabled || !activeTab || operationRef.current) return;
    const source = editorRef.current?.getModel()?.getValue() ?? activeTab.sql;
    if (!beginOperation("export")) return;

    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "export",
      title: "Export Elasticsearch Console requests",
    });
    try {
      const exported = await queryService.exportElasticsearchConsoleFile(source);
      if (!exported.exported) {
        tasks.cancelTask(taskId, "Export cancelled");
        return;
      }
      tasks.finishTask(taskId, `${exported.byteCount.toLocaleString()} bytes`);
    } catch (error) {
      tasks.failTask(
        taskId,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      finishOperation();
    }
  }, [activeTab, beginOperation, editorRef, enabled, finishOperation]);

  return {
    operation,
    handleImportConsoleRequests,
    handleExportConsoleRequests,
  };
}
