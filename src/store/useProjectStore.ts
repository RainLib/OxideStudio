import { create } from "zustand";
import { storeService, type Project } from "@/services/tauri/store.service";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

const DEFAULT_PROJECT: Project = {
  id: "sqls",
  name: "sqls",
  created_at: 0,
  updated_at: 0,
};

const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";

interface ProjectState {
  projects: Project[];
  activeProjectId: string;
  activeProjectName: string;
  isLoading: boolean;
  loadProjects: () => Promise<void>;
  setActiveProject: (projectId: string) => void;
  createProject: (name: string) => Promise<Project>;
}

function readActiveProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT.id;
  } catch {
    return DEFAULT_PROJECT.id;
  }
}

function writeActiveProjectId(projectId: string) {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
  } catch {
    // Ignore storage failures; the active project remains in memory.
  }
}

function reloadActiveConnectionMetadata() {
  const schemaStore = useSchemaStore.getState();
  schemaStore.reset();
  useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
  useConnectionStore.setState({
    connections: [],
    activeConnectionId: null,
    connectedConnectionIds: [],
    isConnected: false,
    selectedConnection: null,
    isLoading: true,
  });
  void useConnectionStore.getState().loadConnections();
}

function projectIdFromName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  return `${slug || "project"}-${suffix}`;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [DEFAULT_PROJECT],
  activeProjectId: readActiveProjectId(),
  activeProjectName: DEFAULT_PROJECT.name,
  isLoading: false,

  loadProjects: async () => {
    set({ isLoading: true });
    try {
      const projects = await storeService.getProjects();
      const mergedProjects = projects.length > 0 ? projects : [DEFAULT_PROJECT];
      const savedProjectId = readActiveProjectId();
      const activeProject =
        mergedProjects.find((project) => project.id === savedProjectId) ||
        mergedProjects[0] ||
        DEFAULT_PROJECT;

      set({
        projects: mergedProjects,
        activeProjectId: activeProject.id,
        activeProjectName: activeProject.name,
        isLoading: false,
      });
      writeActiveProjectId(activeProject.id);
    } catch (error) {
      console.warn("Failed to load projects", error);
      set({
        projects: [DEFAULT_PROJECT],
        activeProjectId: DEFAULT_PROJECT.id,
        activeProjectName: DEFAULT_PROJECT.name,
        isLoading: false,
      });
    }
  },

  setActiveProject: (projectId: string) => {
    const project =
      get().projects.find((item) => item.id === projectId) || DEFAULT_PROJECT;
    writeActiveProjectId(project.id);
    set({
      activeProjectId: project.id,
      activeProjectName: project.name,
    });
    reloadActiveConnectionMetadata();
  },

  createProject: async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Project name is required");
    }

    const now = Date.now();
    const project: Project = {
      id: projectIdFromName(trimmedName),
      name: trimmedName,
      created_at: now,
      updated_at: now,
    };

    await storeService.saveProject(project);
    set((state) => ({
      projects: [
        ...state.projects.filter((item) => item.id !== project.id),
        project,
      ].sort((a, b) => a.name.localeCompare(b.name)),
      activeProjectId: project.id,
      activeProjectName: project.name,
      isLoading: false,
    }));
    writeActiveProjectId(project.id);
    reloadActiveConnectionMetadata();
    return project;
  },
}));
