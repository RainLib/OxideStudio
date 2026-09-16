import { useProjectStore } from "@/store/useProjectStore";
import { cacheReset } from "./cache";
import type {
  ProjectFileContext,
  ProjectFilesGet,
  ProjectFilesSet,
} from "./contracts";

export function describeProjectFileError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function activeProjectFileContext(): ProjectFileContext {
  const { activeProjectId, projects } = useProjectStore.getState();
  const project = projects.find((item) => item.id === activeProjectId);
  return {
    projectId: activeProjectId,
    rootPath: project?.root_path || null,
  };
}

export function createProjectFileContextRuntime(
  set: ProjectFilesSet,
  get: ProjectFilesGet,
) {
  const ensureActiveContext = (): ProjectFileContext => {
    const context = activeProjectFileContext();
    const state = get();
    if (
      state.projectId !== context.projectId ||
      state.rootPath !== context.rootPath
    ) {
      set(cacheReset(context));
    }
    return context;
  };

  const requireConfiguredContext = (): ProjectFileContext => {
    const context = ensureActiveContext();
    if (!context.rootPath) {
      const message =
        "Choose a project directory before working with project files.";
      set({ error: message });
      throw new Error(message);
    }
    return context;
  };

  const isCurrentContext = (context: ProjectFileContext): boolean => {
    const state = get();
    return (
      state.projectId === context.projectId &&
      state.rootPath === context.rootPath
    );
  };

  return { ensureActiveContext, requireConfiguredContext, isCurrentContext };
}

export function createProjectFileOperationRuntime(set: ProjectFilesSet) {
  const beginOperation = (directoryPath?: string) => {
    set((state) => ({
      pendingOperations: state.pendingOperations + 1,
      isLoading: true,
      error: null,
      loadingDirectories:
        directoryPath === undefined ||
        state.loadingDirectories.includes(directoryPath)
          ? state.loadingDirectories
          : [...state.loadingDirectories, directoryPath],
    }));
  };

  const finishOperation = (directoryPath?: string) => {
    set((state) => {
      const pendingOperations = Math.max(0, state.pendingOperations - 1);
      return {
        pendingOperations,
        isLoading: pendingOperations > 0,
        loadingDirectories:
          directoryPath === undefined
            ? state.loadingDirectories
            : state.loadingDirectories.filter((item) => item !== directoryPath),
      };
    });
  };

  return { beginOperation, finishOperation };
}
