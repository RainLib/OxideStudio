import { readProjectConnections } from "@/features/connections/model/connectionScope";
import { storeService } from "@/services/tauri/store.service";
import type { ProjectGet, ProjectSet, ProjectState } from "./contracts";
import { DEFAULT_PROJECT, readActiveProjectId, writeActiveProjectId } from "./identity";
import { mergeProjects } from "./enterprise";
import { beginProjectSwitch } from "./switchEpoch";
import { replaceProjectWorkspace } from "./workspace";

type LoadingActions = Pick<
  ProjectState,
  "loadProjects" | "reconcileManagedProjects"
>;

export function createProjectLoadingActions(
  set: ProjectSet,
  get: ProjectGet,
): LoadingActions {
  return {
    loadProjects: async () => {
      set({ isLoading: true });
      try {
        const projects = await storeService.getProjects();
        const localProjects = projects.length > 0 ? projects : [DEFAULT_PROJECT];
        const mergedProjects = mergeProjects(localProjects);
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
    reconcileManagedProjects: () => {
      const state = get();
      const localProjects = state.projects.filter(
        (project) => project.origin !== "managed",
      );
      const projects = mergeProjects(
        localProjects.length > 0 ? localProjects : [DEFAULT_PROJECT],
      );
      if (projects.some((project) => project.id === state.activeProjectId)) {
        set({ projects });
        return;
      }
      const fallback =
        projects.find((project) => project.id === DEFAULT_PROJECT.id) ||
        projects[0] ||
        DEFAULT_PROJECT;
      beginProjectSwitch();
      void readProjectConnections(fallback.id)
        .catch(() => [])
        .then((connections) => {
          replaceProjectWorkspace(fallback, connections, () => {
            set({
              projects,
              activeProjectId: fallback.id,
              activeProjectName: fallback.name,
            });
          });
        });
    },
  };
}
