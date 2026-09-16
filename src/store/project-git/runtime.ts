import { projectGitService } from "@/services/tauri/project-git.service";
import {
  EMPTY_GIT_REPOSITORY,
  createProjectGitSession,
  type ProjectGitGet,
  type ProjectGitOperation,
  type ProjectGitSet,
  type ProjectGitSession,
} from "./contracts";

export function projectGitErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createProjectGitRuntime(
  set: ProjectGitSet,
  get: ProjectGitGet,
) {
  const updateSession = (
    projectId: string,
    patch: Partial<ProjectGitSession>,
  ) => {
    const current = get().sessions[projectId] ?? createProjectGitSession();
    set((state) => ({
      sessions: {
        ...state.sessions,
        [projectId]: { ...current, ...patch },
      },
    }));
  };

  const refresh = async (projectId: string, rootPath?: string | null) => {
    if (!projectId) return;
    const current = get().sessions[projectId] ?? createProjectGitSession(rootPath);
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
        error: projectGitErrorMessage(error),
      });
    }
  };

  const runOperation = async (
    projectId: string,
    name: string,
    action: ProjectGitOperation,
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
      updateSession(projectId, { error: projectGitErrorMessage(error) });
      return false;
    } finally {
      updateSession(projectId, { operation: null });
    }
  };

  return { updateSession, refresh, runOperation };
}
