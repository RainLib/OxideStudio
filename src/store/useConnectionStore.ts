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
  defaultConnectionIcon,
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

function enabledSshTunnel(config: ConnectionConfig) {
  return config.sshTunnel?.enabled ? config.sshTunnel : undefined;
}

let latestConnectAttempt = 0;

interface PendingConnect {
  attemptId: number;
  promise: Promise<string | null>;
}

const pendingConnects = new Map<string, PendingConnect>();

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

function connectionProjectId(config: ConnectionConfig) {
  return config.projectId || activeProjectId();
}

function connectionScopeKey(config: ConnectionConfig) {
  return JSON.stringify([connectionProjectId(config), config.id]);
}

export async function readProjectConnections(projectId: string) {
  return (await connectionService.loadConnections(projectId)).map((connection) => ({
    ...connection,
    projectId: connection.projectId || projectId,
  }));
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
      const connections = await readProjectConnections(projectId);
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
      set({
        selectedConnection: {
          ...conn,
          icon: conn.icon || defaultConnectionIcon(conn.driver),
          sshTunnel: conn.sshTunnel ? { ...conn.sshTunnel } : undefined,
        },
      }); // Clone nested editable configuration to avoid direct mutation
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
      icon: defaultConnectionIcon(DEFAULT_DATABASE_DRIVER),
      tags: [],
      sshTunnel: {
        enabled: false,
        host: "",
        port: 22,
        username: "",
        authMethod: "password",
        password: "",
        privateKeyPath: "",
        privateKeyPassphrase: "",
        strictHostKeyChecking: true,
      },
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
        connectionUrlForConfig(config),
        enabledSshTunnel(config)
      );
      return null;
    } catch (e: any) {
      return e.message || String(e);
    }
  },

  connect: (config) => {
    const projectId = connectionProjectId(config);
    const scopedConfig = { ...config, projectId };
    const scopeKey = connectionScopeKey(scopedConfig);
    const pending = pendingConnects.get(scopeKey);
    if (pending) {
      // A user can switch A -> B -> A while A is still connecting. Reusing
      // A's backend request keeps the operation single-flight, while
      // promoting it preserves the latest-selection-wins behavior.
      if (pending.attemptId !== latestConnectAttempt) {
        latestConnectAttempt += 1;
        pending.attemptId = latestConnectAttempt;
      }
      return pending.promise;
    }

    latestConnectAttempt += 1;
    const flight: PendingConnect = {
      attemptId: latestConnectAttempt,
      promise: Promise.resolve(null),
    };

    flight.promise = (async () => {
      try {
        await connectionService.connect(
          scopedConfig.id,
          scopedConfig.driver,
          connectionUrlForConfig(scopedConfig),
          enabledSshTunnel(scopedConfig)
        );

        if (
          flight.attemptId !== latestConnectAttempt ||
          activeProjectId() !== projectId
        ) {
          if (get().activeConnectionId !== scopedConfig.id) {
            try {
              await connectionService.disconnect(scopedConfig.id);
            } catch (disconnectError) {
              console.warn(
                "Failed to disconnect superseded backend connection:",
                disconnectError
              );
            }
          }
          return null;
        }

        const schemaStore = useSchemaStore.getState();
        if (get().activeConnectionId !== scopedConfig.id) {
          schemaStore.snapshotActiveMetadata();
        }
        if (!schemaStore.restoreConnectionSnapshot(scopedConfig.id)) {
          schemaStore.clearActiveMetadata();
        }
        set({
          activeConnectionId: scopedConfig.id,
          connectedConnectionIds: Array.from(
            new Set([...get().connectedConnectionIds, scopedConfig.id])
          ),
          isConnected: true,
        });

        return null;
      } catch (e: any) {
        if (
          flight.attemptId !== latestConnectAttempt ||
          activeProjectId() !== projectId
        ) {
          return null;
        }
        return e.message || String(e);
      } finally {
        if (pendingConnects.get(scopeKey) === flight) {
          pendingConnects.delete(scopeKey);
        }
      }
    })();

    pendingConnects.set(scopeKey, flight);
    return flight.promise;
  },

  setActiveConnection: (id: string) => {
    const {
      activeConnectionId,
      connectedConnectionIds,
      isConnected,
      connections,
    } = get();
    if (activeConnectionId === id && isConnected) {
      return Promise.resolve(null);
    }

    const connection = connections.find((conn) => conn.id === id);
    if (!connection) {
      const message = `Connection not found: ${id}`;
      console.warn(message);
      return Promise.resolve(message);
    }

    if (
      activeConnectionId === id &&
      pendingConnects.has(connectionScopeKey(connection))
    ) {
      return get().connect(connection);
    }

    if (connectedConnectionIds.includes(id)) {
      const schemaStore = useSchemaStore.getState();
      schemaStore.snapshotActiveMetadata();
      schemaStore.restoreConnectionSnapshot(id);
      set({ activeConnectionId: id, isConnected: true });
      return Promise.resolve(null);
    }

    // Select the source and restore its local SQLite-backed snapshot before
    // awaiting the network connection. Query execution remains disabled until
    // connect() marks this source as connected.
    const schemaStore = useSchemaStore.getState();
    schemaStore.snapshotActiveMetadata();
    if (!schemaStore.restoreConnectionSnapshot(id)) {
      schemaStore.clearActiveMetadata();
    }
    set({ activeConnectionId: id, isConnected: false });

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
