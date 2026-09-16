import { invokeRawCommand } from "../client";
import type { Project } from "../store.service";
import type { ProjectFileEntry, ProjectFilePreview, ProjectFileRead, ProjectFileWriteResult } from "./contracts";
import { ApiError } from "../types";
import { expectedRootArgument, normalizeEntry, normalizePreview, normalizeProjectRelativePath, normalizeRead, normalizeWrite, ProjectFileRevisionConflictError, requireProjectId } from "./path";

export const projectFileTreeService = {
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

  deleteProjectFileIfRevision: async (
    projectId: string,
    relativePath: string,
    expectedRevision: string,
    expectedRoot?: string | null,
  ): Promise<void> => {
    const normalizedPath = normalizeProjectRelativePath(relativePath);
    try {
      await invokeRawCommand("delete_project_file_if_revision", {
        projectId: requireProjectId(projectId),
        relativePath: normalizedPath,
        expectedRevision,
        ...expectedRootArgument(expectedRoot),
      });
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
  },};
