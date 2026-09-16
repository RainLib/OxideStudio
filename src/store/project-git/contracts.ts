import type {
  ProjectGitCommitFiles,
  ProjectGitPatch,
  ProjectGitRepository,
} from "@/services/tauri/project-git.service";
import type { StoreApi } from "zustand";

export type VersionControlView = "log" | "branches" | "remotes" | "patches";

export type ProjectGitSession = {
  rootPath: string | null;
  repository: ProjectGitRepository;
  loading: boolean;
  operation: string | null;
  error: string | null;
  notice: string | null;
  selectedPaths: string[];
  assistantFilter: string;
  commitMessage: string;
  versionView: VersionControlView;
  branchName: string;
  remoteName: string;
  remoteUrl: string;
  patchScope: ProjectGitPatch["scope"];
  patchText: string;
  patchSummary: ProjectGitPatch | null;
  selectedCommitHash: string | null;
  commitFiles: ProjectGitCommitFiles | null;
  commitFilesLoading: boolean;
};

export interface ProjectGitState {
  sessions: Record<string, ProjectGitSession>;
  ensureSession: (projectId: string, rootPath?: string | null) => void;
  updateSession: (
    projectId: string,
    patch: Partial<ProjectGitSession>,
  ) => void;
  refresh: (projectId: string, rootPath?: string | null) => Promise<void>;
  initialize: (projectId: string, rootPath?: string | null) => Promise<boolean>;
  stage: (projectId: string, paths: readonly string[]) => Promise<boolean>;
  unstage: (projectId: string, paths: readonly string[]) => Promise<boolean>;
  commit: (projectId: string) => Promise<boolean>;
  fetch: (projectId: string) => Promise<boolean>;
  pull: (projectId: string) => Promise<boolean>;
  push: (projectId: string) => Promise<boolean>;
  createBranch: (projectId: string) => Promise<boolean>;
  checkoutBranch: (projectId: string, branch: string) => Promise<boolean>;
  saveRemote: (projectId: string) => Promise<boolean>;
  loadPatch: (projectId: string) => Promise<boolean>;
  applyPatch: (projectId: string, reverse: boolean) => Promise<boolean>;
  loadCommitFiles: (projectId: string, revision: string) => Promise<boolean>;
}

export type ProjectGitSet = StoreApi<ProjectGitState>["setState"];
export type ProjectGitGet = StoreApi<ProjectGitState>["getState"];
export type ProjectGitOperation = (
  session: ProjectGitSession,
) => Promise<{ message: string }>;

export const EMPTY_GIT_REPOSITORY: ProjectGitRepository = {
  isRepository: false,
  ahead: 0,
  behind: 0,
  files: [],
  branches: [],
  remotes: [],
  commits: [],
  truncated: false,
};

export function createProjectGitSession(
  rootPath?: string | null,
): ProjectGitSession {
  return {
    rootPath: rootPath || null,
    repository: EMPTY_GIT_REPOSITORY,
    loading: false,
    operation: null,
    error: null,
    notice: null,
    selectedPaths: [],
    assistantFilter: "all",
    commitMessage: "",
    versionView: "log",
    branchName: "",
    remoteName: "origin",
    remoteUrl: "",
    patchScope: "working",
    patchText: "",
    patchSummary: null,
    selectedCommitHash: null,
    commitFiles: null,
    commitFilesLoading: false,
  };
}
