import {
  normalizeProjectRelativePath,
  projectFilesService,
} from "@/services/tauri/project-files.service";
import { hasDirectoryListing, sortedEntries } from "./cache";
import {
  ROOT_NOT_CONFIGURED_MESSAGE,
  type ProjectFilesRuntime,
  type ProjectFilesState,
} from "./contracts";
import { describeProjectFileError } from "./runtime";

type DirectoryActions = Pick<
  ProjectFilesState,
  | "loadTree"
  | "loadDirectory"
  | "refreshDirectory"
  | "expandDirectory"
  | "collapseDirectory"
  | "toggleDirectory"
>;

export function createProjectFileDirectoryActions(
  runtime: ProjectFilesRuntime,
): DirectoryActions {
  const {
    set,
    get,
    ensureActiveContext,
    isCurrentContext,
    beginOperation,
    finishOperation,
  } = runtime;

  return {
    loadTree: async () => {
      const context = ensureActiveContext();
      set({
        entriesByDirectory: {},
        expandedDirectories: [],
        loadingDirectories: [],
        revisionConflict: null,
      });
      if (!context.rootPath) {
        set({ error: ROOT_NOT_CONFIGURED_MESSAGE });
        return;
      }
      await get().loadDirectory("");
    },

    loadDirectory: async (relativePath = "") => {
      const normalizedPath = normalizeProjectRelativePath(relativePath, {
        allowEmpty: true,
      });
      const context = ensureActiveContext();
      if (!context.rootPath) {
        set({ error: ROOT_NOT_CONFIGURED_MESSAGE });
        return;
      }
      if (get().loadingDirectories.includes(normalizedPath)) return;

      beginOperation(normalizedPath);
      try {
        const entries = await projectFilesService.listProjectEntries(
          context.projectId,
          normalizedPath,
          context.rootPath,
        );
        if (!isCurrentContext(context)) return;
        set((current) => ({
          entriesByDirectory: {
            ...current.entriesByDirectory,
            [normalizedPath]: sortedEntries(entries),
          },
        }));
      } catch (error) {
        set({ error: describeProjectFileError(error) });
      } finally {
        finishOperation(normalizedPath);
      }
    },

    refreshDirectory: async (relativePath = "") => {
      await get().loadDirectory(relativePath);
    },

    expandDirectory: async (relativePath) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      set((state) => ({
        expandedDirectories: state.expandedDirectories.includes(normalizedPath)
          ? state.expandedDirectories
          : [...state.expandedDirectories, normalizedPath],
      }));
      if (!hasDirectoryListing(get().entriesByDirectory, normalizedPath)) {
        await get().loadDirectory(normalizedPath);
      }
    },

    collapseDirectory: (relativePath) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      set((state) => ({
        expandedDirectories: state.expandedDirectories.filter(
          (item) => item !== normalizedPath,
        ),
      }));
    },

    toggleDirectory: async (relativePath) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      if (get().expandedDirectories.includes(normalizedPath)) {
        get().collapseDirectory(normalizedPath);
        return;
      }
      await get().expandDirectory(normalizedPath);
    },
  };
}
