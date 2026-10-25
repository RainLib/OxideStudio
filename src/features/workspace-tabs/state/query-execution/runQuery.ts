import { queryTextForLanguage } from "@/features/workspace-tabs/model/queryLanguage";
import { refreshMetadataAfterQuery } from "@/features/workspace-tabs/model/queryMetadata";
import {
  boundedQueryResultRuns,
  snapshotActiveQueryResultRun,
} from "@/features/workspace-tabs/model/queryResults";
import { querySchemaContextForTab } from "@/features/workspace-tabs/model/tabIdentity";
import { QueryResultRun } from "@/features/workspace-tabs/model/types";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import {
  extractQueryExecutionError,
  isMissingConnectionSession,
} from "@/lib/queryErrorPresentation";
import {
  queryHistoryRowCount,
  queryHistoryStatusFromError,
} from "@/lib/queryHistory";
import { extractSchemaContextChange } from "@/lib/sqlAnalysis";
import { QueryResult, queryService } from "@/services/tauri";
import {
  ensureConnectionReady,
  restoreConnectionSession,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTaskStore } from "@/store/useTaskStore";
import { v4 as uuidv4 } from "uuid";
import type { TabSlice } from "../types";
import { runFileQuery } from "./fileQuery";

/** Owns query execution, retry, result projection, and execution-history lifecycle. */
export const createRunQueryAction: TabSlice<"runTabQuery"> = (set, get) => ({
  runTabQuery: async (
    id: string,
    connectionId: string,
    sqlOverride?: string,
    transactionId?: string,
    sourceStartOffset?: number,
  ) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.fileQuery) return runFileQuery(set, get, id, sqlOverride);

    const editorQuery = sqlOverride || tab.sql;
    if (!editorQuery.trim()) return;
    const startedAt = Date.now();
    const { currentSchema } = useSchemaStore.getState();
    const connection = useConnectionStore
      .getState()
      .connections.find((item) => item.id === connectionId);
    const sqlToRun = queryTextForLanguage(
      editorQuery,
      connection?.driver || DEFAULT_DATABASE_DRIVER,
      tab.queryLanguage,
      tab.elasticsearchVariables,
    );
    const isNativeObjectDataLoad =
      tab.type === "table" &&
      !supportsTableWorkspace(
        defaultDatabaseCapabilities(
          connection?.driver || DEFAULT_DATABASE_DRIVER,
        ),
      );
    const schemaContext = querySchemaContextForTab(
      tab,
      currentSchema,
      connection?.driver || DEFAULT_DATABASE_DRIVER,
    );
    const historyContext = {
      projectId: connection?.projectId || "sqls",
      connectionId,
      connectionName: connection?.name || null,
      driver: connection?.driver || null,
      databaseName: tab.databaseName || connection?.database || null,
      schemaName: schemaContext || null,
      sql: sqlToRun,
      executionMode:
        sqlOverride === undefined
          ? ("console" as const)
          : ("statement" as const),
      startedAt,
    };
    const queryId = `${id}:${uuidv4()}`;
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "query",
      title: `${isNativeObjectDataLoad ? "Load" : "Run"} ${tab.title}`,
      detail: isNativeObjectDataLoad
        ? "Fetching object data"
        : connection?.driver === "elasticsearch"
          ? `Executing ${tab.queryLanguage === "elasticsearch-eql" ? "EQL" : "Query DSL"}`
          : defaultDatabaseCapabilities(
                connection?.driver || DEFAULT_DATABASE_DRIVER,
              ).supportsSqlQuery
            ? "Executing SQL"
            : "Executing query",
    });

    // Update state to executing
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              isExecuting: true,
              runningQueryId: queryId,
              error: null,
              queryError: null,
              explainPlan: null,
              queryOutputView: "results",
              activeResultIndex: t.activeResultIndex ?? 0,
              executingResultIndex:
                t.type === "table" ? undefined : (t.activeResultIndex ?? 0),
              executingResultRunId:
                t.type === "table" ? undefined : t.activeResultRunId,
            }
          : t,
      ),
    }));

    try {
      console.log(
        "TabStore: Running query with schema context:",
        schemaContext,
      );

      const readiness = await ensureConnectionReady(connectionId);
      const currentTab = get().tabs.find((candidate) => candidate.id === id);
      const tabContextIsCurrent = Boolean(
        currentTab &&
          currentTab.connectionId === tab.connectionId &&
          currentTab.databaseName === tab.databaseName,
      );
      if (!tabContextIsCurrent || readiness.status === "cancelled") {
        taskStore.cancelTask(
          taskId,
          "Workspace changed before the query began",
        );
        set((state) => ({
          tabs: state.tabs.map((candidate) =>
            candidate.id === id && candidate.runningQueryId === queryId
              ? {
                  ...candidate,
                  isExecuting: false,
                  runningQueryId: null,
                  executingResultIndex: undefined,
                  executingResultRunId: undefined,
                }
              : candidate,
          ),
        }));
        return;
      }
      if (readiness.status === "error") {
        throw new Error(readiness.message);
      }

      const usesNativeQueryPaging =
        tab.type === "query" &&
        !transactionId &&
        connection?.driver.trim().toLocaleLowerCase() === "iotdb";
      let nativeQueryCursor: string | null = null;
      let nativeQueryHasMore = false;
      const nativeQueryPageSize = 500;
      if (usesNativeQueryPaging && tab.nativeQueryCursor) {
        // A cursor is bound to the previous statement/result. Do not leave it
        // active while replacing the result surface with a new query.
        await queryService
          .closeNativeQueryPage(connectionId, tab.nativeQueryCursor)
          .catch(() => undefined);
      }
      const execute = async () => {
        if (!usesNativeQueryPaging) {
          return queryService.executeQuery(
            connectionId,
            sqlToRun,
            tab.databaseName ? undefined : schemaContext || undefined,
            transactionId,
            queryId,
            tab.databaseName,
          );
        }
        const page = await queryService.executeNativeQueryPage(
          connectionId,
          sqlToRun,
          nativeQueryPageSize,
          10_000,
          queryId,
        );
        nativeQueryCursor = page.nextCursor || null;
        nativeQueryHasMore = Boolean(page.nextCursor);
        return [page.result];
      };

      let results: QueryResult[];
      try {
        results = await execute();
      } catch (error) {
        if (!isMissingConnectionSession(error)) throw error;
        if (transactionId) {
          throw new Error(
            "The connection session for this transaction expired. Start a new transaction before running the query again; OxideStudio will not replay transactional statements automatically.",
          );
        }

        taskStore.updateTask(taskId, {
          detail: `Restoring ${readiness.connection.name} before retrying`,
        });
        const restored = await restoreConnectionSession(connectionId);
        const latestTab = get().tabs.find((candidate) => candidate.id === id);
        const contextIsStillCurrent = Boolean(
          latestTab &&
            latestTab.runningQueryId === queryId &&
            latestTab.connectionId === tab.connectionId &&
            latestTab.databaseName === tab.databaseName,
        );
        if (!contextIsStillCurrent || restored.status === "cancelled") {
          taskStore.cancelTask(
            taskId,
            "Workspace changed while reconnecting the data source",
          );
          set((state) => ({
            tabs: state.tabs.map((candidate) =>
              candidate.id === id && candidate.runningQueryId === queryId
                ? {
                    ...candidate,
                    isExecuting: false,
                    runningQueryId: null,
                    executingResultIndex: undefined,
                    executingResultRunId: undefined,
                  }
                : candidate,
            ),
          }));
          return;
        }
        if (restored.status === "error") {
          throw new Error(restored.message);
        }

        try {
          results = await execute();
        } catch (retryError) {
          if (isMissingConnectionSession(retryError)) {
            throw new Error(
              `Could not reconnect to “${restored.connection.name}”: the backend session closed again immediately. Test this data source in Connection Settings, then retry the query.`,
            );
          }
          throw retryError;
        }
      }

      console.log("[TabStore] Query successfully finished", results);
      const mongoUseDatabase =
        connection?.driver.trim().toLocaleLowerCase() === "mongodb"
          ? extractSchemaContextChange(sqlToRun)
          : null;
      if (mongoUseDatabase) {
        // MongoDB shell `use <database>` changes the selected namespace for
        // subsequent statements. Pin it on this tab before the asynchronous
        // Explorer refresh so later runs cannot fall back to a stale target.
        get().setTargetSchema(id, mongoUseDatabase);
      }
      const rowCount = queryHistoryRowCount(results);
      const finishedAt = Date.now();
      useHistoryStore.getState().recordExecution({
        ...historyContext,
        status: "success",
        durationMs: finishedAt - startedAt,
        rowCount,
        errorMessage: null,
        finishedAt,
      });
      taskStore.finishTask(
        taskId,
        `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}`,
      );

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id !== id || t.runningQueryId !== queryId
            ? t
            : (() => {
                const current = snapshotActiveQueryResultRun(t);
                const run: QueryResultRun | undefined =
                  current.type === "query" && results.length > 0
                    ? {
                        id: `run:${uuidv4()}`,
                        completedAt: finishedAt,
                        sql: sqlToRun,
                        results,
                        activeResultIndex: 0,
                      }
                    : undefined;
                const resultRuns = run
                  ? boundedQueryResultRuns([...(current.resultRuns || []), run])
                  : current.resultRuns;
                return {
                  ...current,
                  isExecuting: false,
                  runningQueryId: null,
                  results: results || null,
                  resultSql: sqlToRun,
                  nativeQueryCursor,
                  nativeQueryHasMore,
                  nativeQueryPageSize: usesNativeQueryPaging
                    ? nativeQueryPageSize
                    : undefined,
                  activeResultIndex: 0,
                  executingResultIndex: undefined,
                  executingResultRunId: undefined,
                  gridState: undefined,
                  resultGridStates: undefined,
                  resultRuns,
                  activeResultRunId: run?.id,
                  queryError: null,
                };
              })(),
        ),
      }));

      if (!transactionId) {
        void refreshMetadataAfterQuery(
          connectionId,
          schemaContext || undefined,
          sqlToRun,
          results,
        ).catch((error) => {
          console.warn("[TabStore] Metadata refresh after query failed", error);
        });
      }
    } catch (e: unknown) {
      const queryError = extractQueryExecutionError(
        e,
        sqlToRun,
        tab.sql,
        sourceStartOffset ?? (sqlOverride === undefined ? 0 : undefined),
      );
      const message = queryError.message;
      const finishedAt = Date.now();
      useHistoryStore.getState().recordExecution({
        ...historyContext,
        status: queryHistoryStatusFromError(message),
        durationMs: finishedAt - startedAt,
        rowCount: null,
        errorMessage: message,
        finishedAt,
      });
      taskStore.failTask(taskId, message);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id && t.runningQueryId === queryId
            ? {
                ...t,
                isExecuting: false,
                runningQueryId: null,
                executingResultIndex: undefined,
                executingResultRunId: undefined,
                error: message,
                queryError,
              }
            : t,
        ),
      }));
    }
  },
});
