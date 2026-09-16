import {
  expectedRootArgument,
  normalizeProjectRelativePath,
  requireProjectId,
} from "../project-files/path";

export function projectArguments(projectId: string, expectedRoot?: string | null) {
  return {
    projectId: requireProjectId(projectId),
    ...expectedRootArgument(expectedRoot),
  };
}

export function normalizedPaths(paths: readonly string[]) {
  if (paths.length === 0) throw new Error("Select at least one file");
  return [...new Set(paths.map((path) => normalizeProjectRelativePath(path)))];
}

export { normalizeProjectRelativePath };
