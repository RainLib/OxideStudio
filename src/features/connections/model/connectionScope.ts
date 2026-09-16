import { type ConnectionConfig } from "@/features/connections/model/types";
import { connectionService } from "@/services/tauri";
import { writeConnectionDisplayCache } from "@/startup/dataSourceDisplayCache";
export const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";

export const DEFAULT_PROJECT_ID = "sqls";

export const CONNECTION_LOAD_TIMEOUT_MS = 15_000;

export function activeProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

export function scopeConnectionToActiveProject<T extends ConnectionConfig>(
  config: T,
): T {
  return {
    ...config,
    projectId: config.projectId || activeProjectId(),
  };
}

export function connectionProjectId(config: ConnectionConfig) {
  return config.projectId || activeProjectId();
}

export function connectionScopeKey(config: ConnectionConfig) {
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
