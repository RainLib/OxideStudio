import { create } from "zustand";
import {
  isProjectFileRevisionConflict,
  normalizeProjectRelativePath,
  projectFilesService,
  type ProjectFileEntry,
  type ProjectFileRead,
} from "@/services/tauri/project-files.service";
import { useProjectStore } from "@/store/useProjectStore";

const ROOT_NOT_CONFIGURED_MESSAGE =
  "Choose a project directory before working with project files.";

interface ProjectFileContext {
  projectId: string;
  rootPath: string | null;
}

export interface ProjectFileRevisionConflict {
  relativePath: string;
  expectedRevision: string;
  attemptedContent: string;
  message: string;
}

export interface ProjectFileTreeNode extends ProjectFileEntry {
  children?: ProjectFileTreeNode[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
}

export interface ProjectFilesState {
  projectId: string;
  rootPath: string | null;
  entriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: string[];
  loadingDirectories: string[];
  documents: Record<string, ProjectFileRead>;
  isLoading: boolean;
  error: string | null;
  revisionConflict: ProjectFileRevisionConflict | null;
  pendingOperations: number;

  syncActiveProject: () => void;
  setRootPath: (rootPath: string | null) => Promise<void>;
  loadTree: () => Promise<void>;
  loadDirectory: (relativePath?: string) => Promise<void>;
  refreshDirectory: (relativePath?: string) => Promise<void>;
  expandDirectory: (relativePath: string) => Promise<void>;
  collapseDirectory: (relativePath: string) => void;
  toggleDirectory: (relativePath: string) => Promise<void>;
  readFile: (relativePath: string) => Promise<ProjectFileRead>;
  createFile: (
    relativePath: string,
    content?: string
  ) => Promise<ProjectFileRead>;
  createDirectory: (relativePath: string) => Promise<ProjectFileEntry>;
  writeFile: (
    relativePath: string,
    content: string,
    expectedRevision?: string
  ) => Promise<ProjectFileRead>;
  renameEntry: (
    relativePath: string,
    newRelativePath: string
  ) => Promise<ProjectFileEntry>;
  deleteEntry: (relativePath: string, recursive?: boolean) => Promise<void>;
  clearError: () => void;
  clearRevisionConflict: () => void;
  reset: () => void;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function activeProjectContext(): ProjectFileContext {
  const { activeProjectId, projects } = useProjectStore.getState();
  const project = projects.find((item) => item.id === activeProjectId);
  return {
    projectId: activeProjectId,
    rootPath: project?.root_path || null,
  };
}

function cacheReset(context: ProjectFileContext) {
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

function parentPath(relativePath: string): string {
  const separator = relativePath.lastIndexOf("/");
  return separator < 0 ? "" : relativePath.slice(0, separator);
}

function sortedEntries(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function hasDirectoryListing(
  entriesByDirectory: Record<string, ProjectFileEntry[]>,
  relativePath: string
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
  newPath: string
): string {
  if (relativePath === oldPath) return newPath;
  if (!relativePath.startsWith(`${oldPath}/`)) return relativePath;
  return `${newPath}${relativePath.slice(oldPath.length)}`;
}

function upsertDirectoryEntry(
  entriesByDirectory: Record<string, ProjectFileEntry[]>,
  directoryPath: string,
  entry: ProjectFileEntry
): Record<string, ProjectFileEntry[]> {
  if (!hasDirectoryListing(entriesByDirectory, directoryPath)) {
    return entriesByDirectory;
  }

  return {
    ...entriesByDirectory,
    [directoryPath]: sortedEntries([
      ...entriesByDirectory[directoryPath]!.filter(
        (item) => item.relativePath !== entry.relativePath
      ),
      entry,
    ]),
  };
}

function renameCachedPaths(
  state: ProjectFilesState,
  oldPath: string,
  newPath: string,
  renamedEntry: ProjectFileEntry
) {
  const oldParentPath = parentPath(oldPath);
  const newParentPath = parentPath(newPath);
  const entriesByDirectory: Record<string, ProjectFileEntry[]> = {};

  for (const [directoryPath, entries] of Object.entries(
    state.entriesByDirectory
  )) {
    const remappedDirectoryPath = replacePathPrefix(
      directoryPath,
      oldPath,
      newPath
    );
    entriesByDirectory[remappedDirectoryPath] = entries
      .filter((entry) => entry.relativePath !== oldPath)
      .map((entry) => ({
        ...entry,
        relativePath: replacePathPrefix(
          entry.relativePath,
          oldPath,
          newPath
        ),
      }));
  }

  if (hasDirectoryListing(entriesByDirectory, oldParentPath)) {
    entriesByDirectory[oldParentPath] = entriesByDirectory[
      oldParentPath
    ]!.filter((entry) => entry.relativePath !== oldPath);
  }

  const nextEntries = upsertDirectoryEntry(
    entriesByDirectory,
    newParentPath,
    renamedEntry
  );
  const documents: Record<string, ProjectFileRead> = {};
  for (const [relativePath, document] of Object.entries(state.documents)) {
    const remappedPath = replacePathPrefix(relativePath, oldPath, newPath);
    documents[remappedPath] = {
      ...document,
      relativePath: replacePathPrefix(
        document.relativePath,
        oldPath,
        newPath
      ),
    };
  }

  const revisionConflict = state.revisionConflict
    ? {
        ...state.revisionConflict,
        relativePath: replacePathPrefix(
          state.revisionConflict.relativePath,
          oldPath,
          newPath
        ),
      }
    : null;

  return {
    entriesByDirectory: Object.fromEntries(
      Object.entries(nextEntries).map(([directoryPath, entries]) => [
        directoryPath,
        sortedEntries(entries),
      ])
    ),
    expandedDirectories: state.expandedDirectories.map((directoryPath) =>
      replacePathPrefix(directoryPath, oldPath, newPath)
    ),
    loadingDirectories: state.loadingDirectories.map((directoryPath) =>
      replacePathPrefix(directoryPath, oldPath, newPath)
    ),
    documents,
    revisionConflict,
  };
}

function deleteCachedPaths(state: ProjectFilesState, relativePath: string) {
  const entriesByDirectory: Record<string, ProjectFileEntry[]> = {};
  for (const [directoryPath, entries] of Object.entries(
    state.entriesByDirectory
  )) {
    if (isPathWithin(directoryPath, relativePath)) continue;
    entriesByDirectory[directoryPath] = entries.filter(
      (entry) => !isPathWithin(entry.relativePath, relativePath)
    );
  }

  return {
    entriesByDirectory,
    expandedDirectories: state.expandedDirectories.filter(
      (directoryPath) => !isPathWithin(directoryPath, relativePath)
    ),
    loadingDirectories: state.loadingDirectories.filter(
      (directoryPath) => !isPathWithin(directoryPath, relativePath)
    ),
    documents: Object.fromEntries(
      Object.entries(state.documents).filter(
        ([documentPath]) => !isPathWithin(documentPath, relativePath)
      )
    ),
    revisionConflict:
      state.revisionConflict &&
      isPathWithin(state.revisionConflict.relativePath, relativePath)
        ? null
        : state.revisionConflict,
  };
}

function buildTree(
  state: ProjectFilesState,
  directoryPath: string,
  visited: Set<string>
): ProjectFileTreeNode[] {
  if (visited.has(directoryPath)) return [];
  const nextVisited = new Set(visited).add(directoryPath);

  return (state.entriesByDirectory[directoryPath] || []).map((entry) => {
    const isDirectory = entry.kind === "directory";
    const isExpanded =
      isDirectory && state.expandedDirectories.includes(entry.relativePath);
    const isLoaded =
      isDirectory &&
      hasDirectoryListing(state.entriesByDirectory, entry.relativePath);

    return {
      ...entry,
      isExpanded,
      isLoaded,
      isLoading:
        isDirectory && state.loadingDirectories.includes(entry.relativePath),
      children:
        isExpanded && isLoaded
          ? buildTree(state, entry.relativePath, nextVisited)
          : undefined,
    };
  });
}

export function selectProjectFileTree(
  state: ProjectFilesState
): ProjectFileTreeNode[] {
  return buildTree(state, "", new Set());
}

const initialContext = activeProjectContext();

export const useProjectFilesStore = create<ProjectFilesState>((set, get) => {
  const ensureActiveContext = (): ProjectFileContext => {
    const context = activeProjectContext();
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
      set({ error: ROOT_NOT_CONFIGURED_MESSAGE });
      throw new Error(ROOT_NOT_CONFIGURED_MESSAGE);
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
            : state.loadingDirectories.filter(
                (item) => item !== directoryPath
              ),
      };
    });
  };

  return {
    ...cacheReset(initialContext),
    isLoading: false,
    pendingOperations: 0,

    syncActiveProject: () => {
      ensureActiveContext();
    },

    setRootPath: async (rootPath) => {
      const context = ensureActiveContext();
      beginOperation();
      let configuredRootPath: string | null = null;
      try {
        const project = await projectFilesService.setProjectRoot(
          context.projectId,
          rootPath
        );
        configuredRootPath = project.root_path || null;
        useProjectStore.setState((state) => ({
          projects: state.projects.some((item) => item.id === project.id)
            ? state.projects.map((item) =>
                item.id === project.id ? { ...item, ...project } : item
              )
            : [...state.projects, project],
        }));

        if (useProjectStore.getState().activeProjectId === project.id) {
          set(cacheReset({
            projectId: project.id,
            rootPath: configuredRootPath,
          }));
        }
      } catch (error) {
        set({ error: describeError(error) });
        throw error;
      } finally {
        finishOperation();
      }

      if (
        configuredRootPath &&
        useProjectStore.getState().activeProjectId === context.projectId
      ) {
        await get().loadTree();
      }
    },

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
          context.rootPath
        );
        const state = get();
        if (
          state.projectId !== context.projectId ||
          state.rootPath !== context.rootPath
        ) {
          return;
        }
        set((current) => ({
          entriesByDirectory: {
            ...current.entriesByDirectory,
            [normalizedPath]: sortedEntries(entries),
          },
        }));
      } catch (error) {
        set({ error: describeError(error) });
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
          (item) => item !== normalizedPath
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

    readFile: async (relativePath) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const context = requireConfiguredContext();
      beginOperation();
      try {
        const document = await projectFilesService.readProjectFile(
          context.projectId,
          normalizedPath,
          context.rootPath
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
        set({ error: describeError(error) });
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
          context.rootPath
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
        set({ error: describeError(error) });
        throw error;
      } finally {
        finishOperation();
      }

      if (hasDirectoryListing(get().entriesByDirectory, parentPath(normalizedPath))) {
        await get().refreshDirectory(parentPath(normalizedPath));
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
          context.rootPath
        );
        if (isCurrentContext(context)) {
          set((state) => ({
            entriesByDirectory: upsertDirectoryEntry(
              state.entriesByDirectory,
              parentPath(normalizedPath),
              entry
            ),
          }));
        }
        return entry;
      } catch (error) {
        set({ error: describeError(error) });
        throw error;
      } finally {
        finishOperation();
      }
    },

    writeFile: async (relativePath, content, expectedRevision) => {
      const normalizedPath = normalizeProjectRelativePath(relativePath);
      const context = requireConfiguredContext();
      const revision =
        expectedRevision || get().documents[normalizedPath]?.revision;
      if (!revision) {
        const error = new Error(
          "Read the latest file revision before saving changes."
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
          context.rootPath
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
        const message = describeError(error);
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
          context.rootPath
        );
        if (isCurrentContext(context)) {
          set((state) =>
            renameCachedPaths(
              state,
              normalizedPath,
              normalizedNewPath,
              entry
            )
          );
        }
        return entry;
      } catch (error) {
        set({ error: describeError(error) });
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
          context.rootPath
        );
        if (isCurrentContext(context)) {
          set((state) => deleteCachedPaths(state, normalizedPath));
        }
      } catch (error) {
        set({ error: describeError(error) });
        throw error;
      } finally {
        finishOperation();
      }
    },

    clearError: () => set({ error: null }),
    clearRevisionConflict: () => set({ revisionConflict: null }),
    reset: () => {
      const context = activeProjectContext();
      set({
        ...cacheReset(context),
        isLoading: false,
        pendingOperations: 0,
      });
    },
  };
});

// Keep file state scoped to the same project as the rest of the workspace even
// when a project is changed outside the future project-files UI.
useProjectStore.subscribe((state, previousState) => {
  const activeProject = state.projects.find(
    (project) => project.id === state.activeProjectId
  );
  const previousProject = previousState.projects.find(
    (project) => project.id === previousState.activeProjectId
  );
  if (
    state.activeProjectId !== previousState.activeProjectId ||
    activeProject?.root_path !== previousProject?.root_path
  ) {
    useProjectFilesStore.getState().syncActiveProject();
  }
});
