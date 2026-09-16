export * from "./project-git/contracts";

import { projectGitDiffService } from "./project-git/diff";
import { projectGitHubService } from "./project-git/github";
import { projectGitRepositoryService } from "./project-git/repository";

/** Stable project Git client composed from independently owned command groups. */
export const projectGitService = {
  ...projectGitRepositoryService,
  ...projectGitDiffService,
  ...projectGitHubService,
};
