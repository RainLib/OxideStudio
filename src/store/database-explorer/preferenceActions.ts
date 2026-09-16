import type {
  DatabaseExplorerSet,
  DatabaseExplorerStore,
} from "./contracts";
import { uniqueExplorerIds, updateExplorerScope } from "./state";

type PreferenceActions = Pick<
  DatabaseExplorerStore,
  | "updateExpanded"
  | "setSelection"
  | "setViewMode"
  | "setFilterScope"
  | "setConnectionSortMode"
  | "setConnectionOrder"
  | "setSearchMode"
  | "setRegexSearch"
>;

export function createExplorerPreferenceActions(
  set: DatabaseExplorerSet,
): PreferenceActions {
  return {
    updateExpanded: (scopeId, bucket, update) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
          const current = scope.expanded[bucket] ?? [];
          const next = uniqueExplorerIds(
            typeof update === "function" ? update([...current]) : update,
          );
          if (
            next.length === current.length &&
            next.every((value, index) => value === current[index])
          ) {
            return scope;
          }
          return { ...scope, expanded: { ...scope.expanded, [bucket]: next } };
        }),
      ),
    setSelection: (scopeId, nodeIds, focusedNodeId, anchorNodeId) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
          const selection = uniqueExplorerIds(nodeIds);
          const lastSelection = selection[selection.length - 1] ?? null;
          return {
            ...scope,
            selectedNodeIds: selection,
            focusedNodeId:
              focusedNodeId === undefined ? lastSelection : focusedNodeId,
            selectionAnchorId:
              anchorNodeId === undefined ? lastSelection : anchorNodeId,
          };
        }),
      ),
    setViewMode: (scopeId, viewMode) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => ({ ...scope, viewMode })),
      ),
    setFilterScope: (scopeId, filterScope) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => ({
          ...scope,
          filterScope,
        })),
      ),
    setConnectionSortMode: (scopeId, connectionSortMode) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => ({
          ...scope,
          connectionSortMode,
        })),
      ),
    setConnectionOrder: (scopeId, connectionIds) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => ({
          ...scope,
          connectionOrder: uniqueExplorerIds(connectionIds),
        })),
      ),
    setSearchMode: (scopeId, searchMode) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => ({
          ...scope,
          searchMode,
        })),
      ),
    setRegexSearch: (scopeId, regexSearch) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => ({
          ...scope,
          regexSearch,
        })),
      ),
  };
}
