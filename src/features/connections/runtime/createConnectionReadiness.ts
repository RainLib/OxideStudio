import {
  connectionUrlForConfig,
  enabledSshTunnel,
  isManagedConnection,
} from "@/features/connections/model/connectionConfig";
import { connectionScopeKey } from "@/features/connections/model/connectionScope";
import { type ConnectionReadiness } from "@/features/connections/model/types";
import {
  prepareRemoteSqliteWorker,
  usesRemoteSqliteWorker,
} from "@/features/connections/runtime/remoteSqliteWorker";
import { connectionService } from "@/services/tauri";
import type { StoreApi } from "zustand";
import type { ConnectionState } from "../model/types";
import type { ConnectionRuntime } from "./connectionRequests";
export function createConnectionReadiness(
  useConnectionStore: StoreApi<ConnectionState>,
  runtime: ConnectionRuntime,
) {
  const pendingBackgroundConnections = new Map<
    string,
    Promise<ConnectionReadiness>
  >();

  /**
   * Rebuild a backend session for background work without changing the selected
   * data source or active schema. Scheduled backup must never steal editor
   * focus merely because its timer fired.
   */
  async function ensureConnectionReadyInBackground(
    connectionId: string,
  ): Promise<ConnectionReadiness> {
    const initialState = useConnectionStore.getState();
    const initialConnection = initialState.connections.find(
      (connection) => connection.id === connectionId,
    );
    if (!initialConnection) {
      return {
        status: "error",
        message: "The scheduled data source no longer exists.",
      };
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
    const foreground = runtime.pendingConnects.get(scopeKey);
    if (foreground) {
      await foreground.promise;
      const nextState = useConnectionStore.getState();
      const nextConnection = nextState.connections.find(
        (connection) => connection.id === connectionId,
      );
      if (
        nextConnection &&
        nextState.connectedConnectionIds.includes(connectionId)
      ) {
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
          await connectionService
            .disconnect(connectionId)
            .catch(() => undefined);
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
  async function ensureConnectionReady(
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

    const connectionError =
      await initialState.setActiveConnection(connectionId);
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
  async function restoreConnectionSession(
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
  return {
    ensureConnectionReadyInBackground,
    ensureConnectionReady,
    restoreConnectionSession,
  };
}
