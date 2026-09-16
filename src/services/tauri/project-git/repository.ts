import { invokeRawCommand } from "../client";
import type {
  ProjectGitCommitFiles,
  ProjectGitOperationResult,
  ProjectGitRepository,
} from "./contracts";
import { normalizedPaths, projectArguments } from "./paths";

export const projectGitRepositoryService = {
  getRepository: (
    projectId: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitRepository> =>
    invokeRawCommand("get_project_git_repository", {
      ...projectArguments(projectId, expectedRoot),
    }),

  getCommitFiles: (
    projectId: string,
    revision: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitCommitFiles> =>
    invokeRawCommand("get_project_git_commit_files", {
      ...projectArguments(projectId, expectedRoot),
      revision,
    }),

  initialize: (
    projectId: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("init_project_git_repository", {
      ...projectArguments(projectId, expectedRoot),
    }),

  stage: (
    projectId: string,
    paths: readonly string[],
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("stage_project_git_paths", {
      ...projectArguments(projectId, expectedRoot),
      paths: normalizedPaths(paths),
    }),

  unstage: (
    projectId: string,
    paths: readonly string[],
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("unstage_project_git_paths", {
      ...projectArguments(projectId, expectedRoot),
      paths: normalizedPaths(paths),
    }),

  commit: (
    projectId: string,
    message: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("commit_project_git_changes", {
      ...projectArguments(projectId, expectedRoot),
      message,
    }),

  createBranch: (
    projectId: string,
    branch: string,
    checkout: boolean,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("create_project_git_branch", {
      ...projectArguments(projectId, expectedRoot),
      branch,
      checkout,
    }),

  checkoutBranch: (
    projectId: string,
    branch: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("checkout_project_git_branch", {
      ...projectArguments(projectId, expectedRoot),
      branch,
    }),

  setRemote: (
    projectId: string,
    name: string,
    url: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("set_project_git_remote", {
      ...projectArguments(projectId, expectedRoot),
      name,
      url,
    }),

  fetch: (
    projectId: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("fetch_project_git_repository", {
      ...projectArguments(projectId, expectedRoot),
    }),

  pull: (
    projectId: string,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("pull_project_git_repository", {
      ...projectArguments(projectId, expectedRoot),
    }),

  push: (
    projectId: string,
    setUpstream: boolean,
    expectedRoot?: string | null,
  ): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("push_project_git_repository", {
      ...projectArguments(projectId, expectedRoot),
      setUpstream,
    }),
};
