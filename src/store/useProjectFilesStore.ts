import { useProjectStore } from "@/store/useProjectStore";
import { createProjectFilesStore } from "./project-files/createProjectFilesStore";

export type {
  ProjectFileRevisionConflict,
  ProjectFilesState,
} from "./project-files/contracts";
export {
  selectProjectFileTree,
  type ProjectFileTreeNode,
} from "./project-files/tree";

export const useProjectFilesStore = createProjectFilesStore();

// Keep file state scoped to the same project as the rest of the workspace even
// when a project is changed outside the future project-files UI.
useProjectStore.subscribe((state, previousState) => {
  const activeProject = state.projects.find(
    (project) => project.id === state.activeProjectId,
  );
  const previousProject = previousState.projects.find(
    (project) => project.id === previousState.activeProjectId,
  );
  if (
    state.activeProjectId !== previousState.activeProjectId ||
    activeProject?.root_path !== previousProject?.root_path
  ) {
    useProjectFilesStore.getState().syncActiveProject();
  }
});
