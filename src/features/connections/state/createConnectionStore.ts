import { readConnectionDisplayCache } from "@/startup/dataSourceDisplayCache";
import { create } from "zustand";
import { activeProjectId } from "../model/connectionScope";
import type { ConnectionState } from "../model/types";
import type { ConnectionRuntime } from "../runtime/connectionRequests";
import { createCatalogSlice } from "./catalogSlice";
import { createPersistenceSlice } from "./persistenceSlice";
import { createSessionSlice } from "./sessionSlice";
import type { ConnectionPorts } from "./types";
export function createConnectionStore(
  ports: ConnectionPorts,
  runtime: ConnectionRuntime,
) {
  const initialConnectionDisplayCache =
    readConnectionDisplayCache(activeProjectId());
  return create<ConnectionState>((set, get) => ({
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
    ...createCatalogSlice(set, get, ports, runtime),
    ...createPersistenceSlice(set, get, ports, runtime),
    ...createSessionSlice(set, get, ports, runtime),
  }));
}
