import { invoke } from "@tauri-apps/api/core";
import type { SavedConnection } from "./types";

export interface Resource {
  id: string;
  connection_id: string;
  parent_id?: string;
  kind: string;
  name: string;
  metadata: any;
  last_updated: number;
}

export const storeService = {
  // Connection operations
  saveConnection: async (connection: SavedConnection): Promise<void> => {
    return await invoke("save_connection", { connection });
  },

  getConnections: async (): Promise<SavedConnection[]> => {
    return await invoke("get_connections");
  },

  deleteConnection: async (id: string): Promise<void> => {
    return await invoke("delete_connection", { id });
  },

  // Resource operations
  saveResources: async (resources: Resource[]): Promise<void> => {
    return await invoke("save_resources", { resources });
  },

  replaceResources: async (
    connectionId: string,
    parentId: string | undefined,
    kind: string,
    resources: Resource[]
  ): Promise<void> => {
    return await invoke("replace_resources", {
      connectionId,
      parentId,
      kind,
      resources,
    });
  },

  getResources: async (
    connectionId: string,
    parentId?: string
  ): Promise<Resource[]> => {
    return await invoke("get_resources", { connectionId, parentId });
  },

  searchResources: async (
    connectionId: string,
    query: string,
    kind?: string,
    parentId?: string,
    limit?: number
  ): Promise<Resource[]> => {
    return await invoke("search_resources", {
      connectionId,
      query,
      kind,
      parentId,
      limit,
    });
  },
};
