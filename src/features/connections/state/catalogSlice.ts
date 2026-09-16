import {
  activeProjectId,
  CONNECTION_LOAD_TIMEOUT_MS,
  readProjectConnections,
} from "@/features/connections/model/connectionScope";
import { type ConnectionConfig } from "@/features/connections/model/types";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultConnectionIcon,
  defaultDatabaseName,
  defaultDatabasePort,
} from "@/lib/databaseDialect";
import { withTimeout } from "@/lib/withTimeout";
import { writeConnectionDisplayCache } from "@/startup/dataSourceDisplayCache";
import { v4 as uuidv4 } from "uuid";
import type { ConnectionSlice } from "./types";
export const createCatalogSlice: ConnectionSlice<
  | "loadConnections"
  | "selectConnection"
  | "createNewConnection"
  | "updateConnectionConfig"
> = (set, get, _ports, runtime) => ({
  loadConnections: async () => {
    const projectId = activeProjectId();
    if (runtime.pendingConnectionLoad?.projectId === projectId) {
      return runtime.pendingConnectionLoad.promise;
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
        if (runtime.pendingConnectionLoad?.promise === promise) {
          runtime.pendingConnectionLoad = null;
          set({ isLoading: false });
        }
      }
    })();

    runtime.pendingConnectionLoad = { projectId, promise };
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
});
