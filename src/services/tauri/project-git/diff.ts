import { invokeRawCommand } from "../client";
import type {
  ProjectGitFileVersions,
  ProjectGitOperationResult,
  ProjectGitPatch,
} from "./contracts";
import { normalizeProjectRelativePath, projectArguments } from "./paths";

export const projectGitDiffService = {
  getPatch: (
    projectId: string,
    scope: ProjectGitPatch["scope"],
    expectedRoot?: string | null,
  ): Promise<ProjectGitPatch> =>
    invokeRawCommand("get_project_git_patch", {
      ...projectArguments(projectId, expectedRoot),
      scope,
    }),

  getFileVersions: (
    projectId: string,
    relativePath: string,
    scope: ProjectGitFileVersions["scope"],
    expectedRoot?: string | null,
  ): Promise<ProjectGitFileVersions> =>
    invokeRawCommand("get_project_git_file_versions", {
      ...projectArguments(projectId, expectedRoot),
      relativePath: normalizeProjectRelativePath(relativePath),
      scope,
    }),

  applyPatch: (
    projectId: string,
    patch: string,
    reverse: boolean,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("apply_project_git_patch", {
      ...projectArguments(projectId, expectedRoot),
      patch,
      reverse,
    }),

  updateIndexPatch: (
    projectId: string,
    patch: string,
    reverse: boolean,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("update_project_git_index_patch", {
      ...projectArguments(projectId, expectedRoot),
      patch,
      reverse,
    }),
};
