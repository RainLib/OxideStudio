import { invokeWithInterceptors } from "./client";
import type { SavedConnection } from "./types";

/**
 * 数据库连接服务
 * 管理数据库连接的建立、断开和保存
 */

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
  url: string
): Promise<string> {
  return invokeWithInterceptors<string>("connect_db", {
    connectionId,
    driver,
    url,
  });
}

/**
 * 加载保存的连接列表
 * @returns Promise<SavedConnection[]> - 连接列表
 */
export async function loadConnections(): Promise<SavedConnection[]> {
  return invokeWithInterceptors<SavedConnection[]>("load_connections");
}

/**
 * 保存连接列表
 * @param connections - 要保存的连接列表
 * @returns Promise<string> - 保存成功消息
 */
export async function saveConnections(
  connections: SavedConnection[]
): Promise<string> {
  return invokeWithInterceptors<string>("save_connections", {
    connections,
  });
}

/**
 * 连接服务对象
 * 提供更面向对象的 API 接口
 */
export const connectionService = {
  connect,
  loadConnections,
  saveConnections,
};
