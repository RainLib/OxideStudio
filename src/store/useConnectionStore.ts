import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { api, SavedConnection } from "@/lib/api";

export interface ConnectionConfig extends SavedConnection {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionUrl?: string;
  sslMode?: string;
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
  connect: (config: ConnectionConfig) => Promise<string | null>;
  setActiveConnection: (id: string) => void;
  disconnect: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  isConnected: false,
  isLoading: true,
  selectedConnection: null,

  loadConnections: async () => {
    const res = await api.loadConnections();
    if (res.success && res.data) {
      // If we have connections, select the first one or none? Beekeeper usually selects new.
      set({ connections: res.data, isLoading: false });
    } else {
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
    const newConn = {
      id: uuidv4(),
      name: "New Connection",
      driver: "postgres",
      url: "",
      host: "localhost",
      port: 5432,
      user: "",
      password: "",
      database: "postgres",
    } as const; // literal types help inference if needed, but not strictly necessary here

    set({
      selectedConnection: { ...newConn, driver: "postgres" }, // Ensure type compatibility
    });
    return { ...newConn, driver: "postgres" as const };
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
    await api.saveConnections(updatedConnections);
  },

  // Deprecated simplified add
  addConnection: async (config) => {
    const newConn = { ...config, id: uuidv4() };
    await get().saveConnection(newConn);
  },

  connect: async (config) => {
    // Use connectionUrl if provided, otherwise build from individual fields
    let url: string;

    if (config.connectionUrl && config.connectionUrl.trim()) {
      // Use the provided connection URL directly
      url = config.connectionUrl.trim();
    } else {
      // Construct URL with encoded components to handle special characters
      const user = encodeURIComponent(config.user || "");
      const password = encodeURIComponent(config.password || "");
      const host = config.host || "localhost";
      const port = config.port || (config.driver === "postgres" ? 5432 : 3306);
      const db = encodeURIComponent(config.database || "");

      url =
        config.driver === "postgres"
          ? `postgres://${user}:${password}@${host}:${port}/${db}`
          : `mysql://${user}:${password}@${host}:${port}/${db}`;

      // Add SSL mode if specified
      if (config.sslMode && config.sslMode !== "disable") {
        url += `?sslmode=${config.sslMode}`;
      }
    }

    try {
      const res = await api.connect(config.id, config.driver, url);

      if (res.success) {
        set({ activeConnectionId: config.id, isConnected: true });
        return null; // No error
      } else {
        return res.error?.message || "Unknown error";
      }
    } catch (e) {
      return String(e);
    }
  },

  setActiveConnection: (id: string) => {
    set({ activeConnectionId: id, isConnected: true });
  },

  disconnect: () => {
    set({ activeConnectionId: null, isConnected: false });
  },
}));
