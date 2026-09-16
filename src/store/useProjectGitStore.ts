import { createProjectGitStore } from "./project-git/createProjectGitStore";

export {
  EMPTY_GIT_REPOSITORY,
  type ProjectGitSession,
  type ProjectGitState,
  type VersionControlView,
} from "./project-git/contracts";

export const useProjectGitStore = createProjectGitStore();
