import { invokeRawCommand, invokeWithInterceptors } from "./client";
import type { ConnectionImportFile, SavedConnection, SshTunnelConfig } from "./types";

/**
 * 数据库连接服务
 * 管理数据库连接的建立、断开和保存
 */

const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";
const DEFAULT_PROJECT_ID = "sqls";

export interface RemoteSqliteWorkerPreparation {
  platform: string;
  version: string;
  installed: boolean;
}

function activeProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

/**
 * 连接到数据库
 * @param connectionId - 连接 ID
 * @param driver - 数据库驱动 (postgres/mysql)
 * @param url - 连接 URL
 * @returns Promise<string> - 连接成功消息
 */
export async function connect(
  connectionId: string,
  driver: string,
  url: string,
  sshTunnel?: SshTunnelConfig,
  packageVersion?: string,
): Promise<string> {
  return invokeWithInterceptors<string>("connect_db", {
    connectionId,
    driver,
    url,
    sshTunnel,
    packageVersion,
  });
}

/**
 * 测试数据库连接，不切换当前工作区连接
 */
export async function testConnection(
  driver: string,
  url: string,
  sshTunnel?: SshTunnelConfig,
  packageVersion?: string,
): Promise<string> {
  return invokeWithInterceptors<string>("test_db_connection", {
    driver,
    url,
    sshTunnel,
    packageVersion,
  });
}

export async function prepareRemoteSqliteWorker(
  sshTunnel: SshTunnelConfig,
  downloadBaseUrl: string,
): Promise<RemoteSqliteWorkerPreparation> {
  return invokeWithInterceptors<RemoteSqliteWorkerPreparation>(
    "prepare_remote_sqlite_worker",
    { sshTunnel, downloadBaseUrl },
  );
}

export async function getRemoteSqliteWorkerStatus(
  platform: string,
): Promise<RemoteSqliteWorkerPreparation> {
  return invokeWithInterceptors<RemoteSqliteWorkerPreparation>(
    "get_remote_sqlite_worker_status",
    { platform },
  );
}

/**
 * 断开数据库连接
 * @param connectionId - 连接 ID
 * @returns Promise<string> - 断开成功消息
 */
export async function disconnect(connectionId: string): Promise<string> {
  return invokeWithInterceptors<string>("disconnect_db", {
    connectionId,
  });
}

export async function getServerVersion(
  connectionId: string,
): Promise<string | null> {
  return invokeWithInterceptors<string | null>(
    "get_connection_server_version",
    { connectionId },
  );
}

/** Opens a native picker and reads a bounded DataGrip/DBeaver configuration. */
export async function importConnectionConfigFile(): Promise<ConnectionImportFile | null> {
  return invokeWithInterceptors<ConnectionImportFile | null>(
    "import_connection_config_file",
  );
}

/**
 * 加载保存的连接列表
 * @returns Promise<SavedConnection[]> - 连接列表
 */
export async function loadConnections(
  projectId = activeProjectId(),
): Promise<SavedConnection[]> {
  return invokeWithInterceptors<SavedConnection[]>("load_connections", {
    projectId,
  });
}

/**
 * 保存连接列表
 * @param connections - 要保存的连接列表
 * @returns Promise<string> - 保存成功消息
 */
export async function saveConnections(
  connections: SavedConnection[],
  projectId = activeProjectId(),
): Promise<string> {
  return invokeWithInterceptors<string>("save_connections", {
    projectId,
    connections: connections.map((connection) => ({
      ...connection,
      projectId: connection.projectId || projectId,
    })),
  });
}

/**
 * Permanently remove one saved data source configuration.
 */
export async function deleteConnection(
  id: string,
  projectId = activeProjectId(),
): Promise<void> {
  return invokeRawCommand("delete_connection", { id, projectId });
}

/**
 * 连接服务对象
 * 提供更面向对象的 API 接口
 */
export const connectionService = {
  connect,
  testConnection,
  prepareRemoteSqliteWorker,
  getRemoteSqliteWorkerStatus,
  disconnect,
  getServerVersion,
  importConnectionConfigFile,
  loadConnections,
  saveConnections,
  deleteConnection,
};
