import { invokeRawCommand } from "../client";
import type { ProjectGitChangeSet, ProjectGitDiffScope, ProjectGitFileDiff } from "./contracts";
import { expectedRootArgument, normalizeProjectRelativePath, requireProjectId } from "./path";

export const projectGitService = {
  getGitChanges: async (
    projectId: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitChangeSet> => {
    return await invokeRawCommand<ProjectGitChangeSet>(
      "get_project_git_changes",
      {
        projectId: requireProjectId(projectId),
        ...expectedRootArgument(expectedRoot),
      },
    );
  },

  getGitFileDiff: async (
    projectId: string,
    relativePath: string,
    expectedRoot?: string | null,
    scope: ProjectGitDiffScope = "all",
  ): Promise<ProjectGitFileDiff> => {
    return await invokeRawCommand<ProjectGitFileDiff>(
      "get_project_git_file_diff",
      {
        projectId: requireProjectId(projectId),
        relativePath: normalizeProjectRelativePath(relativePath),
        scope,
        ...expectedRootArgument(expectedRoot),
      },
    );
  },

};
