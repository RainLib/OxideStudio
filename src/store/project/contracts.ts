import type { Project } from "@/services/tauri/store.service";
import type { StoreApi } from "zustand";

export interface ProjectState {
  projects: Project[];
  activeProjectId: string;
  activeProjectName: string;
  isLoading: boolean;
  loadProjects: () => Promise<void>;
  reconcileManagedProjects: () => void;
  setActiveProject: (projectId: string) => boolean;
  createProject: (name: string, rootPath?: string | null) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<void>;
}

export type ProjectSet = StoreApi<ProjectState>["setState"];
export type ProjectGet = StoreApi<ProjectState>["getState"];
