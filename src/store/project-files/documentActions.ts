import {
  isProjectFileRevisionConflict,
  normalizeProjectRelativePath,
  projectFilesService,
  type ProjectFileRead,
} from "@/services/tauri/project-files.service";
import {
  deleteCachedPaths,
  hasDirectoryListing,
  parentPath,
  renameCachedPaths,
  upsertDirectoryEntry,
} from "./cache";
import type { ProjectFilesRuntime, ProjectFilesState } from "./contracts";
import { describeProjectFileError } from "./runtime";

type DocumentActions = Pick<
  ProjectFilesState,
  | "readFile"
  | "readPreview"
  | "createFile"
  | "createDirectory"
  | "writeFile"
  | "renameEntry"
  | "deleteEntry"
>;

export function createProjectFileDocumentActions(
  runtime: ProjectFilesRuntime,
): DocumentActions {
  const {
    set,
    get,
    requireConfiguredContext,
    isCurrentContext,
    beginOperation,
    finishOperation,
  } = runtime;

  return {
    readFile: async (relativePath) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const context = requireConfiguredContext();
      beginOperation();
      try {
        const document = await projectFilesService.readProjectFile(
          context.projectId,
          normalizedPath,
          context.rootPath,
        );
        if (isCurrentContext(context)) {
          set((state) => ({
            documents: {
              ...state.documents,
              [normalizedPath]: document,
            },
            revisionConflict:
              state.revisionConflict?.relativePath === normalizedPath
                ? null
                : state.revisionConflict,
          }));
        }
        return document;
      } catch (error) {
        set({ error: describeProjectFileError(error) });
        throw error;
      } finally {
        finishOperation();
      }
    },

    readPreview: async (relativePath) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const context = requireConfiguredContext();
      beginOperation();
      try {
        return await projectFilesService.readProjectFilePreview(
          context.projectId,
          normalizedPath,
          context.rootPath,
        );
      } catch (error) {
        set({ error: describeProjectFileError(error) });
        throw error;
      } finally {
        finishOperation();
      }
    },

    createFile: async (relativePath, content = "") => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const context = requireConfiguredContext();
      beginOperation();
      let document: ProjectFileRead;
      try {
        const result = await projectFilesService.createProjectFile(
          context.projectId,
          normalizedPath,
          content,
          context.rootPath,
        );
        document = { ...result, content };
        if (isCurrentContext(context)) {
          set((state) => ({
            documents: {
              ...state.documents,
              [normalizedPath]: document,
            },
          }));
        }
      } catch (error) {
        set({ error: describeProjectFileError(error) });
        throw error;
      } finally {
        finishOperation();
      }

      const directoryPath = parentPath(normalizedPath);
      if (hasDirectoryListing(get().entriesByDirectory, directoryPath)) {
        await get().refreshDirectory(directoryPath);
      }
      return document;
    },

    createDirectory: async (relativePath) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const context = requireConfiguredContext();
      beginOperation();
      try {
        const entry = await projectFilesService.createProjectDirectory(
          context.projectId,
          normalizedPath,
          context.rootPath,
        );
        if (isCurrentContext(context)) {
          set((state) => ({
            entriesByDirectory: upsertDirectoryEntry(
              state.entriesByDirectory,
              parentPath(normalizedPath),
              entry,
            ),
          }));
        }
        return entry;
      } catch (error) {
        set({ error: describeProjectFileError(error) });
        throw error;
      } finally {
        finishOperation();
      }
    },

    writeFile: async (relativePath, content, expectedRevision) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const context = requireConfiguredContext();
      const revision = expectedRevision || get().documents[normalizedPath]?.revision;
      if (!revision) {
        const error = new Error(
          "Read the latest file revision before saving changes.",
        );
        set({ error: error.message });
        throw error;
      }

      beginOperation();
      try {
        const result = await projectFilesService.writeProjectFile(
          context.projectId,
          normalizedPath,
          content,
          revision,
          context.rootPath,
        );
        const document: ProjectFileRead = { ...result, content };
        if (isCurrentContext(context)) {
          set((state) => ({
            documents: {
              ...state.documents,
              [normalizedPath]: document,
            },
            revisionConflict:
              state.revisionConflict?.relativePath === normalizedPath
                ? null
                : state.revisionConflict,
          }));
        }
        return document;
      } catch (error) {
        const message = describeProjectFileError(error);
        set({
          error: message,
          revisionConflict: isProjectFileRevisionConflict(error)
            ? {
                relativePath: normalizedPath,
                expectedRevision: revision,
                attemptedContent: content,
                message,
              }
            : get().revisionConflict,
        });
        throw error;
      } finally {
        finishOperation();
      }
    },

    renameEntry: async (relativePath, newRelativePath) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const normalizedNewPath = normalizeProjectRelativePath(newRelativePath);
      const context = requireConfiguredContext();
      beginOperation();
      try {
        const entry = await projectFilesService.renameProjectEntry(
          context.projectId,
          normalizedPath,
          normalizedNewPath,
          context.rootPath,
        );
        if (isCurrentContext(context)) {
          set((state) =>
            renameCachedPaths(state, normalizedPath, normalizedNewPath, entry),
          );
        }
        return entry;
      } catch (error) {
        set({ error: describeProjectFileError(error) });
        throw error;
      } finally {
        finishOperation();
      }
    },

    deleteEntry: async (relativePath, recursive = false) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const context = requireConfiguredContext();
      beginOperation();
      try {
        await projectFilesService.deleteProjectEntry(
          context.projectId,
          normalizedPath,
          recursive,
          context.rootPath,
        );
        if (isCurrentContext(context)) {
          set((state) => deleteCachedPaths(state, normalizedPath));
        }
      } catch (error) {
        set({ error: describeProjectFileError(error) });
        throw error;
      } finally {
        finishOperation();
      }
    },
  };
}
