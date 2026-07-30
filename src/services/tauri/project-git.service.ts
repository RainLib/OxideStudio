import { invokeRawCommand } from "./client";
import { normalizeProjectRelativePath } from "./project-files.service";

export interface ProjectGitWorkspaceFile {
  relativePath: string;
  previousPath?: string | null;
  status:
    | "modified"
    | "added"
    | "deleted"
    | "renamed"
    | "untracked"
    | "conflicted";
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  additions: number;
  deletions: number;
}

export interface ProjectGitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string | null;
}

export interface ProjectGitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface ProjectGitCommit {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  message: string;
}

export interface ProjectGitCommitFile {
  relativePath: string;
  additions: number;
  deletions: number;
}

export interface ProjectGitCommitFiles {
  revision: string;
  files: ProjectGitCommitFile[];
  truncated: boolean;
}

export interface ProjectGitRepository {
  isRepository: boolean;
  branch?: string | null;
  head?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  files: ProjectGitWorkspaceFile[];
  branches: ProjectGitBranch[];
  remotes: ProjectGitRemote[];
  commits: ProjectGitCommit[];
  truncated: boolean;
}

export interface ProjectGitPatch {
  scope: "all" | "staged" | "working";
  patch: string;
  additions: number;
  deletions: number;
  truncated: boolean;
}

export interface ProjectGitFileVersions {
  relativePath: string;
  scope: "all" | "staged" | "working";
  originalContent: string;
  modifiedContent: string;
  originalMissing: boolean;
  modifiedMissing: boolean;
  binary: boolean;
}

export interface ProjectGitOperationResult {
  message: string;
}

export interface GitHubCliStatus {
  installed: boolean;
  authenticated: boolean;
  account?: string | null;
  version?: string | null;
}

export interface GitHubRepository {
  fullName: string;
  description?: string | null;
  url: string;
  isPrivate: boolean;
  isArchived: boolean;
  stargazersCount: number;
  updatedAt?: string | null;
  defaultBranch?: string | null;
}

function projectArguments(projectId: string, expectedRoot?: string | null) {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) throw new Error("Project id is required");
  return {
    projectId: normalizedProjectId,
    ...(expectedRoot ? { expectedRoot } : {}),
  };
}

function normalizedPaths(paths: readonly string[]) {
  if (paths.length === 0) throw new Error("Select at least one file");
  return [...new Set(paths.map((path) => normalizeProjectRelativePath(path)))];
}

export const projectGitService = {
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

  getGitHubStatus: (): Promise<GitHubCliStatus> =>
    invokeRawCommand("get_github_cli_status"),

  authenticateGitHub: (token: string): Promise<GitHubCliStatus> =>
    invokeRawCommand("authenticate_github_cli", { token }),

  searchGitHub: (query: string): Promise<GitHubRepository[]> =>
    invokeRawCommand("search_github_repositories", { query }),

  clone: (options: {
    source: string;
    destination: string;
    github?: boolean;
    shallowDepth?: number | null;
  }): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("clone_git_repository", {
      source: options.source,
      destination: options.destination,
      github: options.github ?? false,
      shallowDepth: options.shallowDepth ?? null,
    }),
};
