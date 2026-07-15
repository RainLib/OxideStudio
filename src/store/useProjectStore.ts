import { create } from "zustand";
import { storeService, type Project } from "@/services/tauri/store.service";
import { connectionService } from "@/services/tauri";
import {
  readProjectConnections,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { connectionDisplaySummaries } from "@/startup/dataSourceDisplayCache";
import { useSchemaStore } from "@/store/useSchemaStore";
import { confirmDiscardAllTabChanges, useTabStore } from "@/store/useTabStore";
import { unstable_batchedUpdates } from "react-dom";
import { useEditorGroupStore } from "@/store/useEditorGroupStore";

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
  setActiveProject: (projectId: string) => boolean;
  createProject: (name: string, rootPath?: string | null) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<void>;
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

let latestProjectSwitch = 0;

function disconnectPreviousProjectConnections(connectionIds: string[]) {
  for (const connectionId of connectionIds) {
    void connectionService.disconnect(connectionId).catch((error) => {
      console.warn("Failed to disconnect previous project connection", error);
    });
  }
}

function replaceProjectWorkspace(
  project: Project,
  connections: Awaited<ReturnType<typeof readProjectConnections>>,
  updateProject: () => void,
) {
  const previousConnectionIds = [
    ...useConnectionStore.getState().connectedConnectionIds,
  ];
  const initialConnectionId = connections[0]?.id ?? null;
  writeActiveProjectId(project.id);
  unstable_batchedUpdates(() => {
    useSchemaStore.getState().reset();
    useEditorGroupStore.getState().reset();
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useConnectionStore.setState({
      connections,
      connectionDisplayCache: connectionDisplaySummaries(connections),
      hasConnectionDisplayCache: true,
      activeConnectionId: initialConnectionId,
      connectedConnectionIds: [],
      isConnected: false,
      selectedConnection: null,
      isLoading: false,
    });
    updateProject();
  });
  if (initialConnectionId) {
    // Paint the first data source from the target project's SQLite metadata
    // immediately. Establishing a live connection remains an explicit action.
    void useSchemaStore
      .getState()
      .hydrateConnectionMetadataFromCache(initialConnectionId);
  }
  disconnectPreviousProjectConnections(previousConnectionIds);
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

function normalizedProjectRootPath(rootPath?: string | null) {
  const trimmed = rootPath?.trim();
  if (!trimmed) return null;
  if (/^[\\/]+$/.test(trimmed) || /^[a-zA-Z]:[\\/]$/.test(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.replace(/[\\/]+$/, "");
  return normalized || null;
}

function projectRootKey(rootPath?: string | null) {
  return normalizedProjectRootPath(rootPath)?.replace(/\\/g, "/").toLowerCase();
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
    if (project.id === get().activeProjectId) return true;
    if (!confirmDiscardAllTabChanges("switch projects")) return false;

    const switchId = ++latestProjectSwitch;
    void readProjectConnections(project.id)
      .then((connections) => {
        if (switchId !== latestProjectSwitch) return;
        replaceProjectWorkspace(project, connections, () => {
          set({
            activeProjectId: project.id,
            activeProjectName: project.name,
          });
        });
      })
      .catch((error) => {
        if (switchId !== latestProjectSwitch) return;
        console.warn("Failed to load project connections", error);
        replaceProjectWorkspace(project, [], () => {
          set({
            activeProjectId: project.id,
            activeProjectName: project.name,
          });
        });
      });
    return true;
  },

  createProject: async (name: string, rootPath?: string | null) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Project name is required");
    }
    const normalizedRootPath = normalizedProjectRootPath(rootPath);
    const rootKey = projectRootKey(normalizedRootPath);
    if (
      rootKey &&
      get().projects.some(
        (project) => projectRootKey(project.root_path) === rootKey,
      )
    ) {
      throw new Error("This directory is already linked to another project.");
    }
    if (!confirmDiscardAllTabChanges("switch to the new project")) {
      throw new Error(
        "Project creation was cancelled to keep unsaved files open.",
      );
    }

    const now = Date.now();
    const project: Project = {
      id: projectIdFromName(trimmedName),
      name: trimmedName,
      root_path: normalizedRootPath,
      created_at: now,
      updated_at: now,
    };

    await storeService.saveProject(project);
    latestProjectSwitch += 1;
    replaceProjectWorkspace(project, [], () => {
      set((state) => ({
        projects: [
          ...state.projects.filter((item) => item.id !== project.id),
          project,
        ].sort((a, b) => a.name.localeCompare(b.name)),
        activeProjectId: project.id,
        activeProjectName: project.name,
        isLoading: false,
      }));
    });
    return project;
  },

  deleteProject: async (projectId: string) => {
    if (projectId === DEFAULT_PROJECT.id) {
      throw new Error("The default project cannot be deleted.");
    }

    const state = get();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    const isActiveProject = state.activeProjectId === projectId;
    if (
      isActiveProject &&
      !confirmDiscardAllTabChanges("delete the active project")
    ) {
      throw new Error(
        "Project deletion was cancelled to keep unsaved files open.",
      );
    }

    await storeService.deleteProject(projectId);

    const remainingProjects = state.projects.filter(
      (item) => item.id !== projectId,
    );
    if (!isActiveProject) {
      set({ projects: remainingProjects });
      return;
    }

    const fallbackProject =
      remainingProjects.find((item) => item.id === DEFAULT_PROJECT.id) ||
      remainingProjects[0] ||
      DEFAULT_PROJECT;
    let fallbackConnections: Awaited<
      ReturnType<typeof readProjectConnections>
    > = [];
    try {
      fallbackConnections = await readProjectConnections(fallbackProject.id);
    } catch (error) {
      console.warn("Failed to load fallback project connections", error);
    }

    latestProjectSwitch += 1;
    replaceProjectWorkspace(fallbackProject, fallbackConnections, () => {
      set({
        projects:
          remainingProjects.length > 0 ? remainingProjects : [DEFAULT_PROJECT],
        activeProjectId: fallbackProject.id,
        activeProjectName: fallbackProject.name,
        isLoading: false,
      });
    });
  },
}));
