import type { AiToolExecutionContext } from "@/ai/tools/types";
import { createRequestId } from "@/ai/tools/workspace/queryIdentity";
import { workspaceTabSummaryFromTab } from "@/ai/tools/workspace/workspaceState";
import { captureWorkspaceUiActionContext } from "@/ai/ui-actions/context";
import { createWorkspaceContextBinding } from "@/ai/workspaceContext";
import {
  isManagedConnection,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

export function createWorkspaceAiToolContext(
  requestId: string = createRequestId(),
  options: { activeNamespace?: string | null } = {},
): AiToolExecutionContext {
  const connectionState = useConnectionStore.getState();
  const schemaState = useSchemaStore.getState();
  const tabState = useTabStore.getState();
  const activeConnection = connectionState.connections.find(
    (connection) => connection.id === connectionState.activeConnectionId,
  );
  const authorizedLocalConnection =
    activeConnection && !isManagedConnection(activeConnection)
      ? activeConnection
      : null;
  const activeTab = tabState.tabs.find(
    (tab) => tab.id === tabState.activeTabId,
  );

  return {
    requestId,
    workspaceContext: createWorkspaceContextBinding(
      captureWorkspaceUiActionContext(),
    ),
    activeConnectionId: authorizedLocalConnection?.id ?? null,
    activeDriver: authorizedLocalConnection?.driver ?? null,
    // An Assistant composer may choose a schema for just its next turn. It is
    // a frozen tool-context override, not a mutation of Explorer state.
    activeNamespace: options.activeNamespace ?? schemaState.currentSchema,
    activeTab: activeTab ? workspaceTabSummaryFromTab(activeTab) : null,
  };
}
