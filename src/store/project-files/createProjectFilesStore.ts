import { create } from "zustand";
import { cacheReset } from "./cache";
import type { ProjectFilesState } from "./contracts";
import { createProjectFileDirectoryActions } from "./directoryActions";
import { createProjectFileDocumentActions } from "./documentActions";
import { createProjectFileProjectActions } from "./projectActions";
import {
  activeProjectFileContext,
  createProjectFileContextRuntime,
  createProjectFileOperationRuntime,
} from "./runtime";

export function createProjectFilesStore() {
  const initialContext = activeProjectFileContext();
  return create<ProjectFilesState>((set, get) => {
    const context = createProjectFileContextRuntime(set, get);
    const operations = createProjectFileOperationRuntime(set);
    const runtime = { set, get, ...context, ...operations };

    return {
      ...cacheReset(initialContext),
      isLoading: false,
      pendingOperations: 0,
      ...createProjectFileProjectActions(runtime),
      ...createProjectFileDirectoryActions(runtime),
      ...createProjectFileDocumentActions(runtime),
      clearError: () => set({ error: null }),
      clearRevisionConflict: () => set({ revisionConflict: null }),
      reset: () => {
        set({
          ...cacheReset(activeProjectFileContext()),
          isLoading: false,
          pendingOperations: 0,
        });
      },
    };
  });
}
