/**
 * Tauri API 服务层统一导出
 *
 * 使用示例:
 * ```typescript
 * import { connectionService, queryService, schemaService } from '@/services/tauri';
 *
 * // 连接数据库
 * await connectionService.connect(id, driver, url);
 *
 * // 执行查询
 * const results = await queryService.executeQuery(id, sql);
 *
 * // 获取 schema
 * const schemas = await schemaService.getSchemas(id);
 * ```
 */

// 服务导出
export * from "./connection.service";
export * from "./database.service";
export * from "./query.service";
export * from "./schema.service";
export * from "./store.service";
export * from "./table.service";
export * from "./transaction.service";

// 类型导出
export * from "./types";

// 客户端工具导出
export { invokeCommand, invokeWithInterceptors, interceptors } from "./client";
export type {
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
} from "./client";
