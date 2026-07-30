import {
  projectGitService,
  type ProjectGitPatch,
  type ProjectGitCommitFiles,
  type ProjectGitRepository,
} from "@/services/tauri/project-git.service";
import { create } from "zustand";

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

type ProjectGitState = {
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
};

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

function createSession(rootPath?: string | null): ProjectGitSession {
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

export const useProjectGitStore = create<ProjectGitState>((set, get) => {
  const updateSession = (
    projectId: string,
    patch: Partial<ProjectGitSession>,
  ) => {
    const current = get().sessions[projectId] ?? createSession();
    set((state) => ({
      sessions: {
        ...state.sessions,
        [projectId]: { ...current, ...patch },
      },
    }));
  };

  const refresh = async (projectId: string, rootPath?: string | null) => {
    if (!projectId) return;
    const current = get().sessions[projectId] ?? createSession(rootPath);
    const resolvedRoot = rootPath ?? current.rootPath;
    updateSession(projectId, {
      rootPath: resolvedRoot || null,
      loading: true,
      error: null,
    });
    if (!resolvedRoot) {
      updateSession(projectId, {
        repository: EMPTY_GIT_REPOSITORY,
        loading: false,
        error: "Link a local directory to use version control.",
      });
      return;
    }
    try {
      const repository = await projectGitService.getRepository(
        projectId,
        resolvedRoot,
      );
      const available = new Set(repository.files.map((file) => file.relativePath));
      updateSession(projectId, {
        repository,
        loading: false,
        selectedPaths: current.selectedPaths.filter((path) => available.has(path)),
      });
    } catch (error) {
      updateSession(projectId, {
        loading: false,
        error: errorMessage(error),
      });
    }
  };

  const runOperation = async (
    projectId: string,
    name: string,
    action: (session: ProjectGitSession) => Promise<{ message: string }>,
  ) => {
    const session = get().sessions[projectId];
    if (!session || session.operation) return false;
    updateSession(projectId, { operation: name, error: null, notice: null });
    try {
      const result = await action(session);
      updateSession(projectId, { notice: result.message });
      await refresh(projectId, session.rootPath);
      return true;
    } catch (error) {
      updateSession(projectId, { error: errorMessage(error) });
      return false;
    } finally {
      updateSession(projectId, { operation: null });
    }
  };

  return {
    sessions: {},
    ensureSession: (projectId, rootPath) => {
      const current = get().sessions[projectId];
      if (!current) {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [projectId]: createSession(rootPath),
          },
        }));
      } else if ((rootPath || null) !== current.rootPath) {
        updateSession(projectId, {
          ...createSession(rootPath),
          commitMessage: current.commitMessage,
          versionView: current.versionView,
        });
      }
    },
    updateSession,
    refresh,
    initialize: (projectId, rootPath) =>
      runOperation(projectId, "initialize", (session) =>
        projectGitService.initialize(projectId, rootPath ?? session.rootPath),
      ),
    stage: (projectId, paths) =>
      runOperation(projectId, "stage", (session) =>
        projectGitService.stage(projectId, paths, session.rootPath),
      ),
    unstage: (projectId, paths) =>
      runOperation(projectId, "unstage", (session) =>
        projectGitService.unstage(projectId, paths, session.rootPath),
      ),
    commit: (projectId) =>
      runOperation(projectId, "commit", async (session) => {
        const result = await projectGitService.commit(
          projectId,
          session.commitMessage.trim(),
          session.rootPath,
        );
        updateSession(projectId, { commitMessage: "", selectedPaths: [] });
        return result;
      }),
    fetch: (projectId) =>
      runOperation(projectId, "fetch", (session) =>
        projectGitService.fetch(projectId, session.rootPath),
      ),
    pull: (projectId) =>
      runOperation(projectId, "pull", (session) =>
        projectGitService.pull(projectId, session.rootPath),
      ),
    push: (projectId) =>
      runOperation(projectId, "push", (session) =>
        projectGitService.push(
          projectId,
          !session.repository.upstream,
          session.rootPath,
        ),
      ),
    createBranch: (projectId) =>
      runOperation(projectId, "create-branch", async (session) => {
        const result = await projectGitService.createBranch(
          projectId,
          session.branchName.trim(),
          true,
          session.rootPath,
        );
        updateSession(projectId, { branchName: "" });
        return result;
      }),
    checkoutBranch: (projectId, branch) =>
      runOperation(projectId, `checkout:${branch}`, (session) =>
        projectGitService.checkoutBranch(projectId, branch, session.rootPath),
      ),
    saveRemote: (projectId) =>
      runOperation(projectId, "save-remote", (session) =>
        projectGitService.setRemote(
          projectId,
          session.remoteName.trim(),
          session.remoteUrl.trim(),
          session.rootPath,
        ),
      ),
    loadPatch: async (projectId) => {
      const session = get().sessions[projectId];
      if (!session || session.operation) return false;
      updateSession(projectId, { operation: "patch-load", error: null });
      try {
        const patch = await projectGitService.getPatch(
          projectId,
          session.patchScope,
          session.rootPath,
        );
        updateSession(projectId, {
          patchSummary: patch,
          patchText: patch.patch,
        });
        return true;
      } catch (error) {
        updateSession(projectId, { error: errorMessage(error) });
        return false;
      } finally {
        updateSession(projectId, { operation: null });
      }
    },
    applyPatch: (projectId, reverse) =>
      runOperation(projectId, reverse ? "patch-reverse" : "patch-apply", (session) =>
        projectGitService.applyPatch(
          projectId,
          session.patchText,
          reverse,
          session.rootPath,
        ),
      ),
    loadCommitFiles: async (projectId, revision) => {
      const session = get().sessions[projectId];
      if (!session || session.commitFilesLoading) return false;
      updateSession(projectId, {
        selectedCommitHash: revision,
        commitFiles: null,
        commitFilesLoading: true,
        error: null,
      });
      try {
        const commitFiles = await projectGitService.getCommitFiles(
          projectId,
          revision,
          session.rootPath,
        );
        if (get().sessions[projectId]?.selectedCommitHash === revision) {
          updateSession(projectId, { commitFiles });
        }
        return true;
      } catch (error) {
        updateSession(projectId, { error: errorMessage(error) });
        return false;
      } finally {
        updateSession(projectId, { commitFilesLoading: false });
      }
    },
  };
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
