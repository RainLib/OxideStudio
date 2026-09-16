import {
  beginConnectionRuntime,
  connectionUrlForConfig,
  enabledSshTunnel,
  isManagedConnection,
  isRocketMqConnection,
  rocketMqConfigFor,
} from "@/features/connections/model/connectionConfig";
import {
  activeProjectId,
  connectionProjectId,
  connectionScopeKey,
} from "@/features/connections/model/connectionScope";
import { type PendingConnect } from "@/features/connections/model/types";
import {
  prepareRemoteSqliteWorker,
  usesRemoteSqliteWorker,
} from "@/features/connections/runtime/remoteSqliteWorker";
import { connectionService } from "@/services/tauri";
import { enterpriseService } from "@/services/tauri/enterprise.service";
import { rocketMqService } from "@/services/tauri/mq.service";
import type { ConnectionSlice } from "./types";
export const createSessionSlice: ConnectionSlice<
  "testConnection" | "connect" | "setActiveConnection" | "disconnect"
> = (set, get, ports, runtime) => ({
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
      const pending = runtime.pendingConnects.get(scopeKey);
      if (pending) {
        if (pending.attemptId !== runtime.latestConnectAttempt) {
          runtime.latestConnectAttempt += 1;
          pending.attemptId = runtime.latestConnectAttempt;
        }
        set((state) => ({
          connectionRuntimeStates: {
            ...beginConnectionRuntime(state.connectionRuntimeStates, config.id),
            [config.id]: { status: "connecting", updatedAt: Date.now() },
          },
        }));
        return pending.promise;
      }
      runtime.latestConnectAttempt += 1;
      set((state) => ({
        connectionRuntimeStates: {
          ...beginConnectionRuntime(state.connectionRuntimeStates, config.id),
          [config.id]: { status: "connecting", updatedAt: Date.now() },
        },
      }));
      const flight: PendingConnect = {
        attemptId: runtime.latestConnectAttempt,
        promise: Promise.resolve(null),
      };
      flight.promise = (async () => {
        try {
          await enterpriseService.connectManagedSource(config.id, descriptor);
          if (
            flight.attemptId !== runtime.latestConnectAttempt ||
            activeProjectId() !== projectId
          ) {
            if (get().activeConnectionId !== config.id) {
              await connectionService.disconnect(config.id).catch(() => {
                // A superseded managed session may already have been replaced.
              });
            }
            return null;
          }
          const schemaStore = ports.getSchemaState();
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
            flight.attemptId !== runtime.latestConnectAttempt ||
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
          if (runtime.pendingConnects.get(scopeKey) === flight) {
            runtime.pendingConnects.delete(scopeKey);
          }
        }
      })();
      runtime.pendingConnects.set(scopeKey, flight);
      return flight.promise;
    }
    const projectId = connectionProjectId(config);
    const scopedConfig = { ...config, projectId };
    const scopeKey = connectionScopeKey(scopedConfig);
    const pending = runtime.pendingConnects.get(scopeKey);
    if (pending) {
      // A user can switch A -> B -> A while A is still connecting. Reusing
      // A's backend request keeps the operation single-flight, while
      // promoting it preserves the latest-selection-wins behavior.
      if (pending.attemptId !== runtime.latestConnectAttempt) {
        runtime.latestConnectAttempt += 1;
        pending.attemptId = runtime.latestConnectAttempt;
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

    runtime.latestConnectAttempt += 1;
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
      attemptId: runtime.latestConnectAttempt,
      promise: Promise.resolve(null),
    };

    flight.promise = (async () => {
      try {
        if (isRocketMqConnection(scopedConfig)) {
          await rocketMqService.connect(
            scopedConfig.id,
            rocketMqConfigFor(scopedConfig),
          );
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
          flight.attemptId !== runtime.latestConnectAttempt ||
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

        const schemaStore = ports.getSchemaState();
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
          flight.attemptId !== runtime.latestConnectAttempt ||
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
        if (runtime.pendingConnects.get(scopeKey) === flight) {
          runtime.pendingConnects.delete(scopeKey);
        }
      }
    })();

    runtime.pendingConnects.set(scopeKey, flight);
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
      runtime.pendingConnects.has(connectionScopeKey(connection))
    ) {
      return get().connect(connection);
    }

    if (connectedConnectionIds.includes(id)) {
      const schemaStore = ports.getSchemaState();
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
    const schemaStore = ports.getSchemaState();
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
        const connection = get().connections.find(
          (item) => item.id === connectionId,
        );
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

    const schemaStore = ports.getSchemaState();
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
});
