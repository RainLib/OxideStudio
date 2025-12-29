import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { connectionService, SavedConnection } from "@/services/tauri";

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
    await connectionService.saveConnections(updatedConnections);
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
      // Use the provided connection URL directly, but strip jdbc: if present
      url = config.connectionUrl.trim();
      if (url.toLowerCase().startsWith("jdbc:")) {
        url = url.substring(5);
      }

      // Robust mapping for MySQL SSL parameters
      if (config.driver === "mysql") {
        // Map sslMode=... to ssl-mode=... and use lowercase for the value
        const sslModeMatch = url.match(/[?&]sslMode=([^&]+)/i);
        if (sslModeMatch && sslModeMatch[1]) {
          const originalParam = sslModeMatch[0].substring(1); // e.g. "sslMode=VERIFY_IDENTITY"
          const value = sslModeMatch[1].toLowerCase();
          url = url.replace(originalParam, `ssl-mode=${value}`);
        }
      }
    } else {
      // Construct URL with encoded components to handle special characters
      const user = encodeURIComponent(config.user || "");
      const password = encodeURIComponent(config.password || "");
      const host = config.host || "localhost";
      const port = config.port || (config.driver === "postgres" ? 5432 : 3306);
      const db = encodeURIComponent(config.database || "");

      const sslParamName =
        config.driver === "postgres" ? "sslmode" : "ssl-mode";
      const sslMode = (config.sslMode || "disable").toLowerCase();
      const sslValue = sslMode;

      url =
        config.driver === "postgres"
          ? `postgres://${user}:${password}@${host}:${port}/${db}`
          : `mysql://${user}:${password}@${host}:${port}/${db}`;

      // Add SSL mode if specified
      if (sslMode !== "disable") {
        url += `?${sslParamName}=${sslValue}`;
      }
    }

    try {
      await connectionService.connect(config.id, config.driver, url);
      set({ activeConnectionId: config.id, isConnected: true });
      return null; // No error
    } catch (e: any) {
      const message = e.message || String(e);
      return message;
    }
  },

  setActiveConnection: (id: string) => {
    set({ activeConnectionId: id, isConnected: true });
  },

  disconnect: () => {
    set({ activeConnectionId: null, isConnected: false });
  },
}));
