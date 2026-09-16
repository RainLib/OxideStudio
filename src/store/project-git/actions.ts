import { projectGitService } from "@/services/tauri/project-git.service";
import type { ProjectGitState } from "./contracts";
import { projectGitErrorMessage } from "./runtime";

interface ProjectGitActionRuntime {
  get: import("./contracts").ProjectGitGet;
  updateSession: import("./contracts").ProjectGitState["updateSession"];
  runOperation: (
    projectId: string,
    name: string,
    action: import("./contracts").ProjectGitOperation,
  ) => Promise<boolean>;
}

type ProjectGitActions = Pick<
  ProjectGitState,
  | "initialize"
  | "stage"
  | "unstage"
  | "commit"
  | "fetch"
  | "pull"
  | "push"
  | "createBranch"
  | "checkoutBranch"
  | "saveRemote"
  | "loadPatch"
  | "applyPatch"
  | "loadCommitFiles"
>;

export function createProjectGitActions({
  get,
  updateSession,
  runOperation,
}: ProjectGitActionRuntime): ProjectGitActions {
  return {
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
        updateSession(projectId, { error: projectGitErrorMessage(error) });
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
        updateSession(projectId, { error: projectGitErrorMessage(error) });
        return false;
      } finally {
        updateSession(projectId, { commitFilesLoading: false });
      }
    },
  };
}
