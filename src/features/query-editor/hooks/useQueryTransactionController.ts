import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultDatabaseCapabilities, DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import {
  collectStaleTransactionTabIds,
  removeTransactionStates,
  type QueryTransactionSession,
  type QueryTransactionTabContext,
} from "@/lib/queryTransactionLifecycle";
import { transactionService } from "@/services/tauri";
import { useSchemaStore } from "@/store/useSchemaStore";
import { queryTransactionExecutionId } from "../model/executionTarget";

export type QueryTransactionMode = "auto" | "manual";
export type QueryTransactionState = "idle" | "active";
export type QueryTransactionOperation =
  | "begin"
  | "commit"
  | "rollback"
  | null;

type TransactionTab = {
  id: string;
  connectionId?: string | null;
};

type TransactionConnection = {
  id: string;
  driver?: string | null;
};

type QueryTransactionControllerOptions = {
  tabs: TransactionTab[];
  connections: TransactionConnection[];
  activeConnectionId?: string | null;
  activeTabId?: string | null;
  activeTargetSchema?: string | null;
  effectiveConnectionId?: string | null;
  currentSchema?: string | null;
  supportsTransactions: boolean;
  loadSchemas: (connectionId: string, force?: boolean) => Promise<void>;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean,
  ) => Promise<void>;
  bumpMetadataVersion: () => void;
};

function removeTabOperation(
  operations: Record<string, Exclude<QueryTransactionOperation, null>>,
  tabId: string,
) {
  if (!operations[tabId]) return operations;
  const next = { ...operations };
  delete next[tabId];
  return next;
}

/**
 * Owns manual transaction sessions independently from Monaco/provider state.
 * The controller rejects duplicate toolbar operations, rolls back sessions
 * whose tab/connection capability changed, and refreshes metadata only after
 * a successful commit.
 */
export function useQueryTransactionController({
  tabs,
  connections,
  activeConnectionId,
  activeTabId,
  activeTargetSchema,
  effectiveConnectionId,
  currentSchema,
  supportsTransactions,
  loadSchemas,
  loadTables,
  bumpMetadataVersion,
}: QueryTransactionControllerOptions) {
  const [transactionMode, setTransactionMode] =
    useState<QueryTransactionMode>("auto");
  const [transactionStates, setTransactionStates] = useState<
    Record<string, QueryTransactionState>
  >({});
  const [transactionOperations, setTransactionOperations] = useState<
    Record<string, Exclude<QueryTransactionOperation, null>>
  >({});
  const sessionsRef = useRef<Map<string, QueryTransactionSession>>(new Map());
  const operationsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(false);

  const transactionContexts = useMemo<QueryTransactionTabContext[]>(() => {
    const connectionDriverById = new Map(
      connections.map((connection) => [connection.id, connection.driver]),
    );
    return tabs.map((tab) => {
      const connectionId = tab.connectionId || activeConnectionId || null;
      const driver = connectionId
        ? connectionDriverById.get(connectionId) || DEFAULT_DATABASE_DRIVER
        : DEFAULT_DATABASE_DRIVER;
      return {
        tabId: tab.id,
        connectionId,
        supportsTransactions:
          defaultDatabaseCapabilities(driver).supportsTransactions,
      };
    });
  }, [activeConnectionId, connections, tabs]);
  const transactionContextsRef = useRef(
    new Map<string, QueryTransactionTabContext>(),
  );
  transactionContextsRef.current = new Map(
    transactionContexts.map((context) => [context.tabId, context]),
  );

  const transactionState = activeTabId
    ? transactionStates[activeTabId] || "idle"
    : "idle";
  const transactionOperation = activeTabId
    ? transactionOperations[activeTabId] || null
    : null;

  const transactionIdForExecution = useCallback(
    () =>
      queryTransactionExecutionId({
        supportsTransactions,
        transactionMode,
        transactionState,
        connectionId: effectiveConnectionId,
        tabId: activeTabId,
      }),
    [
      activeTabId,
      effectiveConnectionId,
      supportsTransactions,
      transactionMode,
      transactionState,
    ],
  );

  const handleBeginTransaction = useCallback(async () => {
    if (
      !supportsTransactions ||
      !activeTabId ||
      !effectiveConnectionId ||
      transactionOperation ||
      operationsRef.current.has(activeTabId) ||
      transactionState === "active"
    ) {
      return;
    }
    const transactionId = `${effectiveConnectionId}:${activeTabId}`;
    operationsRef.current.add(activeTabId);
    setTransactionOperations((state) => ({
      ...state,
      [activeTabId]: "begin",
    }));
    try {
      await transactionService.beginTransaction(
        effectiveConnectionId,
        transactionId,
        activeTargetSchema ?? currentSchema ?? undefined,
      );
      const latestContext = transactionContextsRef.current.get(activeTabId);
      if (
        !mountedRef.current ||
        !latestContext ||
        latestContext.connectionId !== effectiveConnectionId ||
        !latestContext.supportsTransactions
      ) {
        await transactionService.rollbackTransaction(
          effectiveConnectionId,
          transactionId,
        );
        return;
      }
      sessionsRef.current.set(activeTabId, {
        connectionId: effectiveConnectionId,
        transactionId,
      });
      setTransactionStates((state) => ({
        ...state,
        [activeTabId]: "active",
      }));
    } catch (error) {
      console.error("Begin transaction failed:", error);
    } finally {
      operationsRef.current.delete(activeTabId);
      if (mountedRef.current) {
        setTransactionOperations((state) =>
          removeTabOperation(state, activeTabId),
        );
      }
    }
  }, [
    activeTabId,
    activeTargetSchema,
    currentSchema,
    effectiveConnectionId,
    supportsTransactions,
    transactionOperation,
    transactionState,
  ]);

  const handleCommitTransaction = useCallback(async () => {
    if (
      !supportsTransactions ||
      !activeTabId ||
      transactionOperation ||
      operationsRef.current.has(activeTabId)
    ) {
      return false;
    }
    const session = sessionsRef.current.get(activeTabId);
    if (!session) return false;
    operationsRef.current.add(activeTabId);
    setTransactionOperations((state) => ({
      ...state,
      [activeTabId]: "commit",
    }));
    try {
      await transactionService.commitTransaction(
        session.connectionId,
        session.transactionId,
      );
    } catch (error) {
      console.error("Commit transaction failed:", error);
      operationsRef.current.delete(activeTabId);
      if (mountedRef.current) {
        setTransactionOperations((state) =>
          removeTabOperation(state, activeTabId),
        );
      } else {
        void transactionService.rollbackTransaction(
          session.connectionId,
          session.transactionId,
        );
        sessionsRef.current.delete(activeTabId);
      }
      return false;
    }

    try {
      sessionsRef.current.delete(activeTabId);
      if (!mountedRef.current) return true;
      setTransactionStates((state) => ({
        ...state,
        [activeTabId]: "idle",
      }));
      await loadSchemas(session.connectionId, true);
      const schemaToRefresh =
        useSchemaStore.getState().currentSchema ||
        activeTargetSchema ||
        currentSchema;
      if (schemaToRefresh) {
        await loadTables(session.connectionId, schemaToRefresh, true);
      }
      bumpMetadataVersion();
    } catch (error) {
      console.error("Transaction committed but metadata refresh failed:", error);
    } finally {
      operationsRef.current.delete(activeTabId);
      if (mountedRef.current) {
        setTransactionOperations((state) =>
          removeTabOperation(state, activeTabId),
        );
      }
    }
    return true;
  }, [
    activeTabId,
    activeTargetSchema,
    bumpMetadataVersion,
    currentSchema,
    loadSchemas,
    loadTables,
    supportsTransactions,
    transactionOperation,
  ]);

  const handleRollbackTransaction = useCallback(async () => {
    if (
      !supportsTransactions ||
      !activeTabId ||
      transactionOperation ||
      operationsRef.current.has(activeTabId)
    ) {
      return;
    }
    const session = sessionsRef.current.get(activeTabId);
    if (!session) return;
    operationsRef.current.add(activeTabId);
    setTransactionOperations((state) => ({
      ...state,
      [activeTabId]: "rollback",
    }));
    try {
      await transactionService.rollbackTransaction(
        session.connectionId,
        session.transactionId,
      );
      sessionsRef.current.delete(activeTabId);
      if (mountedRef.current) {
        setTransactionStates((state) => ({
          ...state,
          [activeTabId]: "idle",
        }));
      }
    } catch (error) {
      console.error("Rollback transaction failed:", error);
      if (!mountedRef.current) {
        void transactionService.rollbackTransaction(
          session.connectionId,
          session.transactionId,
        );
        sessionsRef.current.delete(activeTabId);
      }
    } finally {
      operationsRef.current.delete(activeTabId);
      if (mountedRef.current) {
        setTransactionOperations((state) =>
          removeTabOperation(state, activeTabId),
        );
      }
    }
  }, [
    activeTabId,
    supportsTransactions,
    transactionOperation,
  ]);

  const handleTransactionModeChange = useCallback(
    (mode: QueryTransactionMode) => {
      if (!supportsTransactions || transactionOperation) return;
      if (mode === "auto" && transactionState === "active") {
        void handleCommitTransaction().then((committed) => {
          if (committed) setTransactionMode("auto");
        });
        return;
      }
      setTransactionMode(mode);
    },
    [
      handleCommitTransaction,
      supportsTransactions,
      transactionOperation,
      transactionState,
    ],
  );

  useEffect(() => {
    const staleTabIds = collectStaleTransactionTabIds(
      sessionsRef.current,
      transactionContexts,
    );
    if (staleTabIds.length === 0) return;

    for (const tabId of staleTabIds) {
      const session = sessionsRef.current.get(tabId);
      if (!session) continue;
      void transactionService.rollbackTransaction(
        session.connectionId,
        session.transactionId,
      );
      sessionsRef.current.delete(tabId);
      operationsRef.current.delete(tabId);
    }
    setTransactionStates((state) =>
      removeTransactionStates(state, staleTabIds),
    );
    setTransactionOperations((state) =>
      removeTransactionStates(state, staleTabIds),
    );
  }, [transactionContexts]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        for (const [tabId, session] of sessionsRef.current) {
          if (operationsRef.current.has(tabId)) continue;
          void transactionService.rollbackTransaction(
            session.connectionId,
            session.transactionId,
          );
          sessionsRef.current.delete(tabId);
        }
      };
    },
    [],
  );

  return {
    transactionMode,
    transactionState,
    transactionOperation,
    transactionIdForExecution,
    handleTransactionModeChange,
    handleBeginTransaction,
    handleCommitTransaction,
    handleRollbackTransaction,
  };
}
