import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { connectionService, SavedConnection } from "@/services/tauri";
import { rocketMqService } from "@/services/tauri/mq.service";
import { validateRocketMqConnection } from "@/features/mq/model/rocketmq";
import { useSchemaStore } from "./useSchemaStore";
import {
  applyInfluxDbConnectionOptions,
  applyVictoriaMetricsConnectionOptions,
  applyElasticsearchConnectionOptions,
  buildConnectionUrl,
  normalizeConnectionUrlForDriver,
  victoriaMetricsConnectionOptionsFromUrl,
} from "@/lib/connectionUrlParser";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultConnectionIcon,
  defaultDatabaseName,
  defaultDatabasePort,
} from "@/lib/databaseDialect";
import { withTimeout } from "@/lib/withTimeout";
import {
  readConnectionDisplayCache,
  writeConnectionDisplayCache,
  type ConnectionDisplaySummary,
} from "@/startup/dataSourceDisplayCache";
import type { ManagedDataSourceDescriptor } from "@/services/tauri/enterprise.service";
import { enterpriseService } from "@/services/tauri/enterprise.service";
import { useSettingsStore } from "./useSettingsStore";

const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";
const DEFAULT_PROJECT_ID = "sqls";
export const CONNECTION_LOAD_TIMEOUT_MS = 15_000;

export interface ConnectionConfig extends SavedConnection {
  origin?: "local" | "managed";
  managedDescriptor?: ManagedDataSourceDescriptor;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  tags?: string[];
}

export function isManagedConnection(
  config: ConnectionConfig,
): config is ConnectionConfig & {
  origin: "managed";
  managedDescriptor: ManagedDataSourceDescriptor;
} {
  return config.origin === "managed" && Boolean(config.managedDescriptor);
}

export type { ConnectionDisplaySummary } from "@/startup/dataSourceDisplayCache";

export type ConnectionRuntimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export interface ConnectionRuntimeState {
  status: ConnectionRuntimeStatus;
  message?: string;
  updatedAt: number;
}

interface ConnectionState {
  connections: ConnectionConfig[];
  connectionDisplayCache: ConnectionDisplaySummary[];
  hasConnectionDisplayCache: boolean;
  activeConnectionId: string | null;
  connectedConnectionIds: string[];
  connectionRuntimeStates: Record<string, ConnectionRuntimeState>;
  isConnected: boolean;
  isLoading: boolean;
  loadError: string | null;
  selectedConnection: ConnectionConfig | null;

  // Actions
  loadConnections: () => Promise<void>;
  selectConnection: (id: string | null) => void;
  createNewConnection: () => ConnectionConfig;
  updateConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  saveConnection: (config: ConnectionConfig) => Promise<void>;
  /** Persist imported local data sources as one replacement write. */
  importConnections: (configs: ConnectionConfig[]) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  addConnection: (config: Omit<ConnectionConfig, "id">) => Promise<void>;
  testConnection: (config: ConnectionConfig) => Promise<string | null>;
  connect: (config: ConnectionConfig) => Promise<string | null>;
  setActiveConnection: (id: string) => Promise<string | null>;
  disconnect: () => Promise<void>;
}

function connectionUrlForConfig(config: ConnectionConfig) {
  const connectionUrl = config.connectionUrl && config.connectionUrl.trim()
    ? normalizeConnectionUrlForDriver(config.driver, config.connectionUrl, {
      // A connection pinned to an external package may use JDBC's nested
      // scheme (`jdbc:oracle:...`). Preserve it instead of rewriting it for
      // a bundled driver that happens to share the product name.
      preserveJdbcPrefix: Boolean(config.driverPackageVersion),
    })
    : buildConnectionUrl({
      driver: config.driver,
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      sslMode: config.sslMode || "disable",
    });

  if (config.driver === "elasticsearch") {
    return applyElasticsearchConnectionOptions(connectionUrl, {
        mode: config.elasticsearchMode,
        kibanaBasePath: config.elasticsearchKibanaBasePath,
        connectivityCheckPath: config.elasticsearchConnectivityCheckPath,
        connectivityCheckDisabled:
          config.elasticsearchConnectivityCheckDisabled,
        indexGroupingPattern: config.indexGroupingPattern,
      });
  }
  return config.driver === "influxdb"
    ? applyInfluxDbConnectionOptions(connectionUrl, {
        version: config.influxDbVersion,
        organization: config.influxDbOrganization,
      })
    : config.driver === "victoriametrics"
      ? applyVictoriaMetricsConnectionOptions(connectionUrl, {
          // Legacy/pasted URLs can carry a tenant-specific API mount before
          // the explicit form fields exist. Preserve it rather than silently
          // rewriting the endpoint to the default Prometheus mount.
          ...victoriaMetricsConnectionOptionsFromUrl(connectionUrl),
          ...(config.victoriaMetricsApiPath
            ? { apiPath: config.victoriaMetricsApiPath }
            : {}),
          ...(config.victoriaMetricsLookback
            ? { lookback: config.victoriaMetricsLookback }
            : {}),
        })
      : connectionUrl;
}

function isRocketMqConnection(config: ConnectionConfig) {
  return config.driver.trim().toLowerCase() === "rocketmq";
}

function rocketMqConfigFor(config: ConnectionConfig) {
  if (!config.rocketMq) throw new Error("RocketMQ NameServer configuration is required.");
  return validateRocketMqConnection(config.rocketMq);
}

function enabledSshTunnel(config: ConnectionConfig) {
  return config.sshTunnel?.enabled ? config.sshTunnel : undefined;
}

export function usesRemoteSqliteWorker(config: ConnectionConfig) {
  return (
    config.driver.trim().toLowerCase() === "sqlite" &&
    config.sshTunnel?.enabled === true &&
    Boolean(config.sshTunnel.remoteSqlite)
  );
}

async function prepareRemoteSqliteWorker(config: ConnectionConfig) {
  if (!usesRemoteSqliteWorker(config) || !config.sshTunnel) return;
  const downloadBaseUrl =
    useSettingsStore.getState().settings.drivers.sqliteWorkerBaseUrl;
  const key = [
    config.sshTunnel.username.trim(),
    config.sshTunnel.host.trim().toLowerCase(),
    config.sshTunnel.port,
    ...(config.sshTunnel.jumpHosts || []).map((hop) =>
      [
        hop.username.trim(),
        hop.host.trim().toLowerCase(),
        hop.port,
        hop.authMethod,
      ].join("@"),
    ),
    downloadBaseUrl,
  ].join("|");
  const cached = remoteSqlitePreparationCache.get(key);
  if (cached && cached > Date.now()) return;
  const pending = remoteSqlitePreparationFlights.get(key);
  if (pending) return pending;
  const preparation = connectionService
    .prepareRemoteSqliteWorker(config.sshTunnel, downloadBaseUrl)
    .then(() => {
      // The desktop process pins one worker package version. A short cache
      // avoids a second SSH platform probe when Test is immediately followed
      // by Connect, while still revalidating a changed host during long runs.
      remoteSqlitePreparationCache.set(key, Date.now() + 5 * 60_000);
    })
    .finally(() => {
      remoteSqlitePreparationFlights.delete(key);
    });
  remoteSqlitePreparationFlights.set(key, preparation);
  return preparation;
}

const remoteSqlitePreparationCache = new Map<string, number>();
const remoteSqlitePreparationFlights = new Map<string, Promise<void>>();

let latestConnectAttempt = 0;

interface PendingConnect {
  attemptId: number;
  promise: Promise<string | null>;
}

const pendingConnects = new Map<string, PendingConnect>();
let pendingConnectionLoad: {
  projectId: string;
  promise: Promise<void>;
} | null = null;

function beginConnectionRuntime(
  states: Record<string, ConnectionRuntimeState>,
  connectionId: string,
) {
  return Object.fromEntries(
    Object.entries(states).map(([id, state]) => [
      id,
      id !== connectionId && state.status === "connecting"
        ? { status: "idle" as const, updatedAt: Date.now() }
        : state,
    ]),
  ) as Record<string, ConnectionRuntimeState>;
}

function activeProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

function scopeConnectionToActiveProject<T extends ConnectionConfig>(
  config: T,
): T {
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
  const connections = (await connectionService.loadConnections(projectId)).map(
    (connection) => ({
      ...connection,
      projectId: connection.projectId || projectId,
    }),
  );
  writeConnectionDisplayCache(projectId, connections);
  return connections;
}

const initialConnectionDisplayCache =
  readConnectionDisplayCache(activeProjectId());

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  connectionDisplayCache: initialConnectionDisplayCache ?? [],
  hasConnectionDisplayCache: initialConnectionDisplayCache !== null,
  activeConnectionId: null,
  connectedConnectionIds: [],
  connectionRuntimeStates: {},
  isConnected: false,
  isLoading: true,
  loadError: null,
  selectedConnection: null,

  loadConnections: async () => {
    const projectId = activeProjectId();
    if (pendingConnectionLoad?.projectId === projectId) {
      return pendingConnectionLoad.promise;
    }

    let promise!: Promise<void>;
    promise = (async () => {
      set({ isLoading: true, loadError: null });
      try {
        const connections = await withTimeout(
          readProjectConnections(projectId),
          CONNECTION_LOAD_TIMEOUT_MS,
          "Loading saved data sources",
        );
        if (activeProjectId() !== projectId) return;

        const activeConnectionId = get().activeConnectionId;
        const activeConnectionExists = connections.some(
          (connection) => connection.id === activeConnectionId,
        );
        const connectedConnectionIds = get().connectedConnectionIds.filter(
          (id) => connections.some((connection) => connection.id === id),
        );
        const connectionRuntimeStates = Object.fromEntries(
          Object.entries(get().connectionRuntimeStates).filter(([id]) =>
            connections.some((connection) => connection.id === id),
          ),
        );

        set({
          connections,
          connectionDisplayCache: writeConnectionDisplayCache(
            projectId,
            connections,
          ),
          hasConnectionDisplayCache: true,
          activeConnectionId: activeConnectionExists
            ? activeConnectionId
            : null,
          connectedConnectionIds,
          connectionRuntimeStates,
          isConnected: Boolean(
            activeConnectionExists &&
            activeConnectionId &&
            connectedConnectionIds.includes(activeConnectionId),
          ),
          selectedConnection: null,
          loadError: null,
        });
      } catch (e) {
        console.error("Failed to load connections:", e);
        if (activeProjectId() === projectId) {
          set({ loadError: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        if (pendingConnectionLoad?.promise === promise) {
          pendingConnectionLoad = null;
          set({ isLoading: false });
        }
      }
    })();

    pendingConnectionLoad = { projectId, promise };
    return promise;
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
          sshTunnel: conn.sshTunnel
            ? {
                ...conn.sshTunnel,
                jumpHosts: conn.sshTunnel.jumpHosts?.map((hop) => ({ ...hop })),
              }
            : undefined,
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
      note: "",
      environment: "unclassified",
      productionDatabases: [],
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
        jumpHosts: [],
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
    await connectionService.saveConnections(updatedConnections, activeProjectId());
    set({
      connections: updatedConnections,
      connectionDisplayCache: writeConnectionDisplayCache(
        activeProjectId(),
        updatedConnections,
      ),
      hasConnectionDisplayCache: true,
      selectedConnection: imported[imported.length - 1] || state.selectedConnection,
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
          await connectionService.disconnect(id);
        } catch (error) {
          console.warn("Failed to disconnect removed data source:", error);
        }
      }

      if (state.activeConnectionId === id) {
        const schemaStore = useSchemaStore.getState();
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

  // Deprecated simplified add
  addConnection: async (config) => {
    const newConn = scopeConnectionToActiveProject({ ...config, id: uuidv4() });
    await get().saveConnection(newConn);
  },

  testConnection: async (config) => {
    if (isManagedConnection(config)) {
      return "Managed data sources are tested by the enterprise Gateway.";
    }
    try {
      if (isRocketMqConnection(config)) {
        await rocketMqService.testConnection(rocketMqConfigFor(config));
        return null;
      }
      const connectionUrl = connectionUrlForConfig(config);
      const sshTunnel = enabledSshTunnel(config);
      if (usesRemoteSqliteWorker(config)) {
        await prepareRemoteSqliteWorker(config);
      }
      if (config.driverPackageVersion) {
        await connectionService.testConnection(
          config.driver,
          connectionUrl,
          sshTunnel,
          config.driverPackageVersion,
        );
      } else {
        await connectionService.testConnection(
          config.driver,
          connectionUrl,
          sshTunnel,
        );
      }
      return null;
    } catch (e: any) {
      return e.message || String(e);
    }
  },

  connect: (config) => {
    if (isManagedConnection(config)) {
      const projectId = connectionProjectId(config);
      const descriptor = config.managedDescriptor;
      const scopeKey = connectionScopeKey(config);
      const pending = pendingConnects.get(scopeKey);
      if (pending) {
        if (pending.attemptId !== latestConnectAttempt) {
          latestConnectAttempt += 1;
          pending.attemptId = latestConnectAttempt;
        }
        set((state) => ({
          connectionRuntimeStates: {
            ...beginConnectionRuntime(
              state.connectionRuntimeStates,
              config.id,
            ),
            [config.id]: { status: "connecting", updatedAt: Date.now() },
          },
        }));
        return pending.promise;
      }
      latestConnectAttempt += 1;
      set((state) => ({
        connectionRuntimeStates: {
          ...beginConnectionRuntime(state.connectionRuntimeStates, config.id),
          [config.id]: { status: "connecting", updatedAt: Date.now() },
        },
      }));
      const flight: PendingConnect = {
        attemptId: latestConnectAttempt,
        promise: Promise.resolve(null),
      };
      flight.promise = (async () => {
        try {
          await enterpriseService.connectManagedSource(config.id, descriptor);
          if (
            flight.attemptId !== latestConnectAttempt ||
            activeProjectId() !== projectId
          ) {
            if (get().activeConnectionId !== config.id) {
              await connectionService.disconnect(config.id).catch(() => {
                // A superseded managed session may already have been replaced.
              });
            }
            return null;
          }
          const schemaStore = useSchemaStore.getState();
          if (get().activeConnectionId !== config.id) {
            schemaStore.snapshotActiveMetadata();
          }
          if (!schemaStore.restoreConnectionSnapshot(config.id)) {
            schemaStore.clearActiveMetadata();
          }
          set({
            activeConnectionId: config.id,
            connectedConnectionIds: Array.from(
              new Set([...get().connectedConnectionIds, config.id]),
            ),
            isConnected: true,
            connectionRuntimeStates: {
              ...get().connectionRuntimeStates,
              [config.id]: { status: "connected", updatedAt: Date.now() },
            },
          });
          return null;
        } catch (error) {
          if (
            flight.attemptId !== latestConnectAttempt ||
            activeProjectId() !== projectId
          ) {
            return null;
          }
          const message =
            error instanceof Error ? error.message : String(error);
          set((state) => ({
            connectionRuntimeStates: {
              ...state.connectionRuntimeStates,
              [config.id]: {
                status: "error",
                message,
                updatedAt: Date.now(),
              },
            },
          }));
          return message;
        } finally {
          if (pendingConnects.get(scopeKey) === flight) {
            pendingConnects.delete(scopeKey);
          }
        }
      })();
      pendingConnects.set(scopeKey, flight);
      return flight.promise;
    }
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
      set((state) => ({
        connectionRuntimeStates: {
          ...beginConnectionRuntime(
            state.connectionRuntimeStates,
            scopedConfig.id,
          ),
          [scopedConfig.id]: { status: "connecting", updatedAt: Date.now() },
        },
      }));
      return pending.promise;
    }

    latestConnectAttempt += 1;
    set((state) => ({
      connectionRuntimeStates: {
        ...beginConnectionRuntime(
          state.connectionRuntimeStates,
          scopedConfig.id,
        ),
        [scopedConfig.id]: { status: "connecting", updatedAt: Date.now() },
      },
    }));
    const flight: PendingConnect = {
      attemptId: latestConnectAttempt,
      promise: Promise.resolve(null),
    };

    flight.promise = (async () => {
      try {
        if (isRocketMqConnection(scopedConfig)) {
          await rocketMqService.connect(scopedConfig.id, rocketMqConfigFor(scopedConfig));
        } else {
        const connectionUrl = connectionUrlForConfig(scopedConfig);
        const sshTunnel = enabledSshTunnel(scopedConfig);
        if (usesRemoteSqliteWorker(scopedConfig)) {
          await prepareRemoteSqliteWorker(scopedConfig);
        }
        if (scopedConfig.driverPackageVersion) {
          await connectionService.connect(
            scopedConfig.id,
            scopedConfig.driver,
            connectionUrl,
            sshTunnel,
            scopedConfig.driverPackageVersion,
          );
        } else {
          await connectionService.connect(
            scopedConfig.id,
            scopedConfig.driver,
            connectionUrl,
            sshTunnel,
          );
        }
        }

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
                disconnectError,
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
            new Set([...get().connectedConnectionIds, scopedConfig.id]),
          ),
          isConnected: true,
          connectionRuntimeStates: {
            ...get().connectionRuntimeStates,
            [scopedConfig.id]: {
              status: "connected",
              updatedAt: Date.now(),
            },
          },
        });

        return null;
      } catch (e: any) {
        if (
          flight.attemptId !== latestConnectAttempt ||
          activeProjectId() !== projectId
        ) {
          return null;
        }
        const message = e.message || String(e);
        set((state) => ({
          connectionRuntimeStates: {
            ...state.connectionRuntimeStates,
            [scopedConfig.id]: {
              status: "error",
              message,
              updatedAt: Date.now(),
            },
          },
        }));
        return message;
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
    if (
      activeConnectionId === id &&
      isConnected &&
      connectedConnectionIds.includes(id)
    ) {
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
      set((state) => ({
        activeConnectionId: id,
        isConnected: true,
        connectionRuntimeStates: {
          ...state.connectionRuntimeStates,
          [id]: { status: "connected", updatedAt: Date.now() },
        },
      }));
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
        const connection = get().connections.find((item) => item.id === connectionId);
        if (connection && isRocketMqConnection(connection)) {
          await rocketMqService.disconnect(connectionId);
        } else {
          await connectionService.disconnect(connectionId);
        }
      } catch (e) {
        console.warn("Failed to disconnect backend connection:", e);
      }
    }

    const connectedConnectionIds = get().connectedConnectionIds.filter(
      (id) => id !== connectionId,
    );

    const schemaStore = useSchemaStore.getState();
    schemaStore.snapshotActiveMetadata();
    if (connectedConnectionIds[0]) {
      schemaStore.restoreConnectionSnapshot(connectedConnectionIds[0]);
    } else {
      schemaStore.clearActiveMetadata();
    }
    set((state) => ({
      activeConnectionId: connectedConnectionIds[0] ?? null,
      connectedConnectionIds,
      isConnected: connectedConnectionIds.length > 0,
      connectionRuntimeStates: connectionId
        ? {
            ...state.connectionRuntimeStates,
            [connectionId]: { status: "idle", updatedAt: Date.now() },
          }
        : state.connectionRuntimeStates,
    }));
  },
}));

export type ConnectionReadiness =
  | { status: "ready"; connection: ConnectionConfig }
  | { status: "cancelled" }
  | { status: "error"; message: string };

const pendingBackgroundConnections = new Map<
  string,
  Promise<ConnectionReadiness>
>();

/**
 * Rebuild a backend session for background work without changing the selected
 * data source or active schema. Scheduled backup must never steal editor
 * focus merely because its timer fired.
 */
export async function ensureConnectionReadyInBackground(
  connectionId: string,
): Promise<ConnectionReadiness> {
  const initialState = useConnectionStore.getState();
  const initialConnection = initialState.connections.find(
    (connection) => connection.id === connectionId,
  );
  if (!initialConnection) {
    return { status: "error", message: "The scheduled data source no longer exists." };
  }
  if (initialState.connectedConnectionIds.includes(connectionId)) {
    return { status: "ready", connection: initialConnection };
  }
  if (isManagedConnection(initialConnection)) {
    return {
      status: "error",
      message: "Managed data sources cannot run local SQLite backups.",
    };
  }

  const scopeKey = connectionScopeKey(initialConnection);
  const foreground = pendingConnects.get(scopeKey);
  if (foreground) {
    await foreground.promise;
    const nextState = useConnectionStore.getState();
    const nextConnection = nextState.connections.find(
      (connection) => connection.id === connectionId,
    );
    if (nextConnection && nextState.connectedConnectionIds.includes(connectionId)) {
      return { status: "ready", connection: nextConnection };
    }
  }

  const existing = pendingBackgroundConnections.get(scopeKey);
  if (existing) return existing;

  const task = (async (): Promise<ConnectionReadiness> => {
    try {
      const connectionUrl = connectionUrlForConfig(initialConnection);
      const sshTunnel = enabledSshTunnel(initialConnection);
      if (usesRemoteSqliteWorker(initialConnection)) {
        await prepareRemoteSqliteWorker(initialConnection);
      }
      await connectionService.connect(
        initialConnection.id,
        initialConnection.driver,
        connectionUrl,
        sshTunnel,
        initialConnection.driverPackageVersion,
      );
      const currentState = useConnectionStore.getState();
      const currentConnection = currentState.connections.find(
        (connection) => connection.id === connectionId,
      );
      if (
        !currentConnection ||
        connectionScopeKey(currentConnection) !== scopeKey
      ) {
        await connectionService.disconnect(connectionId).catch(() => undefined);
        return { status: "cancelled" };
      }
      useConnectionStore.setState((state) => ({
        connectedConnectionIds: Array.from(
          new Set([...state.connectedConnectionIds, connectionId]),
        ),
        isConnected: true,
        connectionRuntimeStates: {
          ...state.connectionRuntimeStates,
          [connectionId]: { status: "connected", updatedAt: Date.now() },
        },
      }));
      return { status: "ready", connection: currentConnection };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "error", message };
    } finally {
      pendingBackgroundConnections.delete(scopeKey);
    }
  })();
  pendingBackgroundConnections.set(scopeKey, task);
  return task;
}

/**
 * Ensures a cached data source has a live backend connection before a remote
 * operation starts. Project switches can replace the connection scope while
 * the network request is pending, so callers must treat that case as a quiet
 * cancellation instead of writing a stale error into the new workspace.
 */
export async function ensureConnectionReady(
  connectionId: string,
): Promise<ConnectionReadiness> {
  const initialState = useConnectionStore.getState();
  const initialConnection = initialState.connections.find(
    (connection) => connection.id === connectionId,
  );
  if (!initialConnection) {
    return {
      status: "error",
      message:
        "This table's data source is no longer available in the active project. Reopen it from Database Explorer.",
    };
  }

  const initialScopeKey = connectionScopeKey(initialConnection);
  if (initialState.connectedConnectionIds.includes(connectionId)) {
    return { status: "ready", connection: initialConnection };
  }

  const connectionError = await initialState.setActiveConnection(connectionId);
  const currentState = useConnectionStore.getState();
  const currentConnection = currentState.connections.find(
    (connection) => connection.id === connectionId,
  );

  if (
    !currentConnection ||
    connectionScopeKey(currentConnection) !== initialScopeKey
  ) {
    return { status: "cancelled" };
  }

  if (connectionError) {
    return {
      status: "error",
      message: `Could not connect to "${initialConnection.name}": ${connectionError}`,
    };
  }

  if (!currentState.connectedConnectionIds.includes(connectionId)) {
    return { status: "cancelled" };
  }

  return { status: "ready", connection: currentConnection };
}

/**
 * Rebuilds an in-memory backend session for a saved data source.
 *
 * The frontend connection list survives workspace hydration, while Rust
 * driver sessions intentionally do not. A query can therefore discover that
 * a previously connected session disappeared after a reload or project
 * switch. Calling connect directly is safe here because the backend replaces
 * the missing/stale driver atomically under the same saved connection ID.
 */
export async function restoreConnectionSession(
  connectionId: string,
): Promise<ConnectionReadiness> {
  const initialState = useConnectionStore.getState();
  const initialConnection = initialState.connections.find(
    (connection) => connection.id === connectionId,
  );
  if (!initialConnection) {
    return {
      status: "error",
      message:
        "This query's data source is no longer available in the active project. Choose another data source and try again.",
    };
  }

  const initialScopeKey = connectionScopeKey(initialConnection);
  const connectionError = await initialState.connect(initialConnection);
  const currentState = useConnectionStore.getState();
  const currentConnection = currentState.connections.find(
    (connection) => connection.id === connectionId,
  );

  if (
    !currentConnection ||
    connectionScopeKey(currentConnection) !== initialScopeKey
  ) {
    return { status: "cancelled" };
  }

  if (connectionError) {
    return {
      status: "error",
      message: `Could not restore “${initialConnection.name}”: ${connectionError}`,
    };
  }

  if (!currentState.connectedConnectionIds.includes(connectionId)) {
    return { status: "cancelled" };
  }

  return { status: "ready", connection: currentConnection };
}
