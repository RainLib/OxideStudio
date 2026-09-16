import {
  isManagedConnection,
  isRocketMqConnection,
} from "@/features/connections/model/connectionConfig";
import {
  activeProjectId,
  scopeConnectionToActiveProject,
} from "@/features/connections/model/connectionScope";
import { connectionService } from "@/services/tauri";
import { rocketMqService } from "@/services/tauri/mq.service";
import { writeConnectionDisplayCache } from "@/startup/dataSourceDisplayCache";
import { v4 as uuidv4 } from "uuid";
import type { ConnectionSlice } from "./types";
export const createPersistenceSlice: ConnectionSlice<
  "saveConnection" | "importConnections" | "removeConnection" | "addConnection"
> = (set, get, ports, _runtime) => ({
  saveConnection: async (config) => {
    if (isManagedConnection(config)) {
      throw new Error(
        "Managed data sources cannot be changed or saved on this device.",
      );
    }
    const scopedConfig = scopeConnectionToActiveProject({
      ...config,
      note: config.note?.trim() || undefined,
    });
    const connections = get().connections;
    const existingIndex = connections.findIndex(
      (c) => c.id === scopedConfig.id,
    );

    let updatedConnections;
    if (existingIndex >= 0) {
      updatedConnections = [...connections];
      updatedConnections[existingIndex] = scopedConfig;
    } else {
      updatedConnections = [...connections, scopedConfig];
    }

    // Optimistic update
    set({
      connections: updatedConnections,
      connectionDisplayCache: writeConnectionDisplayCache(
        activeProjectId(),
        updatedConnections,
      ),
      hasConnectionDisplayCache: true,
      selectedConnection: scopedConfig,
    });

    // Save to backend
    await connectionService.saveConnections(
      updatedConnections,
      activeProjectId(),
    );
  },

  importConnections: async (configs) => {
    if (!configs.length) return;
    if (configs.some(isManagedConnection)) {
      throw new Error(
        "Managed data sources cannot be imported into local connection storage.",
      );
    }
    const imported = configs.map(scopeConnectionToActiveProject);
    const state = get();
    const updatedConnections = [...state.connections, ...imported];

    // Use the same complete-list write as normal saves, but commit all imported
    // candidates together so a failed write cannot leave a partial import.
    await connectionService.saveConnections(
      updatedConnections,
      activeProjectId(),
    );
    set({
      connections: updatedConnections,
      connectionDisplayCache: writeConnectionDisplayCache(
        activeProjectId(),
        updatedConnections,
      ),
      hasConnectionDisplayCache: true,
      selectedConnection:
        imported[imported.length - 1] || state.selectedConnection,
    });
  },

  removeConnection: async (id) => {
    const state = get();
    const connectionToRemove = state.connections.find(
      (connection) => connection.id === id,
    );
    if (connectionToRemove && isManagedConnection(connectionToRemove)) {
      throw new Error(
        "Managed data sources are assigned by your organization and cannot be removed locally.",
      );
    }
    const remainingConnections = state.connections.filter(
      (connection) => connection.id !== id,
    );

    if (remainingConnections.length === state.connections.length) return;

    const connectedConnectionIds = state.connectedConnectionIds.filter(
      (connectionId) => connectionId !== id,
    );
    const connectionRuntimeStates = { ...state.connectionRuntimeStates };
    delete connectionRuntimeStates[id];
    const activeConnectionId =
      state.activeConnectionId === id
        ? (connectedConnectionIds[0] ?? null)
        : state.activeConnectionId;
    set({
      connections: remainingConnections,
      connectionDisplayCache: writeConnectionDisplayCache(
        activeProjectId(),
        remainingConnections,
      ),
      hasConnectionDisplayCache: true,
      activeConnectionId,
      connectedConnectionIds,
      connectionRuntimeStates,
      isConnected: Boolean(
        activeConnectionId &&
          connectedConnectionIds.includes(activeConnectionId),
      ),
      selectedConnection:
        state.selectedConnection?.id === id ? null : state.selectedConnection,
    });

    try {
      await connectionService.deleteConnection(id, activeProjectId());

      if (state.connectedConnectionIds.includes(id)) {
        try {
          if (connectionToRemove && isRocketMqConnection(connectionToRemove)) {
            await rocketMqService.disconnect(id);
          } else {
            await connectionService.disconnect(id);
          }
        } catch (error) {
          console.warn("Failed to disconnect removed data source:", error);
        }
      }

      if (state.activeConnectionId === id) {
        const schemaStore = ports.getSchemaState();
        if (activeConnectionId) {
          schemaStore.restoreConnectionSnapshot(activeConnectionId);
        } else {
          schemaStore.clearActiveMetadata();
        }
      }
    } catch (error) {
      set({
        connections: state.connections,
        connectionDisplayCache: writeConnectionDisplayCache(
          activeProjectId(),
          state.connections,
        ),
        hasConnectionDisplayCache: true,
        activeConnectionId: state.activeConnectionId,
        connectedConnectionIds: state.connectedConnectionIds,
        connectionRuntimeStates: state.connectionRuntimeStates,
        isConnected: state.isConnected,
        selectedConnection: state.selectedConnection,
      });
      throw error;
    }
  },

  addConnection: async (config) => {
    const newConn = scopeConnectionToActiveProject({ ...config, id: uuidv4() });
    await get().saveConnection(newConn);
  },
});
