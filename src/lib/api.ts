import { invoke } from "@tauri-apps/api/core";

export interface QueryResult {
  columns: ColumnDef[];
  rows: any[][];
}

export interface ColumnDef {
  name: string;
  data_type: string;
}

export interface SavedConnection {
  id: string;
  name: string;
  driver: "postgres" | "mysql";
  url: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export interface Response<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export const api = {
  connect: async (
    connectionId: string,
    driver: string,
    url: string
  ): Promise<Response<string>> => {
    return await invoke("connect_db", {
      connectionId,
      driver,
      url,
    });
  },

  query: async (
    connectionId: string,
    sql: string
  ): Promise<Response<QueryResult[]>> => {
    return await invoke("execute_query", {
      connectionId,
      sql,
    });
  },

  saveConnections: async (
    connections: SavedConnection[]
  ): Promise<Response<string>> => {
    return await invoke("save_connections", {
      connections,
    });
  },

  loadConnections: async (): Promise<Response<SavedConnection[]>> => {
    return await invoke("load_connections");
  },

  getSchemas: async (connectionId: string): Promise<Response<string[]>> => {
    console.log("API: getSchemas calling invoke for", connectionId);
    const res = await invoke<Response<string[]>>("get_schemas", {
      connectionId,
    });
    console.log("API: getSchemas result:", res);
    return res;
  },

  getTables: async (
    connectionId: string,
    schema: string
  ): Promise<Response<any[]>> => {
    console.log("API: getTables calling invoke for", connectionId, schema);
    const res = await invoke<Response<any[]>>("get_tables", {
      connectionId,
      schema,
    });
    console.log("API: getTables result:", res);
    return res;
  },

  getColumns: async (
    connectionId: string,
    schema: string,
    table: string
  ): Promise<Response<any[]>> => {
    return await invoke("get_columns", { connectionId, schema, table });
  },
};
