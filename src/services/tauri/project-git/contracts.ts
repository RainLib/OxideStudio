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
