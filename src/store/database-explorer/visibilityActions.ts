import {
  configureExplorerVisibilityPatterns,
  hideExplorerNodes,
  showOnlyExplorerNodes,
} from "@/features/database-explorer/model/explorerVisibilityFilter";
import type {
  DatabaseExplorerSet,
  DatabaseExplorerStore,
} from "./contracts";
import { updateExplorerScope } from "./state";

type VisibilityActions = Pick<
  DatabaseExplorerStore,
  | "hideNodes"
  | "showOnlyNodes"
  | "clearVisibilityFilter"
  | "setVisibilityPatterns"
>;

export function createExplorerVisibilityActions(
  set: DatabaseExplorerSet,
): VisibilityActions {
  return {
    hideNodes: (scopeId, parentNodeId, nodeIds) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
          const visibilityFilters = scope.visibilityFilters ?? {};
          return {
            ...scope,
            visibilityFilters: {
              ...visibilityFilters,
              [parentNodeId]: hideExplorerNodes(
                visibilityFilters[parentNodeId],
                nodeIds,
              ),
            },
          };
        }),
      ),
    showOnlyNodes: (scopeId, parentNodeId, nodeIds) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => ({
          ...scope,
          visibilityFilters: {
            ...(scope.visibilityFilters ?? {}),
            [parentNodeId]: showOnlyExplorerNodes(
              nodeIds,
              scope.visibilityFilters?.[parentNodeId],
            ),
          },
        })),
      ),
    clearVisibilityFilter: (scopeId, parentNodeId) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
          const visibilityFilters = { ...(scope.visibilityFilters ?? {}) };
          if (!Object.prototype.hasOwnProperty.call(visibilityFilters, parentNodeId)) {
            return scope;
          }
          delete visibilityFilters[parentNodeId];
          return { ...scope, visibilityFilters };
        }),
      ),
    setVisibilityPatterns: (
      scopeId,
      parentNodeId,
      includePatterns,
      excludePatterns,
    ) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
          const visibilityFilters = scope.visibilityFilters ?? {};
          const nextFilter = configureExplorerVisibilityPatterns(
            visibilityFilters[parentNodeId],
            includePatterns,
            excludePatterns,
          );
          const hasExactSelection =
            nextFilter.hiddenNodeIds.length > 0 || nextFilter.onlyNodeIds.length > 0;
          const hasPatterns =
            (nextFilter.includePatterns?.length ?? 0) > 0 ||
            (nextFilter.excludePatterns?.length ?? 0) > 0;
          const nextFilters = { ...visibilityFilters };
          if (hasExactSelection || hasPatterns) nextFilters[parentNodeId] = nextFilter;
          else delete nextFilters[parentNodeId];
          return { ...scope, visibilityFilters: nextFilters };
        }),
      ),
  };
}
