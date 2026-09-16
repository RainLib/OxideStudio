import { projectFilesService } from "@/services/tauri/project-files.service";
import { useProjectStore } from "@/store/useProjectStore";
import { cacheReset } from "./cache";
import type { ProjectFilesRuntime, ProjectFilesState } from "./contracts";
import { describeProjectFileError } from "./runtime";

type ProjectActions = Pick<
  ProjectFilesState,
  "syncActiveProject" | "setRootPath"
>;

export function createProjectFileProjectActions(
  runtime: ProjectFilesRuntime,
): ProjectActions {
  const { set, get, ensureActiveContext, beginOperation, finishOperation } = runtime;

  return {
    syncActiveProject: () => {
      ensureActiveContext();
    },

    setRootPath: async (rootPath) => {
      const context = ensureActiveContext();
      beginOperation();
      let configuredRootPath: string | null = null;
      try {
        const project = await projectFilesService.setProjectRoot(
          context.projectId,
          rootPath,
        );
        configuredRootPath = project.root_path || null;
        useProjectStore.setState((state) => ({
          projects: state.projects.some((item) => item.id === project.id)
            ? state.projects.map((item) =>
                item.id === project.id ? { ...item, ...project } : item,
              )
            : [...state.projects, project],
        }));

        if (useProjectStore.getState().activeProjectId === project.id) {
          set(
            cacheReset({
              projectId: project.id,
              rootPath: configuredRootPath,
            }),
          );
        }
      } catch (error) {
        set({ error: describeProjectFileError(error) });
        throw error;
      } finally {
        finishOperation();
      }

      if (
        configuredRootPath &&
        useProjectStore.getState().activeProjectId === context.projectId
      ) {
        await get().loadTree();
      }
    },
  };
}
