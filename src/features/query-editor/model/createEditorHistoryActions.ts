import type { QueryHistoryItem } from "@/lib/queryHistory";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";

interface CreateEditorHistoryActionsContext {
  connections: import("@/store/useConnectionStore").ConnectionConfig[];
  effectiveConnectionId: string | null;
  confirmEditorExecution: (
    sql: string,
    executionDriver?: import("@/services/tauri/types").DatabaseDriver,
  ) => boolean | Promise<boolean>;
  connectedConnectionIds: string[];
}

export function createEditorHistoryActions({
  connections,
  effectiveConnectionId,
  confirmEditorExecution,
  connectedConnectionIds,
}: CreateEditorHistoryActionsContext) {
  const openHistoryInEditor = (item: QueryHistoryItem) => {
    const savedConnection = item.connectionId
      ? connections.find((connection) => connection.id === item.connectionId)
      : undefined;
    const fallbackConnection = connections.find(
      (connection) => connection.id === effectiveConnectionId,
    );
    const targetConnectionId = item.connectionId
      ? savedConnection?.id || item.connectionId
      : fallbackConnection?.id;
    const firstLine = item.sql
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    const title = firstLine
      ? `History · ${firstLine.slice(0, 38)}`
      : "History Query";
    const tabStore = useTabStore.getState();
    const tabId = tabStore.createTab("query", title, item.sql, {
      connectionId: targetConnectionId,
      databaseName: item.databaseName || undefined,
    });
    tabStore.setTargetSchema(tabId, item.schemaName);
  };

  const rerunHistory = async (item: QueryHistoryItem) => {
    const savedConnection = item.connectionId
      ? connections.find((connection) => connection.id === item.connectionId)
      : undefined;
    if (item.connectionId && !savedConnection) {
      throw new Error(
        "The saved data source is no longer available in this project. Open the query and choose another data source.",
      );
    }
    const targetConnection =
      savedConnection ||
      connections.find((connection) => connection.id === effectiveConnectionId);
    if (!targetConnection) {
      throw new Error(
        "Choose a data source before running this history entry.",
      );
    }
    if (!(await confirmEditorExecution(item.sql, targetConnection.driver)))
      return false;

    if (!connectedConnectionIds.includes(targetConnection.id)) {
      const connectionError = await useConnectionStore
        .getState()
        .setActiveConnection(targetConnection.id);
      if (connectionError) throw new Error(connectionError);
    }

    const tabStore = useTabStore.getState();
    const tabId = tabStore.createTab(
      "query",
      `History · ${targetConnection.name}`,
      item.sql,
      {
        connectionId: targetConnection.id,
        databaseName: item.databaseName || undefined,
      },
    );
    tabStore.setTargetSchema(tabId, item.schemaName);
    await tabStore.runTabQuery(tabId, targetConnection.id);
    const executionError = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === tabId)?.error;
    if (executionError) throw new Error(executionError);
    return true;
  };

  return { openHistoryInEditor, rerunHistory };
}
