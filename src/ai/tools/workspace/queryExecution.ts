import type { AiToolExecutionContext } from "@/ai/tools/types";
import {
  createCancellableAiQueryId,
  createRequestId,
  sanitizeQueryIdSegment,
} from "@/ai/tools/workspace/queryIdentity";
import { resolveQueryExecutionTarget } from "@/ai/tools/workspace/targets";
import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import { databaseService, queryService } from "@/services/tauri";
import type { DatabaseDriver, QueryResult } from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";

export async function executeWorkspaceQuery(
  connectionId: string,
  query: string,
  namespace: string | undefined,
  context: AiToolExecutionContext,
  operation: string,
  includeNamespaceArgument = true,
) {
  const queryId = createCancellableAiQueryId(context, operation);
  if (!queryId) {
    return includeNamespaceArgument
      ? queryService.executeQuery(connectionId, query, namespace)
      : queryService.executeQuery(connectionId, query);
  }

  const abortSignal = context.abortSignal;
  if (abortSignal?.aborted) {
    throw new Error("AI tool execution aborted");
  }

  let isSettled = false;
  const abortHandler = () => {
    if (isSettled) return;
    void queryService.cancelQuery(queryId).catch(() => undefined);
  };
  abortSignal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const queryNamespace = includeNamespaceArgument ? namespace : undefined;
    return await queryService.executeQuery(
      connectionId,
      query,
      queryNamespace,
      undefined,
      queryId,
    );
  } finally {
    isSettled = true;
    abortSignal?.removeEventListener("abort", abortHandler);
  }
}

export async function executeReadOnlyWorkspaceQuery(
  connectionId: string,
  query: string,
  namespace: string | undefined,
  driver: DatabaseDriver,
  context: AiToolExecutionContext,
) {
  const normalizedDriver =
    normalizeDatabaseDriverName(String(driver)) ||
    String(driver).trim().toLowerCase();
  if (normalizedDriver !== "postgres" && normalizedDriver !== "mysql") {
    return executeWorkspaceQuery(
      connectionId,
      query,
      namespace,
      context,
      "query.runReadOnly",
    );
  }

  const queryId = createCancellableAiQueryId(context, "query.runReadOnly");
  if (context.abortSignal?.aborted) {
    throw new Error("AI tool execution aborted");
  }

  let isSettled = false;
  const abortHandler = () => {
    if (isSettled || !queryId) return;
    void queryService.cancelQuery(queryId).catch(() => undefined);
  };
  context.abortSignal?.addEventListener("abort", abortHandler, { once: true });

  try {
    return await queryService.executeReadOnlyQuery(
      connectionId,
      query,
      namespace,
      queryId,
    );
  } finally {
    isSettled = true;
    context.abortSignal?.removeEventListener("abort", abortHandler);
  }
}

export async function executeWorkspaceExplainPlan(
  input: {
    connectionId?: string | null;
    namespace?: string | null;
    query: string;
  },
  context: AiToolExecutionContext,
) {
  const { connectionId, namespace, driver } = resolveQueryExecutionTarget(
    input.connectionId,
    input.namespace,
    context,
    "query.explain",
  );
  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const capabilities = await databaseService.getDatabaseCapabilities(
    driver,
    connection?.driverPackageVersion,
  );
  if (!capabilities.supportsExplainPlan) {
    throw new Error(
      `${capabilities.displayName} does not support Explain Plan`,
    );
  }

  const queryId = [
    sanitizeQueryIdSegment(context.requestId),
    "query.explain",
    createRequestId(),
  ].join(":");
  if (context.abortSignal?.aborted) {
    throw new Error("AI tool execution aborted");
  }
  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find(
    (tab) => tab.id === tabState.activeTabId,
  );
  const targetTab =
    activeTab &&
    (!activeTab.connectionId || activeTab.connectionId === connectionId)
      ? activeTab
      : null;
  const database = targetTab?.databaseName || undefined;
  let isSettled = false;
  const abortHandler = () => {
    if (isSettled) return;
    void queryService.cancelQuery(queryId).catch(() => undefined);
  };
  context.abortSignal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const plan = await queryService.explainQuery({
      connectionId,
      queryId,
      sql: input.query,
      schema: database ? undefined : namespace,
      database,
      mode: "estimate",
    });
    if (targetTab) {
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === targetTab.id
            ? {
                ...tab,
                explainPlan: plan,
                queryOutputView: "plan",
                error: null,
              }
            : tab,
        ),
      }));
    }
    return plan;
  } finally {
    isSettled = true;
    context.abortSignal?.removeEventListener("abort", abortHandler);
  }
}

export function limitQueryResults(results: QueryResult[], limit: number) {
  const rowLimit = Math.max(0, Math.floor(limit));
  return results.map((result) => ({
    ...result,
    rows: result.rows.slice(0, rowLimit),
  }));
}
