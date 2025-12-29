/**
 * @deprecated 此文件保留用于向后兼容
 * 请使用新的 service 层: @/services/tauri
 *
 * 迁移指南:
 * - api.connect() -> connectionService.connect()
 * - api.query() -> queryService.executeQuery()
 * - api.getSchemas() -> schemaService.getSchemas()
 *
 * @see {@link file:///Users/houshuai/project/rust/OxideStudio/src/services/tauri/index.ts}
 */

import {
  connectionService,
  queryService,
  schemaService,
} from "@/services/tauri";
import type {
  QueryResult as NewQueryResult,
  ColumnDef as NewColumnDef,
  SavedConnection as NewSavedConnection,
  CompletionContext as NewCompletionContext,
} from "@/services/tauri";

// Re-export types for backward compatibility
export type QueryResult = NewQueryResult;
export type ColumnDef = NewColumnDef;
export type SavedConnection = NewSavedConnection;
export type CompletionContext = NewCompletionContext;

/**
 * Legacy Response type (deprecated)
 * @deprecated Use ApiResponse from @/services/tauri instead
 */
export interface Response<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 包装新 API 为旧的 Response 格式
 */
async function wrapResponse<T>(promise: Promise<T>): Promise<Response<T>> {
  try {
    const data = await promise;
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as any).code || "UNKNOWN_ERROR";
    return {
      success: false,
      error: { code, message },
    };
  }
}

/**
 * Legacy API object
 * @deprecated Use service functions from @/services/tauri instead
 *
 * This object is maintained for backward compatibility.
 * All methods now delegate to the new service layer.
 */
export const api = {
  /**
   * Connect to database
   * @deprecated Use connectionService.connect() instead
   */
  connect: async (
    connectionId: string,
    driver: string,
    url: string
  ): Promise<Response<string>> => {
    return wrapResponse(connectionService.connect(connectionId, driver, url));
  },

  /**
   * Execute SQL query
   * @deprecated Use queryService.executeQuery() instead
   */
  query: async (
    connectionId: string,
    sql: string,
    schema?: string
  ): Promise<Response<QueryResult[]>> => {
    return wrapResponse(queryService.executeQuery(connectionId, sql, schema));
  },

  /**
   * Save connections
   * @deprecated Use connectionService.saveConnections() instead
   */
  saveConnections: async (
    connections: SavedConnection[]
  ): Promise<Response<string>> => {
    return wrapResponse(connectionService.saveConnections(connections));
  },

  /**
   * Load connections
   * @deprecated Use connectionService.loadConnections() instead
   */
  loadConnections: async (): Promise<Response<SavedConnection[]>> => {
    return wrapResponse(connectionService.loadConnections());
  },

  /**
   * Get schemas
   * @deprecated Use schemaService.getSchemas() instead
   */
  getSchemas: async (connectionId: string): Promise<Response<string[]>> => {
    console.log("API: getSchemas calling service for", connectionId);
    const result = await wrapResponse(schemaService.getSchemas(connectionId));
    console.log("API: getSchemas result:", result);
    return result;
  },

  /**
   * Get tables
   * @deprecated Use schemaService.getTables() instead
   */
  getTables: async (
    connectionId: string,
    schema: string
  ): Promise<Response<any[]>> => {
    console.log("API: getTables calling service for", connectionId, schema);
    const result = await wrapResponse(
      schemaService.getTables(connectionId, schema)
    );
    console.log("API: getTables result:", result);
    return result;
  },

  /**
   * Get columns
   * @deprecated Use schemaService.getColumns() instead
   */
  getColumns: async (
    connectionId: string,
    schema: string,
    table: string
  ): Promise<Response<any[]>> => {
    return wrapResponse(schemaService.getColumns(connectionId, schema, table));
  },

  /**
   * Set current schema
   * @deprecated Use schemaService.setCurrentSchema() instead
   */
  setCurrentSchema: async (
    connectionId: string,
    schema: string
  ): Promise<Response<string>> => {
    return wrapResponse(schemaService.setCurrentSchema(connectionId, schema));
  },

  /**
   * Get cached schemas
   * @deprecated Use schemaService.getCachedSchemas() instead
   */
  getCachedSchemas: async (
    connectionId: string
  ): Promise<Response<string[]>> => {
    return wrapResponse(schemaService.getCachedSchemas(connectionId));
  },

  /**
   * Refresh schemas
   * @deprecated Use schemaService.refreshSchemas() instead
   */
  refreshSchemas: async (connectionId: string): Promise<Response<string[]>> => {
    return wrapResponse(schemaService.refreshSchemas(connectionId));
  },

  /**
   * Get cached tables
   * @deprecated Use schemaService.getCachedTables() instead
   */
  getCachedTables: async (
    connectionId: string,
    schema: string
  ): Promise<Response<any[]>> => {
    return wrapResponse(schemaService.getCachedTables(connectionId, schema));
  },

  /**
   * Refresh tables
   * @deprecated Use schemaService.refreshTables() instead
   */
  refreshTables: async (
    connectionId: string,
    schema: string
  ): Promise<Response<any[]>> => {
    return wrapResponse(schemaService.refreshTables(connectionId, schema));
  },

  /**
   * Get SQL completion
   * @deprecated Use queryService.getSqlCompletion() instead
   */
  getSqlCompletion: async (
    sql: string,
    cursor: number
  ): Promise<Response<CompletionContext>> => {
    return wrapResponse(queryService.getSqlCompletion(sql, cursor));
  },
};
