import { ApiError } from "../types";
import type { ProjectFileEntry, ProjectFilePreview, ProjectFileRead, ProjectFileWriteResult } from "./contracts";

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

export function requireProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized) throw new Error("Project id is required");
  return normalized;
}

export function expectedRootArgument(expectedRoot?: string | null) {
  return expectedRoot ? { expectedRoot } : {};
}

export function normalizeEntry(entry: ProjectFileEntry): ProjectFileEntry {
  return {
    ...entry,
    relativePath: normalizeProjectRelativePath(entry.relativePath),
  };
}

export function normalizeRead(result: ProjectFileRead): ProjectFileRead {
  return {
    ...result,
    relativePath: normalizeProjectRelativePath(result.relativePath),
  };
}

export function normalizePreview(result: ProjectFilePreview): ProjectFilePreview {
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

export function normalizeWrite(
  result: ProjectFileWriteResult,
): ProjectFileWriteResult {
  return {
    ...result,
    relativePath: normalizeProjectRelativePath(result.relativePath),
  };
}
