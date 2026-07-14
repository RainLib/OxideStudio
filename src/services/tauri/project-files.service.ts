import { invokeRawCommand } from "./client";
import type { Project } from "./store.service";
import { ApiError } from "./types";

export type ProjectEntryKind = "file" | "directory";

export interface ProjectFileEntry {
  relativePath: string;
  name: string;
  kind: ProjectEntryKind;
  size: number;
  modifiedAt: number | null;
  isSymlink: boolean;
}

export interface ProjectFileRead {
  relativePath: string;
  content: string;
  revision: string;
}

export interface ProjectFilePreview {
  relativePath: string;
  mediaType: string;
  dataBase64: string;
  revision: string;
  size: number;
}

export interface ProjectFileWriteResult {
  relativePath: string;
  revision: string;
}

export interface ProjectCompletionSnippet {
  relativePath: string;
  content: string;
}

export class ProjectFileRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(
    readonly relativePath: string,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ProjectFileRevisionConflictError";
  }
}

export function isProjectFileRevisionConflict(
  error: unknown,
): error is ProjectFileRevisionConflictError {
  return (
    error instanceof ProjectFileRevisionConflictError ||
    (error instanceof ApiError && error.code === "REVISION_CONFLICT")
  );
}

/**
 * Convert a project entry path to the portable representation used by the IPC
 * contract. Project roots are configured separately and are the only absolute
 * paths accepted by this service.
 */
export function normalizeProjectRelativePath(
  value: string,
  options: { allowEmpty?: boolean } = {},
): string {
  if (value.includes("\0")) {
    throw new Error("Project paths cannot contain a null byte");
  }

  // Reject both Windows and POSIX absolute paths before normalizing separators.
  if (
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    throw new Error(`Project path must be relative: ${value}`);
  }

  const segments: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      throw new Error(`Project path cannot leave the project root: ${value}`);
    }
    segments.push(segment);
  }

  const normalized = segments.join("/");
  if (!normalized && !options.allowEmpty) {
    throw new Error("Project path is required");
  }
  return normalized;
}

function requireProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized) throw new Error("Project id is required");
  return normalized;
}

function expectedRootArgument(expectedRoot?: string | null) {
  return expectedRoot ? { expectedRoot } : {};
}

function normalizeEntry(entry: ProjectFileEntry): ProjectFileEntry {
  return {
    ...entry,
    relativePath: normalizeProjectRelativePath(entry.relativePath),
  };
}

function normalizeRead(result: ProjectFileRead): ProjectFileRead {
  return {
    ...result,
    relativePath: normalizeProjectRelativePath(result.relativePath),
  };
}

function normalizePreview(result: ProjectFilePreview): ProjectFilePreview {
  return {
    ...result,
    relativePath: normalizeProjectRelativePath(result.relativePath),
  };
}

const PROJECT_IMAGE_PREVIEW_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "avif",
]);

export function supportsProjectFilePreview(relativePath: string): boolean {
  const name = relativePath.split("/").pop() || relativePath;
  const dot = name.lastIndexOf(".");
  return (
    dot >= 0 &&
    PROJECT_IMAGE_PREVIEW_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
  );
}

function normalizeWrite(
  result: ProjectFileWriteResult,
): ProjectFileWriteResult {
  return {
    ...result,
    relativePath: normalizeProjectRelativePath(result.relativePath),
  };
}

export const projectFilesService = {
  getCompletionContext: async (options: {
    projectId: string;
    expectedRoot?: string | null;
    activeFile?: string;
    query: string;
    referencedObjects?: string[];
  }): Promise<ProjectCompletionSnippet[]> => {
    return await invokeRawCommand<ProjectCompletionSnippet[]>(
      "get_project_completion_context",
      {
        request: {
          projectId: requireProjectId(options.projectId),
          expectedRoot: options.expectedRoot || null,
          activeFile: options.activeFile
            ? normalizeProjectRelativePath(options.activeFile)
            : null,
          query: options.query.slice(-8_192),
          referencedObjects: options.referencedObjects || [],
        },
      },
    );
  },

  setProjectRoot: async (
    projectId: string,
    rootPath: string | null,
  ): Promise<Project> => {
    return await invokeRawCommand("set_project_root", {
      projectId: requireProjectId(projectId),
      rootPath: rootPath && rootPath.length > 0 ? rootPath : null,
    });
  },

  listProjectEntries: async (
    projectId: string,
    relativePath = "",
    expectedRoot?: string | null,
  ): Promise<ProjectFileEntry[]> => {
    const normalizedPath = normalizeProjectRelativePath(relativePath, {
      allowEmpty: true,
    });
    const entries = await invokeRawCommand<ProjectFileEntry[]>(
      "list_project_entries",
      {
        projectId: requireProjectId(projectId),
        relativePath: normalizedPath || null,
        ...expectedRootArgument(expectedRoot),
      },
    );
    return entries.map(normalizeEntry);
  },

  readProjectFile: async (
    projectId: string,
    relativePath: string,
    expectedRoot?: string | null,
  ): Promise<ProjectFileRead> => {
    const result = await invokeRawCommand<ProjectFileRead>(
      "read_project_file",
      {
        projectId: requireProjectId(projectId),
        relativePath: normalizeProjectRelativePath(relativePath),
        ...expectedRootArgument(expectedRoot),
      },
    );
    return normalizeRead(result);
  },

  readProjectFilePreview: async (
    projectId: string,
    relativePath: string,
    expectedRoot?: string | null,
  ): Promise<ProjectFilePreview> => {
    const result = await invokeRawCommand<ProjectFilePreview>(
      "read_project_file_preview",
      {
        projectId: requireProjectId(projectId),
        relativePath: normalizeProjectRelativePath(relativePath),
        ...expectedRootArgument(expectedRoot),
      },
    );
    return normalizePreview(result);
  },

  createProjectFile: async (
    projectId: string,
    relativePath: string,
    content = "",
    expectedRoot?: string | null,
  ): Promise<ProjectFileWriteResult> => {
    const result = await invokeRawCommand<ProjectFileWriteResult>(
      "create_project_file",
      {
        projectId: requireProjectId(projectId),
        relativePath: normalizeProjectRelativePath(relativePath),
        content,
        ...expectedRootArgument(expectedRoot),
      },
    );
    return normalizeWrite(result);
  },

  createProjectDirectory: async (
    projectId: string,
    relativePath: string,
    expectedRoot?: string | null,
  ): Promise<ProjectFileEntry> => {
    const result = await invokeRawCommand<ProjectFileEntry>(
      "create_project_directory",
      {
        projectId: requireProjectId(projectId),
        relativePath: normalizeProjectRelativePath(relativePath),
        ...expectedRootArgument(expectedRoot),
      },
    );
    return normalizeEntry(result);
  },

  writeProjectFile: async (
    projectId: string,
    relativePath: string,
    content: string,
    expectedRevision: string,
    expectedRoot?: string | null,
  ): Promise<ProjectFileWriteResult> => {
    const normalizedPath = normalizeProjectRelativePath(relativePath);
    try {
      const result = await invokeRawCommand<ProjectFileWriteResult>(
        "write_project_file",
        {
          projectId: requireProjectId(projectId),
          relativePath: normalizedPath,
          content,
          expectedRevision,
          ...expectedRootArgument(expectedRoot),
        },
      );
      return normalizeWrite(result);
    } catch (error) {
      if (error instanceof ApiError && error.code === "REVISION_CONFLICT") {
        throw new ProjectFileRevisionConflictError(
          normalizedPath,
          error.message,
          error,
        );
      }
      throw error;
    }
  },

  renameProjectEntry: async (
    projectId: string,
    relativePath: string,
    newRelativePath: string,
    expectedRoot?: string | null,
  ): Promise<ProjectFileEntry> => {
    const result = await invokeRawCommand<ProjectFileEntry>(
      "rename_project_entry",
      {
        projectId: requireProjectId(projectId),
        relativePath: normalizeProjectRelativePath(relativePath),
        newRelativePath: normalizeProjectRelativePath(newRelativePath),
        ...expectedRootArgument(expectedRoot),
      },
    );
    return normalizeEntry(result);
  },

  deleteProjectEntry: async (
    projectId: string,
    relativePath: string,
    recursive = false,
    expectedRoot?: string | null,
  ): Promise<void> => {
    await invokeRawCommand("delete_project_entry", {
      projectId: requireProjectId(projectId),
      relativePath: normalizeProjectRelativePath(relativePath),
      recursive,
      ...expectedRootArgument(expectedRoot),
    });
  },
};
