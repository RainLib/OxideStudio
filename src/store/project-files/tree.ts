import type { ProjectFileEntry } from "@/services/tauri/project-files.service";

export interface ProjectFileTreeNode extends ProjectFileEntry {
  children?: ProjectFileTreeNode[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
}

export type ProjectFileTreeState = {
  entriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: string[];
  loadingDirectories: string[];
};

function hasDirectoryListing(
  entriesByDirectory: Record<string, ProjectFileEntry[]>,
  relativePath: string,
) {
  return Object.prototype.hasOwnProperty.call(entriesByDirectory, relativePath);
}

function buildTree(
  state: ProjectFileTreeState,
  directoryPath: string,
  visited: Set<string>,
): ProjectFileTreeNode[] {
  if (visited.has(directoryPath)) return [];
  const nextVisited = new Set(visited).add(directoryPath);
  return (state.entriesByDirectory[directoryPath] || []).map((entry) => {
    const isDirectory = entry.kind === "directory";
    const isExpanded =
      isDirectory && state.expandedDirectories.includes(entry.relativePath);
    const isLoaded =
      isDirectory && hasDirectoryListing(state.entriesByDirectory, entry.relativePath);
    return {
      ...entry,
      isExpanded,
      isLoaded,
      isLoading: isDirectory && state.loadingDirectories.includes(entry.relativePath),
      children:
        isExpanded && isLoaded
          ? buildTree(state, entry.relativePath, nextVisited)
          : undefined,
    };
  });
}

export function selectProjectFileTree(
  state: ProjectFileTreeState,
): ProjectFileTreeNode[] {
  return buildTree(state, "", new Set());
}
