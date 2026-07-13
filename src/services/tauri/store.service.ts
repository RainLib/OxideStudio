import { invoke } from "@tauri-apps/api/core";
import type { SavedConnection } from "./types";

export interface Resource {
  id: string;
  project_id?: string;
  connection_id: string;
  parent_id?: string;
  kind: string;
  name: string;
  metadata: any;
  last_updated: number;
}

export interface Project {
  id: string;
  name: string;
  root_path?: string | null;
  created_at: number;
  updated_at: number;
}

const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";

function activeProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || "sqls";
  } catch {
    return "sqls";
  }
}

function scopeResources(resources: Resource[], projectId: string) {
  return resources.map((resource) => ({
    ...resource,
    project_id: resource.project_id || projectId,
  }));
}

export const storeService = {
  saveProject: async (project: Project): Promise<void> => {
    return await invoke("save_project", { project });
  },

  getProjects: async (): Promise<Project[]> => {
    return await invoke("get_projects");
  },

  deleteProject: async (projectId: string): Promise<void> => {
    return await invoke("delete_project", { projectId });
  },

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
  saveResources: async (
    resources: Resource[],
    projectId = activeProjectId()
  ): Promise<void> => {
    return await invoke("save_resources", {
      projectId,
      resources: scopeResources(resources, projectId),
    });
  },

  replaceResources: async (
    connectionId: string,
    parentId: string | undefined,
    kind: string,
    resources: Resource[],
    projectId = activeProjectId()
  ): Promise<void> => {
    return await invoke("replace_resources", {
      projectId,
      connectionId,
      parentId,
      kind,
      resources: scopeResources(resources, projectId),
    });
  },

  deleteResources: async (
    connectionId: string,
    parentId?: string,
    kind?: string,
    projectId = activeProjectId()
  ): Promise<void> => {
    return await invoke("delete_resources", {
      projectId,
      connectionId,
      parentId,
      kind,
    });
  },

  getResources: async (
    connectionId: string,
    parentId?: string,
    projectId = activeProjectId()
  ): Promise<Resource[]> => {
    return await invoke("get_resources", { projectId, connectionId, parentId });
  },

  searchResources: async (
    connectionId: string,
    query: string,
    kind?: string,
    parentId?: string,
    limit?: number,
    projectId = activeProjectId()
  ): Promise<Resource[]> => {
    return await invoke("search_resources", {
      projectId,
      connectionId,
      query,
      kind,
      parentId,
      limit,
    });
  },
};
