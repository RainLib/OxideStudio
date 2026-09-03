export interface ExplorerVisibilityFilter {
  readonly hiddenNodeIds: string[];
  readonly onlyNodeIds: string[];
  readonly includePatterns?: string[];
  readonly excludePatterns?: string[];
}

export const EMPTY_EXPLORER_VISIBILITY_FILTER: ExplorerVisibilityFilter = {
  hiddenNodeIds: [],
  onlyNodeIds: [],
  includePatterns: [],
  excludePatterns: [],
};

interface CompiledVisibilityPatterns {
  readonly includes: readonly RegExp[];
  readonly excludes: readonly RegExp[];
}

const compiledPatternCache = new WeakMap<
  ExplorerVisibilityFilter,
  CompiledVisibilityPatterns
>();

function normalizePatterns(patterns: readonly string[]) {
  return [
    ...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean)),
  ];
}

function wildcardPattern(pattern: string) {
  const escaped = pattern.replace(/[|\\{}()[\]^$+*.?]/g, (character) =>
    character === "*" ? ".*" : character === "?" ? "." : `\\${character}`,
  );
  return new RegExp(`^${escaped}$`, "iu");
}

function compiledPatterns(filter: ExplorerVisibilityFilter) {
  const cached = compiledPatternCache.get(filter);
  if (cached) return cached;
  const result = {
    includes: normalizePatterns(filter.includePatterns ?? []).map(
      wildcardPattern,
    ),
    excludes: normalizePatterns(filter.excludePatterns ?? []).map(
      wildcardPattern,
    ),
  };
  compiledPatternCache.set(filter, result);
  return result;
}

export function explorerNodePassesVisibilityFilter(
  filter: ExplorerVisibilityFilter | undefined,
  nodeId: string,
  label = nodeId,
) {
  if (!filter) return true;
  if (filter.hiddenNodeIds.includes(nodeId)) return false;
  if (filter.onlyNodeIds.length > 0 && !filter.onlyNodeIds.includes(nodeId)) {
    return false;
  }
  const patterns = compiledPatterns(filter);
  if (
    patterns.includes.length > 0 &&
    !patterns.includes.some((pattern) => pattern.test(label))
  ) {
    return false;
  }
  return !patterns.excludes.some((pattern) => pattern.test(label));
}

export function hideExplorerNodes(
  filter: ExplorerVisibilityFilter | undefined,
  nodeIds: readonly string[],
): ExplorerVisibilityFilter {
  const hidden = new Set(filter?.hiddenNodeIds ?? []);
  const only = new Set(filter?.onlyNodeIds ?? []);
  for (const nodeId of nodeIds) {
    hidden.add(nodeId);
    only.delete(nodeId);
  }
  return {
    hiddenNodeIds: [...hidden],
    onlyNodeIds: [...only],
    includePatterns: filter?.includePatterns ?? [],
    excludePatterns: filter?.excludePatterns ?? [],
  };
}

export function showOnlyExplorerNodes(
  nodeIds: readonly string[],
  filter?: ExplorerVisibilityFilter,
): ExplorerVisibilityFilter {
  return {
    hiddenNodeIds: [],
    onlyNodeIds: [...new Set(nodeIds)],
    includePatterns: filter?.includePatterns ?? [],
    excludePatterns: filter?.excludePatterns ?? [],
  };
}

export function configureExplorerVisibilityPatterns(
  filter: ExplorerVisibilityFilter | undefined,
  includePatterns: readonly string[],
  excludePatterns: readonly string[],
): ExplorerVisibilityFilter {
  return {
    hiddenNodeIds: filter?.hiddenNodeIds ?? [],
    onlyNodeIds: filter?.onlyNodeIds ?? [],
    includePatterns: normalizePatterns(includePatterns),
    excludePatterns: normalizePatterns(excludePatterns),
  };
}
