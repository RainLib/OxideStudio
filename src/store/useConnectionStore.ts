import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { api, SavedConnection } from "@/lib/api";

export interface ConnectionConfig extends SavedConnection {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

interface ConnectionState {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  isConnected: boolean;
  isLoading: boolean;

  // Actions
  loadConnections: () => Promise<void>;
  addConnection: (config: Omit<ConnectionConfig, "id">) => Promise<void>;
  connect: (config: ConnectionConfig) => Promise<string | null>;
  disconnect: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  isConnected: false,
  isLoading: true,

  loadConnections: async () => {
    const res = await api.loadConnections();
    if (res.success && res.data) {
      set({ connections: res.data, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  addConnection: async (config) => {
    const newConn: ConnectionConfig = { ...config, id: uuidv4() };
    const updatedConnections = [...get().connections, newConn];

    // Optimistic update
    set({ connections: updatedConnections });

    // Save to backend
    await api.saveConnections(updatedConnections.map(c => ({
        id: c.id,
        name: c.name,
        driver: c.driver,
        url: c.url
    })));
  },

  connect: async (config) => {
    // If config has explicit fields (host, port etc), reconstruct URL if needed or just use existing URL
    // For now we assume config.url is populated correctly before calling this or we construct it here if needed.
    // simpler to rely on URL for the driver.

    try {
      const res = await api.connect(config.id, config.driver, config.url);

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

  disconnect: () => {
    set({ activeConnectionId: null, isConnected: false });
  },
}));
