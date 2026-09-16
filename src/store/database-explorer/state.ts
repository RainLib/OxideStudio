import type {
  DatabaseExplorerScopeState,
  DatabaseExplorerStore,
  ExplorerConnectionGroup,
  ExplorerExpansionBucket,
} from "./contracts";
import type { ExplorerVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";

export const EMPTY_EXPLORER_EXPANDED: Record<
  ExplorerExpansionBucket,
  string[]
> = {
  connections: [],
  databases: [],
  schemas: [],
  groups: [],
  objects: [],
};
export const EMPTY_EXPLORER_NODE_IDS: string[] = [];
export const EMPTY_EXPLORER_CONNECTION_GROUPS: ExplorerConnectionGroup[] = [];
export const EMPTY_EXPLORER_CONNECTION_ASSIGNMENTS: Record<string, string> = {};
export const EMPTY_EXPLORER_VISIBILITY_FILTERS: Record<
  string,
  ExplorerVisibilityFilter
> = {};

export function createExplorerScopeState(): DatabaseExplorerScopeState {
  return {
    expanded: {
      connections: [],
      databases: [],
      schemas: [],
      groups: [],
      objects: [],
    },
    selectedNodeIds: [],
    focusedNodeId: null,
    selectionAnchorId: null,
    viewMode: "hierarchical",
    filterScope: "all",
    connectionSortMode: "asc",
    connectionOrder: [],
    searchMode: "global",
    regexSearch: false,
    visibilityFilters: {},
    connectionGroups: [],
    connectionGroupIds: {},
  };
}

export function updateExplorerScope(
  state: DatabaseExplorerStore,
  scopeId: string,
  update: (scope: DatabaseExplorerScopeState) => DatabaseExplorerScopeState,
) {
  const scope = state.scopes[scopeId] ?? createExplorerScopeState();
  const nextScope = update(scope);
  if (nextScope === scope) return state;
  return {
    scopes: {
      ...state.scopes,
      [scopeId]: nextScope,
    },
  };
}

export function uniqueExplorerIds(values: readonly string[]) {
  return [...new Set(values)];
}

export function createExplorerGroupId() {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
