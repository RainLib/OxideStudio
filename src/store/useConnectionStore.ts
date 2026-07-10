import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { connectionService, SavedConnection } from "@/services/tauri";
import { useSchemaStore } from "./useSchemaStore";
import {
  buildConnectionUrl,
  normalizeConnectionUrlForDriver,
} from "@/lib/connectionUrlParser";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseName,
  defaultDatabasePort,
} from "@/lib/databaseDialect";

const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";
const DEFAULT_PROJECT_ID = "sqls";

export interface ConnectionConfig extends SavedConnection {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionUrl?: string;
  sslMode?: string;
  tags?: string[];
}

interface ConnectionState {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  connectedConnectionIds: string[];
  isConnected: boolean;
  isLoading: boolean;
  selectedConnection: ConnectionConfig | null;

  // Actions
  loadConnections: () => Promise<void>;
  selectConnection: (id: string | null) => void;
  createNewConnection: () => ConnectionConfig;
  updateConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  saveConnection: (config: ConnectionConfig) => Promise<void>;
  addConnection: (config: Omit<ConnectionConfig, "id">) => Promise<void>;
  testConnection: (config: ConnectionConfig) => Promise<string | null>;
  connect: (config: ConnectionConfig) => Promise<string | null>;
  setActiveConnection: (id: string) => Promise<string | null>;
  disconnect: () => Promise<void>;
}

function connectionUrlForConfig(config: ConnectionConfig) {
  if (config.connectionUrl && config.connectionUrl.trim()) {
    return normalizeConnectionUrlForDriver(config.driver, config.connectionUrl);
  }

  return buildConnectionUrl({
    driver: config.driver,
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    sslMode: config.sslMode || "disable",
  });
}

let latestConnectAttempt = 0;

function activeProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

function scopeConnectionToActiveProject<T extends ConnectionConfig>(config: T): T {
  return {
    ...config,
    projectId: config.projectId || activeProjectId(),
  };
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  connectedConnectionIds: [],
  isConnected: false,
  isLoading: true,
  selectedConnection: null,

  loadConnections: async () => {
    try {
      const projectId = activeProjectId();
      const connections = (await connectionService.loadConnections(projectId)).map(
        (connection) => ({
          ...connection,
          projectId: connection.projectId || projectId,
        })
      );
      const activeConnectionId = get().activeConnectionId;
      const activeConnectionExists = connections.some(
        (connection) => connection.id === activeConnectionId
      );
      const connectedConnectionIds = get().connectedConnectionIds.filter((id) =>
        connections.some((connection) => connection.id === id)
      );

      set({
        connections,
        activeConnectionId: activeConnectionExists ? activeConnectionId : null,
        connectedConnectionIds,
        isConnected: activeConnectionExists && connectedConnectionIds.length > 0,
        selectedConnection: null,
        isLoading: false,
      });
    } catch (e) {
      console.error("Failed to load connections:", e);
      set({ isLoading: false });
    }
  },

  selectConnection: (id: string | null) => {
    if (!id) {
      set({ selectedConnection: null });
      return;
    }
    const conn = get().connections.find((c) => c.id === id);
    if (conn) {
      set({ selectedConnection: { ...conn } }); // Clone to avoid direct mutation
    }
  },

  createNewConnection: () => {
    const newConn: ConnectionConfig = {
      id: uuidv4(),
      projectId: activeProjectId(),
      name: "New Connection",
      driver: DEFAULT_DATABASE_DRIVER,
      url: "",
      host: "localhost",
      port: defaultDatabasePort(DEFAULT_DATABASE_DRIVER),
      user: "",
      password: "",
      database: defaultDatabaseName(DEFAULT_DATABASE_DRIVER),
      tags: [],
    };

    set({
      selectedConnection: { ...newConn },
    });
    return newConn;
  },

  updateConnectionConfig: (updates) => {
    const current = get().selectedConnection;
    if (current) {
      set({ selectedConnection: { ...current, ...updates } });
    }
  },

  saveConnection: async (config) => {
    const scopedConfig = scopeConnectionToActiveProject(config);
    const connections = get().connections;
    const existingIndex = connections.findIndex((c) => c.id === scopedConfig.id);

    let updatedConnections;
    if (existingIndex >= 0) {
      updatedConnections = [...connections];
      updatedConnections[existingIndex] = scopedConfig;
    } else {
      updatedConnections = [...connections, scopedConfig];
    }

    // Optimistic update
    set({ connections: updatedConnections, selectedConnection: scopedConfig });

    // Save to backend
    await connectionService.saveConnections(updatedConnections, activeProjectId());
  },

  // Deprecated simplified add
  addConnection: async (config) => {
    const newConn = scopeConnectionToActiveProject({ ...config, id: uuidv4() });
    await get().saveConnection(newConn);
  },

  testConnection: async (config) => {
    try {
      await connectionService.testConnection(
        config.driver,
        connectionUrlForConfig(config)
      );
      return null;
    } catch (e: any) {
      return e.message || String(e);
    }
  },

  connect: async (config) => {
    const attemptId = latestConnectAttempt + 1;
    latestConnectAttempt = attemptId;
    try {
      await connectionService.connect(
        config.id,
        config.driver,
        connectionUrlForConfig(config)
      );

      if (attemptId !== latestConnectAttempt) {
        if (get().activeConnectionId !== config.id) {
          try {
            await connectionService.disconnect(config.id);
          } catch (disconnectError) {
            console.warn(
              "Failed to disconnect superseded backend connection:",
              disconnectError
            );
          }
        }
        return null;
      }

      // Clear only the active metadata after the backend connection is ready.
      // Per-connection snapshots are preserved so switching back to an already
      // opened source does not blank the explorer before cache hydration.
      const schemaStore = useSchemaStore.getState();
      schemaStore.snapshotActiveMetadata();
      schemaStore.clearActiveMetadata();
      set({
        activeConnectionId: config.id,
        connectedConnectionIds: Array.from(
          new Set([...get().connectedConnectionIds, config.id])
        ),
        isConnected: true,
      });

      return null; // No error
    } catch (e: any) {
      if (attemptId !== latestConnectAttempt) {
        return null;
      }
      const message = e.message || String(e);
      return message;
    }
  },

  setActiveConnection: async (id: string) => {
    const {
      activeConnectionId,
      connectedConnectionIds,
      isConnected,
      connections,
    } = get();
    if (activeConnectionId === id && isConnected) {
      return null;
    }

    const connection = connections.find((conn) => conn.id === id);
    if (!connection) {
      const message = `Connection not found: ${id}`;
      console.warn(message);
      return message;
    }

    if (connectedConnectionIds.includes(id)) {
      const schemaStore = useSchemaStore.getState();
      schemaStore.snapshotActiveMetadata();
      schemaStore.restoreConnectionSnapshot(id);
      set({ activeConnectionId: id, isConnected: true });
      return null;
    }

    return get().connect(connection);
  },

  disconnect: async () => {
    const connectionId = get().activeConnectionId;

    if (connectionId) {
      try {
        await connectionService.disconnect(connectionId);
      } catch (e) {
        console.warn("Failed to disconnect backend connection:", e);
      }
    }

    const connectedConnectionIds = get().connectedConnectionIds.filter(
      (id) => id !== connectionId
    );

    const schemaStore = useSchemaStore.getState();
    schemaStore.snapshotActiveMetadata();
    if (connectedConnectionIds[0]) {
      schemaStore.restoreConnectionSnapshot(connectedConnectionIds[0]);
    } else {
      schemaStore.clearActiveMetadata();
    }
    set({
      activeConnectionId: connectedConnectionIds[0] ?? null,
      connectedConnectionIds,
      isConnected: connectedConnectionIds.length > 0,
    });
  },
}));
