import { databaseService, queryService } from "@/services/tauri";
import type { QueryResult } from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import { registerCoreAiTools } from "./coreTools";
import { createAiToolRegistry } from "./registry";
import type {
  AiToolAdapters,
  AiToolExecutionContext,
  AiWorkspaceTabSummary,
} from "./types";

export function createWorkspaceAiToolRegistry() {
  return registerCoreAiTools(
    createAiToolRegistry(),
    createWorkspaceAiToolAdapters()
  );
}

export function createWorkspaceAiToolContext(
  requestId = createRequestId()
): AiToolExecutionContext {
  const connectionState = useConnectionStore.getState();
  const activeConnection = connectionState.connections.find(
    (connection) => connection.id === connectionState.activeConnectionId
  );

  return {
    requestId,
    activeConnectionId: connectionState.activeConnectionId,
    activeDriver: activeConnection?.driver ?? null,
  };
}

export function createWorkspaceAiToolAdapters(): AiToolAdapters {
  return {
    listConnections: () =>
      useConnectionStore.getState().connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        driver: connection.driver,
      })),

    getConnectionCapabilities: (driver) =>
      databaseService.getDatabaseCapabilities(driver),

    getActiveTab: () => {
      const tabState = useTabStore.getState();
      const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
      if (!activeTab) return null;
      return {
        id: activeTab.id,
        type: activeTab.type,
        title: activeTab.title,
        sql: activeTab.sql,
        connectionId: activeTab.connectionId ?? null,
      } satisfies AiWorkspaceTabSummary;
    },

    runReadOnlyQuery: async (input, context) => {
      const connectionId = input.connectionId || context.activeConnectionId;
      if (!connectionId) {
        throw new Error("No active connection is available for query.runReadOnly");
      }

      const results = await queryService.executeQuery(connectionId, input.query);
      return limitQueryResults(results, input.limit ?? 200);
    },
  };
}

function limitQueryResults(results: QueryResult[], limit: number) {
  const rowLimit = Math.max(0, Math.floor(limit));
  return results.map((result) => ({
    ...result,
    rows: result.rows.slice(0, rowLimit),
  }));
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `ai-tool-${Date.now()}`;
}
