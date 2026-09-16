import { readProjectConnections } from "@/features/connections/model/connectionScope";
import { storeService, type Project } from "@/services/tauri/store.service";
import { confirmDiscardAllTabChanges } from "@/store/useTabStore";
import type { ProjectGet, ProjectSet, ProjectState } from "./contracts";
import { managedProjectConnections } from "./enterprise";
import {
  DEFAULT_PROJECT,
  normalizedProjectRootPath,
  projectIdFromName,
  projectRootKey,
} from "./identity";
import { beginProjectSwitch, isCurrentProjectSwitch } from "./switchEpoch";
import { replaceProjectWorkspace } from "./workspace";

type ProjectActions = Pick<
  ProjectState,
  "setActiveProject" | "createProject" | "deleteProject"
>;

export function createProjectActions(
  set: ProjectSet,
  get: ProjectGet,
): ProjectActions {
  return {
    setActiveProject: (projectId) => {
      const project =
        get().projects.find((item) => item.id === projectId) || DEFAULT_PROJECT;
      if (project.id === get().activeProjectId) return true;
      if (!confirmDiscardAllTabChanges("switch projects")) return false;

      const switchId = beginProjectSwitch();
      const connectionRequest =
        project.origin === "managed"
          ? Promise.resolve(managedProjectConnections(project))
          : readProjectConnections(project.id);
      void connectionRequest
        .then((connections) => {
          if (!isCurrentProjectSwitch(switchId)) return;
          replaceProjectWorkspace(project, connections, () => {
            set({ activeProjectId: project.id, activeProjectName: project.name });
          });
        })
        .catch((error) => {
          if (!isCurrentProjectSwitch(switchId)) return;
          console.warn("Failed to load project connections", error);
          replaceProjectWorkspace(project, [], () => {
            set({ activeProjectId: project.id, activeProjectName: project.name });
          });
        });
      return true;
    },
    createProject: async (name, rootPath) => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Project name is required");
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
      beginProjectSwitch();
      replaceProjectWorkspace(project, [], () => {
        set((state) => ({
          projects: [
            ...state.projects.filter((item) => item.id !== project.id),
            project,
          ].sort((left, right) => left.name.localeCompare(right.name)),
          activeProjectId: project.id,
          activeProjectName: project.name,
          isLoading: false,
        }));
      });
      return project;
    },
    deleteProject: async (projectId) => {
      if (projectId === DEFAULT_PROJECT.id) {
        throw new Error("The default project cannot be deleted.");
      }
      const state = get();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return;
      if (project.origin === "managed") {
        throw new Error(
          "Managed projects are assigned by your organization and cannot be deleted locally.",
        );
      }
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
      beginProjectSwitch();
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
  };
}
