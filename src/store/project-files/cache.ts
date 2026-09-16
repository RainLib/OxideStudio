import type {
  ProjectFileEntry,
  ProjectFileRead,
} from "@/services/tauri/project-files.service";
import type { ProjectFileContext, ProjectFilesState } from "./contracts";

export function cacheReset(context: ProjectFileContext) {
  return {
    projectId: context.projectId,
    rootPath: context.rootPath,
    entriesByDirectory: {},
    expandedDirectories: [],
    loadingDirectories: [],
    documents: {},
    error: null,
    revisionConflict: null,
  };
}

export function parentPath(relativePath: string): string {
  const separator = relativePath.lastIndexOf("/");
  return separator < 0 ? "" : relativePath.slice(0, separator);
}

export function sortedEntries(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export function hasDirectoryListing(
  entriesByDirectory: Record<string, ProjectFileEntry[]>,
  relativePath: string,
) {
  return Object.prototype.hasOwnProperty.call(entriesByDirectory, relativePath);
}

function isPathWithin(relativePath: string, directoryPath: string): boolean {
  return (
    relativePath === directoryPath ||
    relativePath.startsWith(`${directoryPath}/`)
  );
}

function replacePathPrefix(
  relativePath: string,
  oldPath: string,
  newPath: string,
): string {
  if (relativePath === oldPath) return newPath;
  if (!relativePath.startsWith(`${oldPath}/`)) return relativePath;
  return `${newPath}${relativePath.slice(oldPath.length)}`;
}

export function upsertDirectoryEntry(
  entriesByDirectory: Record<string, ProjectFileEntry[]>,
  directoryPath: string,
  entry: ProjectFileEntry,
): Record<string, ProjectFileEntry[]> {
  if (!hasDirectoryListing(entriesByDirectory, directoryPath)) {
    return entriesByDirectory;
  }

  return {
    ...entriesByDirectory,
    [directoryPath]: sortedEntries([
      ...entriesByDirectory[directoryPath]!.filter(
        (item) => item.relativePath !== entry.relativePath,
      ),
      entry,
    ]),
  };
}

export function renameCachedPaths(
  state: ProjectFilesState,
  oldPath: string,
  newPath: string,
  renamedEntry: ProjectFileEntry,
) {
  const oldParentPath = parentPath(oldPath);
  const newParentPath = parentPath(newPath);
  const entriesByDirectory: Record<string, ProjectFileEntry[]> = {};

  for (const [directoryPath, entries] of Object.entries(
    state.entriesByDirectory,
  )) {
    const remappedDirectoryPath = replacePathPrefix(
      directoryPath,
      oldPath,
      newPath,
    );
    entriesByDirectory[remappedDirectoryPath] = entries
      .filter((entry) => entry.relativePath !== oldPath)
      .map((entry) => ({
        ...entry,
        relativePath: replacePathPrefix(entry.relativePath, oldPath, newPath),
      }));
  }

  if (hasDirectoryListing(entriesByDirectory, oldParentPath)) {
    entriesByDirectory[oldParentPath] = entriesByDirectory[oldParentPath]!.filter(
      (entry) => entry.relativePath !== oldPath,
    );
  }

  const nextEntries = upsertDirectoryEntry(
    entriesByDirectory,
    newParentPath,
    renamedEntry,
  );
  const documents: Record<string, ProjectFileRead> = {};
  for (const [relativePath, document] of Object.entries(state.documents)) {
    const remappedPath = replacePathPrefix(relativePath, oldPath, newPath);
    documents[remappedPath] = {
      ...document,
      relativePath: replacePathPrefix(document.relativePath, oldPath, newPath),
    };
  }

  const revisionConflict = state.revisionConflict
    ? {
        ...state.revisionConflict,
        relativePath: replacePathPrefix(
          state.revisionConflict.relativePath,
          oldPath,
          newPath,
        ),
      }
    : null;

  return {
    entriesByDirectory: Object.fromEntries(
      Object.entries(nextEntries).map(([directoryPath, entries]) => [
        directoryPath,
        sortedEntries(entries),
      ]),
    ),
    expandedDirectories: state.expandedDirectories.map((directoryPath) =>
      replacePathPrefix(directoryPath, oldPath, newPath),
    ),
    loadingDirectories: state.loadingDirectories.map((directoryPath) =>
      replacePathPrefix(directoryPath, oldPath, newPath),
    ),
    documents,
    revisionConflict,
  };
}

export function deleteCachedPaths(state: ProjectFilesState, relativePath: string) {
  const entriesByDirectory: Record<string, ProjectFileEntry[]> = {};
  for (const [directoryPath, entries] of Object.entries(
    state.entriesByDirectory,
  )) {
    if (isPathWithin(directoryPath, relativePath)) continue;
    entriesByDirectory[directoryPath] = entries.filter(
      (entry) => !isPathWithin(entry.relativePath, relativePath),
    );
  }

  return {
    entriesByDirectory,
    expandedDirectories: state.expandedDirectories.filter(
      (directoryPath) => !isPathWithin(directoryPath, relativePath),
    ),
    loadingDirectories: state.loadingDirectories.filter(
      (directoryPath) => !isPathWithin(directoryPath, relativePath),
    ),
    documents: Object.fromEntries(
      Object.entries(state.documents).filter(
        ([documentPath]) => !isPathWithin(documentPath, relativePath),
      ),
    ),
    revisionConflict:
      state.revisionConflict &&
      isPathWithin(state.revisionConflict.relativePath, relativePath)
        ? null
        : state.revisionConflict,
  };
}
