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
};
