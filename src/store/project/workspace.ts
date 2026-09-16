import { connectionDisplaySummaries } from "@/startup/dataSourceDisplayCache";
import { connectionService } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useEditorGroupStore } from "@/store/useEditorGroupStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { unstable_batchedUpdates } from "react-dom";
import { readProjectConnections } from "@/features/connections/model/connectionScope";
import type { Project } from "@/services/tauri/store.service";
import { writeActiveProjectId } from "./identity";

type ProjectConnections = Awaited<ReturnType<typeof readProjectConnections>>;

function disconnectPreviousProjectConnections(connectionIds: string[]) {
  for (const connectionId of connectionIds) {
    void connectionService.disconnect(connectionId).catch((error) => {
      console.warn("Failed to disconnect previous project connection", error);
    });
  }
}

export function replaceProjectWorkspace(
  project: Project,
  connections: ProjectConnections,
  updateProject: () => void,
) {
  const previousConnectionIds = [
    ...useConnectionStore.getState().connectedConnectionIds,
  ];
  const initialConnectionId = connections[0]?.id ?? null;
  writeActiveProjectId(project.id);
  unstable_batchedUpdates(() => {
    useSchemaStore.getState().reset();
    useEditorGroupStore.getState().reset();
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useConnectionStore.setState({
      connections,
      connectionDisplayCache: connectionDisplaySummaries(connections),
      hasConnectionDisplayCache: true,
      activeConnectionId: initialConnectionId,
      connectedConnectionIds: [],
      connectionRuntimeStates: {},
      isConnected: false,
      selectedConnection: null,
      isLoading: false,
    });
    updateProject();
  });
  if (initialConnectionId) {
    // Paint the first data source from the target project's SQLite metadata
    // immediately. Establishing a live connection remains an explicit action.
    void useSchemaStore
      .getState()
      .hydrateConnectionMetadataFromCache(initialConnectionId);
  }
  disconnectPreviousProjectConnections(previousConnectionIds);
}
