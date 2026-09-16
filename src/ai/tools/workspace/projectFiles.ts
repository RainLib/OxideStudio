import type { AiToolAdapters } from "@/ai/tools/types";
import { projectFilesService } from "@/services/tauri";
import { useProjectStore } from "@/store/useProjectStore";

function activeLocalProject() {
  const state = useProjectStore.getState();
  const project = state.projects.find(
    (candidate) => candidate.id === state.activeProjectId,
  );
  if (!project?.root_path || project.origin === "managed") {
    throw new Error("The active project does not have a writable local root");
  }
  return project;
}

export function createProjectFileAdapters(): Pick<
  AiToolAdapters,
  "listProjectFiles" | "readProjectFile" | "writeProjectFile"
> {
  return {
    listProjectFiles: async (input) => {
      const project = activeLocalProject();
      return projectFilesService.listProjectEntries(
        project.id,
        input.directory || "",
        project.root_path,
      );
    },

    readProjectFile: async (input) => {
      const project = activeLocalProject();
      return projectFilesService.readProjectFile(
        project.id,
        input.path,
        project.root_path,
      );
    },

    writeProjectFile: async (input) => {
      const project = activeLocalProject();
      return input.create
        ? projectFilesService.createProjectFile(
            project.id,
            input.path,
            input.content,
            project.root_path,
          )
        : projectFilesService.writeProjectFile(
            project.id,
            input.path,
            input.content,
            input.expectedRevision || "",
            project.root_path,
          );
    },
  };
}
