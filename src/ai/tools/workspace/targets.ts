import type { AiToolExecutionContext } from "@/ai/tools/types";
import { databaseService } from "@/services/tauri";
import type { DatabaseDriver } from "@/services/tauri/types";
import {
  isManagedConnection,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { querySchemaContextForTab, useTabStore } from "@/store/useTabStore";

export async function resolveMetadataTarget(
  requestedConnectionId: string | null | undefined,
  requestedNamespace: string | null | undefined,
  context: AiToolExecutionContext,
  toolName: string,
) {
  const connectionId = requestedConnectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error(`No active connection is available for ${toolName}`);
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  if (connection && isManagedConnection(connection)) {
    throw new Error(
      "Managed AI access requires an organization ai.use grant and an enterprise Gateway session.",
    );
  }
  const driver = connection?.driver ?? context.activeDriver ?? null;
  if (!driver) {
    throw new Error(`Connection driver is not available for ${connectionId}`);
  }

  const namespace =
    requestedNamespace ||
    context.activeNamespace ||
    useSchemaStore.getState().currentSchema ||
    "";
  const capabilities = await databaseService.getDatabaseCapabilities(
    driver,
    connection?.driverPackageVersion,
  );
  return { connectionId, namespace, driver, capabilities };
}

export function resolveQueryExecutionTarget(
  requestedConnectionId: string | null | undefined,
  requestedNamespace: string | null | undefined,
  context: AiToolExecutionContext,
  toolName: string,
) {
  const connectionId = requestedConnectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error(`No active connection is available for ${toolName}`);
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const driver = connection?.driver ?? context.activeDriver ?? "postgres";
  const namespace =
    requestedNamespace ||
    inferActiveQueryNamespace(connectionId, driver, context) ||
    context.activeNamespace ||
    undefined;

  return { connectionId, namespace, driver };
}

export function requireLocalAiConnection(connectionId: string) {
  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  if (connection && isManagedConnection(connection)) {
    throw new Error(
      "Managed AI access is unavailable without an organization ai.use grant.",
    );
  }
}

function inferActiveQueryNamespace(
  connectionId: string,
  driver: DatabaseDriver,
  context: AiToolExecutionContext,
) {
  const schemaState = useSchemaStore.getState();
  if (
    context.activeTab &&
    (!context.activeTab.connectionId ||
      context.activeTab.connectionId === connectionId)
  ) {
    return querySchemaContextForTab(
      {
        targetSchema: context.activeTab.targetSchema ?? undefined,
        schemaName: context.activeTab.schemaName ?? undefined,
        tableName: context.activeTab.tableName ?? undefined,
        objectType: context.activeTab.objectType ?? undefined,
      },
      context.activeNamespace || schemaState.currentSchema,
      driver,
    );
  }

  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find(
    (tab) => tab.id === tabState.activeTabId,
  );

  if (
    activeTab &&
    (!activeTab.connectionId || activeTab.connectionId === connectionId)
  ) {
    return querySchemaContextForTab(
      activeTab,
      schemaState.currentSchema,
      driver,
    );
  }

  return schemaState.currentSchema || undefined;
}
