import type {
  ProjectFileEntry,
  ProjectFilePreview,
  ProjectFileRead,
} from "@/services/tauri/project-files.service";
import type { StoreApi } from "zustand";

export const ROOT_NOT_CONFIGURED_MESSAGE =
  "Choose a project directory before working with project files.";

export interface ProjectFileContext {
  projectId: string;
  rootPath: string | null;
}

export interface ProjectFileRevisionConflict {
  relativePath: string;
  expectedRevision: string;
  attemptedContent: string;
  message: string;
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
  readPreview: (relativePath: string) => Promise<ProjectFilePreview>;
  createFile: (
    relativePath: string,
    content?: string,
  ) => Promise<ProjectFileRead>;
  createDirectory: (relativePath: string) => Promise<ProjectFileEntry>;
  writeFile: (
    relativePath: string,
    content: string,
    expectedRevision?: string,
  ) => Promise<ProjectFileRead>;
  renameEntry: (
    relativePath: string,
    newRelativePath: string,
  ) => Promise<ProjectFileEntry>;
  deleteEntry: (relativePath: string, recursive?: boolean) => Promise<void>;
  clearError: () => void;
  clearRevisionConflict: () => void;
  reset: () => void;
}

export type ProjectFilesSet = StoreApi<ProjectFilesState>["setState"];
export type ProjectFilesGet = StoreApi<ProjectFilesState>["getState"];

export interface ProjectFilesRuntime {
  set: ProjectFilesSet;
  get: ProjectFilesGet;
  ensureActiveContext: () => ProjectFileContext;
  requireConfiguredContext: () => ProjectFileContext;
  isCurrentContext: (context: ProjectFileContext) => boolean;
  beginOperation: (directoryPath?: string) => void;
  finishOperation: (directoryPath?: string) => void;
}
