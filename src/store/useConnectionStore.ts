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

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  isConnected: false,
  isLoading: true,
  selectedConnection: null,

  loadConnections: async () => {
    try {
      const connections = await connectionService.loadConnections();
      set({ connections, isLoading: false });
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
    const connections = get().connections;
    const existingIndex = connections.findIndex((c) => c.id === config.id);

    let updatedConnections;
    if (existingIndex >= 0) {
      updatedConnections = [...connections];
      updatedConnections[existingIndex] = config;
    } else {
      updatedConnections = [...connections, config];
    }

    // Optimistic update
    set({ connections: updatedConnections, selectedConnection: config });

    // Save to backend
    await connectionService.saveConnections(updatedConnections);
  },

  // Deprecated simplified add
  addConnection: async (config) => {
    const newConn = { ...config, id: uuidv4() };
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
    const previousConnectionId = get().activeConnectionId;
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

      // Reset only after the backend connection is ready so a failed switch
      // does not wipe the currently usable workspace metadata.
      useSchemaStore.getState().reset();
      set({ activeConnectionId: config.id, isConnected: true });

      if (previousConnectionId && previousConnectionId !== config.id) {
        try {
          await connectionService.disconnect(previousConnectionId);
        } catch (disconnectError) {
          console.warn(
            "Failed to disconnect previous backend connection:",
            disconnectError
          );
        }
      }

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
    const { activeConnectionId, isConnected, connections } = get();
    if (activeConnectionId === id && isConnected) {
      return null;
    }

    const connection = connections.find((conn) => conn.id === id);
    if (!connection) {
      const message = `Connection not found: ${id}`;
      console.warn(message);
      return message;
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

    useSchemaStore.getState().reset();
    set({ activeConnectionId: null, isConnected: false });
  },
}));
