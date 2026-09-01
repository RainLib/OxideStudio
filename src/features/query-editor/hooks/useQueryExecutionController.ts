import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { extractSqlParameters } from "@/lib/sqlParameters";
import { queryService } from "@/services/tauri";
import { useTaskStore } from "@/store/useTaskStore";
import {
  resolveQueryExecutionTarget,
  type QueryExecutionKind,
  type QueryExecutionSnapshot,
} from "../model/queryExecutionTarget";

export type ParameterExecutionRequest = {
  tabId: string;
  connectionId: string;
  sql: string;
  transactionId?: string;
  sourceStartOffset?: number;
};

type QueryExecutionTab = {
  id: string;
  sql: string;
};

type QueryExecutionPosition = {
  lineNumber: number;
  column: number;
};

type QueryExecutionSelection = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

type QueryExecutionModel = {
  getValue: () => string;
  getValueInRange: (selection: QueryExecutionSelection) => string;
  getOffsetAt: (position: QueryExecutionPosition) => number;
};

export type QueryExecutionEditor = {
  getModel: () => QueryExecutionModel | null;
  getSelection: () => QueryExecutionSelection | null;
  getPosition: () => QueryExecutionPosition | null;
};

type RunTabQuery = (
  tabId: string,
  connectionId: string,
  sqlOverride?: string,
  transactionId?: string,
  sourceStartOffset?: number,
) => Promise<void>;

type QueryExecutionControllerOptions = {
  activeTab?: QueryExecutionTab | null;
  connectionId?: string | null;
  connectionLabel?: string | null;
  canExecute: boolean;
  driver: string;
  kind: QueryExecutionKind;
  executeAllOnBlankLine: boolean;
  supportsExplainPlan: boolean;
  /**
   * A confirmation may be supplied by a native dialog or the in-app dialog.
   * Keeping it awaitable makes every editor entry point wait for the same
   * decision instead of racing a modal against a query dispatch.
   */
  confirmExecution: (sql: string) => boolean | Promise<boolean>;
  onNoExecutableTarget?: () => void;
  editorRef: RefObject<QueryExecutionEditor | null>;
  transactionIdForExecution: () => string | undefined;
  updateTabSql: (tabId: string, sql: string) => void;
  runTabQuery: RunTabQuery;
  runExplainPlan: (
    tabId: string,
    connectionId: string,
    sql: string,
    mode: "estimate" | "analyze",
  ) => Promise<void>;
  cancelTabQuery: (tabId: string) => Promise<void>;
};

export function captureQueryExecutionSnapshot(
  editor: QueryExecutionEditor | null,
): QueryExecutionSnapshot | null {
  const model = editor?.getModel();
  const selection = editor?.getSelection();
  const position = editor?.getPosition();
  if (!model || !selection || !position) return null;
  return {
    fullText: model.getValue(),
    selectedText: model.getValueInRange(selection),
    selectionStart: model.getOffsetAt({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn,
    }),
    selectionEnd: model.getOffsetAt({
      lineNumber: selection.endLineNumber,
      column: selection.endColumn,
    }),
    cursorOffset: model.getOffsetAt(position),
  };
}

function fallbackSnapshot(fullText: string): QueryExecutionSnapshot {
  return {
    fullText,
    selectedText: "",
    selectionStart: 0,
    selectionEnd: 0,
    cursorOffset: 0,
  };
}

/**
 * Owns the editor-facing query execution workflow while the tab store remains
 * responsible for connection recovery, result state, history and backend
 * cancellation. This keeps target resolution, parameter gating, destructive
 * confirmation and Explain entry points consistent across toolbar/shortcut
 * actions.
 */
export function useQueryExecutionController({
  activeTab,
  connectionId,
  connectionLabel,
  canExecute,
  driver,
  kind,
  executeAllOnBlankLine,
  supportsExplainPlan,
  confirmExecution,
  onNoExecutableTarget,
  editorRef,
  transactionIdForExecution,
  updateTabSql,
  runTabQuery,
  runExplainPlan,
  cancelTabQuery,
}: QueryExecutionControllerOptions) {
  const [parameterExecution, setParameterExecution] =
    useState<ParameterExecutionRequest | null>(null);
  const currentTransactionId = transactionIdForExecution();
  const contextKey = activeTab?.id && connectionId
    ? `${activeTab.id}:${connectionId}`
    : null;
  const latestContextKeyRef = useRef<string | null>(contextKey);
  const mountedRef = useRef(false);
  const executionOperationsRef = useRef<Set<string>>(new Set());
  latestContextKeyRef.current = contextKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      latestContextKeyRef.current = null;
    };
  }, []);

  const runExclusive = useCallback(
    async (key: string, operation: () => Promise<void>) => {
      if (executionOperationsRef.current.has(key)) return false;
      executionOperationsRef.current.add(key);
      try {
        await operation();
        return true;
      } finally {
        executionOperationsRef.current.delete(key);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      parameterExecution &&
      (parameterExecution.tabId !== activeTab?.id ||
        parameterExecution.connectionId !== connectionId ||
        parameterExecution.transactionId !== currentTransactionId)
    ) {
      setParameterExecution(null);
    }
  }, [
    activeTab?.id,
    connectionId,
    currentTransactionId,
    parameterExecution,
  ]);

  const requestParameterizedExecution = useCallback(
    (
      sql: string,
      transactionId?: string,
      sourceStartOffset?: number,
    ) => {
      if (
        !activeTab ||
        !connectionId ||
        extractSqlParameters(sql, driver).length === 0
      ) {
        return false;
      }
      setParameterExecution({
        tabId: activeTab.id,
        connectionId,
        sql,
        transactionId,
        sourceStartOffset,
      });
      return true;
    },
    [activeTab, connectionId, driver],
  );

  const handleRun = useCallback(() => {
    if (!canExecute || !activeTab || !connectionId || !contextKey) return;
    const snapshot =
      captureQueryExecutionSnapshot(editorRef.current) ||
      fallbackSnapshot(activeTab.sql);
    const sql = snapshot.fullText;
    if (!sql.trim()) return;
    const transactionId = transactionIdForExecution();
    if (requestParameterizedExecution(sql, transactionId)) return;
    void runExclusive(contextKey, async () => {
      if (!(await confirmExecution(sql))) return;
      updateTabSql(activeTab.id, sql);
      await runTabQuery(activeTab.id, connectionId, undefined, transactionId);
    });
  }, [
    activeTab,
    canExecute,
    confirmExecution,
    connectionId,
    contextKey,
    editorRef,
    requestParameterizedExecution,
    runTabQuery,
    runExclusive,
    transactionIdForExecution,
    updateTabSql,
  ]);

  const handleRunCurrent = useCallback(async (capturedSnapshot?: QueryExecutionSnapshot | null) => {
    if (!canExecute || !activeTab || !connectionId || !contextKey) return;
    const snapshot =
      capturedSnapshot || captureQueryExecutionSnapshot(editorRef.current);
    if (!snapshot) return;

    await runExclusive(contextKey, async () => {
      let target;
      try {
        target = await resolveQueryExecutionTarget({
          kind,
          mode: "current",
          snapshot,
          executeAllOnBlankLine,
          resolveSqlStatementAtCursor:
            kind === "sql"
              ? (sql, cursorOffset) =>
                  queryService.resolveSqlStatementAtCursor(
                    connectionId,
                    sql,
                    cursorOffset,
                  )
              : undefined,
        });
      } catch (error) {
        const tasks = useTaskStore.getState();
        const taskId = tasks.startTask({
          kind: "query",
          title: "Resolve statement at cursor",
          detail: connectionLabel || connectionId,
        });
        tasks.failTask(
          taskId,
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
      if (
        !target?.sql.trim() ||
        !mountedRef.current ||
        latestContextKeyRef.current !== contextKey
      ) {
        if (
          mountedRef.current &&
          latestContextKeyRef.current === contextKey &&
          !target?.sql.trim()
        ) {
          onNoExecutableTarget?.();
        }
        return;
      }

      const transactionId = transactionIdForExecution();
      if (
        requestParameterizedExecution(
          target.sql,
          transactionId,
          target.sourceStartOffset,
        )
      ) {
        return;
      }
      if (!(await confirmExecution(target.sql))) return;
      await runTabQuery(
        activeTab.id,
        connectionId,
        target.sql,
        transactionId,
        target.sourceStartOffset,
      );
    });
  }, [
    activeTab,
    canExecute,
    confirmExecution,
    connectionId,
    connectionLabel,
    contextKey,
    editorRef,
    executeAllOnBlankLine,
    kind,
    onNoExecutableTarget,
    requestParameterizedExecution,
    runTabQuery,
    runExclusive,
    transactionIdForExecution,
  ]);

  const handleCancelRun = useCallback(() => {
    if (activeTab) void cancelTabQuery(activeTab.id);
  }, [activeTab, cancelTabQuery]);

  const handleConfigureParameters = useCallback(() => {
    if (!activeTab) return;
    const snapshot = captureQueryExecutionSnapshot(editorRef.current);
    const sql = snapshot
      ? snapshot.selectedText.trim() || snapshot.fullText
      : activeTab.sql;
    requestParameterizedExecution(
      sql,
      transactionIdForExecution(),
      snapshot?.selectedText.trim() ? snapshot.selectionStart : undefined,
    );
  }, [
    activeTab,
    editorRef,
    requestParameterizedExecution,
    transactionIdForExecution,
  ]);

  const handleExplain = useCallback(
    (mode: "estimate" | "analyze") => {
      if (
        !canExecute ||
        !supportsExplainPlan ||
        !connectionId ||
        !activeTab ||
        !contextKey ||
        executionOperationsRef.current.has(contextKey)
      ) {
        return;
      }
      const snapshot = captureQueryExecutionSnapshot(editorRef.current);
      const sql = snapshot
        ? snapshot.selectedText.trim() || snapshot.fullText
        : activeTab.sql;
      if (!sql.trim() || extractSqlParameters(sql, driver).length > 0) return;
      if (
        mode === "analyze" &&
        !window.confirm(
          "Explain Analyze executes this query to collect actual timing and row counts. It runs in a backend-enforced read-only transaction, but it can still be expensive. Continue?",
        )
      ) {
        return;
      }
      void runExclusive(contextKey, () =>
        runExplainPlan(activeTab.id, connectionId, sql, mode),
      );
    },
    [
      activeTab,
      canExecute,
      connectionId,
      contextKey,
      driver,
      editorRef,
      runExplainPlan,
      runExclusive,
      supportsExplainPlan,
    ],
  );

  const handleRunParameterizedSql = useCallback(
    (compiledSql: string) => {
      const request = parameterExecution;
      if (!request) return;
      if (
        request.tabId !== activeTab?.id ||
        request.connectionId !== connectionId ||
        request.transactionId !== transactionIdForExecution()
      ) {
        setParameterExecution(null);
        return;
      }
      const requestContextKey = `${request.tabId}:${request.connectionId}`;
      void runExclusive(requestContextKey, async () => {
        if (!(await confirmExecution(compiledSql))) return;
        setParameterExecution(null);
        await runTabQuery(
          request.tabId,
          request.connectionId,
          compiledSql,
          request.transactionId,
          request.sourceStartOffset,
        );
      });
    },
    [
      activeTab?.id,
      confirmExecution,
      connectionId,
      parameterExecution,
      runTabQuery,
      runExclusive,
      transactionIdForExecution,
    ],
  );

  const closeParameterExecution = useCallback(
    () => setParameterExecution(null),
    [],
  );

  return {
    parameterExecution,
    handleRun,
    handleRunCurrent,
    handleCancelRun,
    handleConfigureParameters,
    handleExplain,
    handleRunParameterizedSql,
    closeParameterExecution,
  };
}
