import { SavedConnection } from "@/services/tauri";
import type { ManagedDataSourceDescriptor } from "@/services/tauri/enterprise.service";
import { type ConnectionDisplaySummary } from "@/startup/dataSourceDisplayCache";

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

export interface ConnectionState {
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

export interface PendingConnect {
  attemptId: number;
  promise: Promise<string | null>;
}

export type ConnectionReadiness =
  | { status: "ready"; connection: ConnectionConfig }
  | { status: "cancelled" }
  | { status: "error"; message: string };
