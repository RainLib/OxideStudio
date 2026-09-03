import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  placeExplorerConnectionGroup,
  type ExplorerGroupDropPlacement,
} from "@/features/database-explorer/model/explorerGroupOrder";
import {
  configureExplorerVisibilityPatterns,
  hideExplorerNodes,
  showOnlyExplorerNodes,
  type ExplorerVisibilityFilter,
} from "@/features/database-explorer/model/explorerVisibilityFilter";

export type ExplorerExpansionBucket =
  "connections" | "databases" | "schemas" | "groups" | "objects";

export type ExplorerViewMode = "hierarchical" | "flat";
export type ExplorerFilterScope = "all" | "connections" | "objects";
export type ExplorerConnectionSortMode = "manual" | "asc" | "desc";
export type ExplorerSearchMode = "local" | "global";

export interface ExplorerConnectionGroup {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
}

export interface DatabaseExplorerScopeState {
  expanded: Record<ExplorerExpansionBucket, string[]>;
  selectedNodeIds: string[];
  focusedNodeId: string | null;
  selectionAnchorId: string | null;
  viewMode: ExplorerViewMode;
  filterScope: ExplorerFilterScope;
  connectionSortMode: ExplorerConnectionSortMode;
  connectionOrder: string[];
  searchMode: ExplorerSearchMode;
  regexSearch: boolean;
  visibilityFilters: Record<string, ExplorerVisibilityFilter>;
  connectionGroups: ExplorerConnectionGroup[];
  connectionGroupIds: Record<string, string>;
}

type StringListUpdate = SetStateAction<string[]>;

interface DatabaseExplorerStore {
  scopes: Record<string, DatabaseExplorerScopeState>;
  updateExpanded: (
    scopeId: string,
    bucket: ExplorerExpansionBucket,
    update: StringListUpdate,
  ) => void;
  setSelection: (
    scopeId: string,
    nodeIds: readonly string[],
    focusedNodeId?: string | null,
    anchorNodeId?: string | null,
  ) => void;
  setViewMode: (scopeId: string, viewMode: ExplorerViewMode) => void;
  setFilterScope: (scopeId: string, filterScope: ExplorerFilterScope) => void;
  setConnectionSortMode: (
    scopeId: string,
    sortMode: ExplorerConnectionSortMode,
  ) => void;
  setConnectionOrder: (
    scopeId: string,
    connectionIds: readonly string[],
  ) => void;
  setSearchMode: (scopeId: string, searchMode: ExplorerSearchMode) => void;
  setRegexSearch: (scopeId: string, regexSearch: boolean) => void;
  hideNodes: (
    scopeId: string,
    parentNodeId: string,
    nodeIds: readonly string[],
  ) => void;
  showOnlyNodes: (
    scopeId: string,
    parentNodeId: string,
    nodeIds: readonly string[],
  ) => void;
  clearVisibilityFilter: (scopeId: string, parentNodeId: string) => void;
  setVisibilityPatterns: (
    scopeId: string,
    parentNodeId: string,
    includePatterns: readonly string[],
    excludePatterns: readonly string[],
  ) => void;
  createConnectionGroup: (
    scopeId: string,
    name: string,
    parentId?: string | null,
  ) => string;
  renameConnectionGroup: (
    scopeId: string,
    groupId: string,
    name: string,
  ) => void;
  deleteConnectionGroup: (scopeId: string, groupId: string) => void;
  moveConnectionsToGroup: (
    scopeId: string,
    connectionIds: readonly string[],
    groupId: string | null,
  ) => void;
  moveConnectionGroup: (
    scopeId: string,
    groupId: string,
    parentId: string | null,
  ) => void;
  placeConnectionGroup: (
    scopeId: string,
    groupId: string,
    targetGroupId: string,
    placement: ExplorerGroupDropPlacement,
  ) => void;
  forgetScope: (scopeId: string) => void;
}

const EMPTY_EXPANDED: Record<ExplorerExpansionBucket, string[]> = {
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

function createScopeState(): DatabaseExplorerScopeState {
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

function explorerGroupId() {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

export const useDatabaseExplorerStore = create<DatabaseExplorerStore>()(
  persist(
    (set) => ({
      scopes: {},
      updateExpanded: (scopeId, bucket, update) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const current = scope.expanded[bucket] ?? [];
          const next = unique(
            typeof update === "function" ? update([...current]) : update,
          );
          if (
            next.length === current.length &&
            next.every((value, index) => value === current[index])
          ) {
            return state;
          }
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                expanded: { ...scope.expanded, [bucket]: next },
              },
            },
          };
        }),
      setSelection: (scopeId, nodeIds, focusedNodeId, anchorNodeId) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const selection = unique(nodeIds);
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                selectedNodeIds: selection,
                focusedNodeId:
                  focusedNodeId === undefined
                    ? (selection[selection.length - 1] ?? null)
                    : focusedNodeId,
                selectionAnchorId:
                  anchorNodeId === undefined
                    ? (selection[selection.length - 1] ?? null)
                    : anchorNodeId,
              },
            },
          };
        }),
      setViewMode: (scopeId, viewMode) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, viewMode },
            },
          };
        }),
      setFilterScope: (scopeId, filterScope) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, filterScope },
            },
          };
        }),
      setConnectionSortMode: (scopeId, connectionSortMode) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, connectionSortMode },
            },
          };
        }),
      setConnectionOrder: (scopeId, connectionIds) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                connectionOrder: unique(connectionIds),
              },
            },
          };
        }),
      setSearchMode: (scopeId, searchMode) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, searchMode },
            },
          };
        }),
      setRegexSearch: (scopeId, regexSearch) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, regexSearch },
            },
          };
        }),
      hideNodes: (scopeId, parentNodeId, nodeIds) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const visibilityFilters = scope.visibilityFilters ?? {};
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                visibilityFilters: {
                  ...visibilityFilters,
                  [parentNodeId]: hideExplorerNodes(
                    visibilityFilters[parentNodeId],
                    nodeIds,
                  ),
                },
              },
            },
          };
        }),
      showOnlyNodes: (scopeId, parentNodeId, nodeIds) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                visibilityFilters: {
                  ...(scope.visibilityFilters ?? {}),
                  [parentNodeId]: showOnlyExplorerNodes(
                    nodeIds,
                    scope.visibilityFilters?.[parentNodeId],
                  ),
                },
              },
            },
          };
        }),
      clearVisibilityFilter: (scopeId, parentNodeId) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const visibilityFilters = { ...(scope.visibilityFilters ?? {}) };
          if (
            !Object.prototype.hasOwnProperty.call(
              visibilityFilters,
              parentNodeId,
            )
          ) {
            return state;
          }
          delete visibilityFilters[parentNodeId];
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, visibilityFilters },
            },
          };
        }),
      setVisibilityPatterns: (
        scopeId,
        parentNodeId,
        includePatterns,
        excludePatterns,
      ) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const visibilityFilters = scope.visibilityFilters ?? {};
          const nextFilter = configureExplorerVisibilityPatterns(
            visibilityFilters[parentNodeId],
            includePatterns,
            excludePatterns,
          );
          const hasExactSelection =
            nextFilter.hiddenNodeIds.length > 0 ||
            nextFilter.onlyNodeIds.length > 0;
          const hasPatterns =
            (nextFilter.includePatterns?.length ?? 0) > 0 ||
            (nextFilter.excludePatterns?.length ?? 0) > 0;
          const nextFilters = { ...visibilityFilters };
          if (hasExactSelection || hasPatterns) {
            nextFilters[parentNodeId] = nextFilter;
          } else {
            delete nextFilters[parentNodeId];
          }
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, visibilityFilters: nextFilters },
            },
          };
        }),
      createConnectionGroup: (scopeId, name, parentId = null) => {
        const id = explorerGroupId();
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                connectionGroups: [
                  ...(scope.connectionGroups ?? []),
                  { id, name: name.trim() || "New Group", parentId },
                ],
              },
            },
          };
        });
        return id;
      },
      renameConnectionGroup: (scopeId, groupId, name) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const nextName = name.trim();
          if (!nextName) return state;
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                connectionGroups: (scope.connectionGroups ?? []).map((group) =>
                  group.id === groupId ? { ...group, name: nextName } : group,
                ),
              },
            },
          };
        }),
      deleteConnectionGroup: (scopeId, groupId) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const deletedIds = new Set([groupId]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const group of scope.connectionGroups ?? []) {
              if (group.parentId && deletedIds.has(group.parentId)) {
                if (!deletedIds.has(group.id)) changed = true;
                deletedIds.add(group.id);
              }
            }
          }
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                connectionGroups: (scope.connectionGroups ?? []).filter(
                  (group) => !deletedIds.has(group.id),
                ),
                connectionGroupIds: Object.fromEntries(
                  Object.entries(scope.connectionGroupIds ?? {}).filter(
                    ([, assignedGroupId]) => !deletedIds.has(assignedGroupId),
                  ),
                ),
              },
            },
          };
        }),
      moveConnectionsToGroup: (scopeId, connectionIds, groupId) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const assignments = { ...(scope.connectionGroupIds ?? {}) };
          for (const connectionId of connectionIds) {
            if (groupId) assignments[connectionId] = groupId;
            else delete assignments[connectionId];
          }
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, connectionGroupIds: assignments },
            },
          };
        }),
      moveConnectionGroup: (scopeId, groupId, parentId) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const groups = scope.connectionGroups ?? [];
          if (!groups.some((group) => group.id === groupId)) return state;
          if (parentId && !groups.some((group) => group.id === parentId)) {
            return state;
          }
          // Walking upward from the proposed parent catches both direct and
          // deep cycles without needing a separately maintained child index.
          let ancestorId = parentId;
          const visited = new Set<string>();
          while (ancestorId && !visited.has(ancestorId)) {
            if (ancestorId === groupId) return state;
            visited.add(ancestorId);
            ancestorId =
              groups.find((group) => group.id === ancestorId)?.parentId ?? null;
          }
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                connectionGroups: groups.map((group) =>
                  group.id === groupId ? { ...group, parentId } : group,
                ),
              },
            },
          };
        }),
      placeConnectionGroup: (scopeId, groupId, targetGroupId, placement) =>
        set((state) => {
          const scope = state.scopes[scopeId] ?? createScopeState();
          const groups = scope.connectionGroups ?? [];
          const connectionGroups = placeExplorerConnectionGroup(
            groups,
            groupId,
            targetGroupId,
            placement,
          );
          if (
            connectionGroups.length === groups.length &&
            connectionGroups.every(
              (group, index) =>
                group.id === groups[index]?.id &&
                group.parentId === groups[index]?.parentId,
            )
          ) {
            return state;
          }
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: { ...scope, connectionGroups },
            },
          };
        }),
      forgetScope: (scopeId) =>
        set((state) => {
          if (!(scopeId in state.scopes)) return state;
          const { [scopeId]: _removed, ...scopes } = state.scopes;
          return { scopes };
        }),
    }),
    {
      name: "oxide-database-explorer-state-v1",
      partialize: (state) => ({ scopes: state.scopes }),
    },
  ),
);

/** A useState-compatible adapter keeps legacy tree renderers working while
 * their local expansion state is moved into the shared explorer runtime. */
export function useExplorerExpansionState(
  scopeId: string,
  bucket: ExplorerExpansionBucket,
): [string[], Dispatch<StringListUpdate>] {
  const values = useDatabaseExplorerStore(
    (state) =>
      state.scopes[scopeId]?.expanded[bucket] ?? EMPTY_EXPANDED[bucket],
  );
  const updateExpanded = useDatabaseExplorerStore(
    (state) => state.updateExpanded,
  );
  const setValues = useCallback<Dispatch<StringListUpdate>>(
    (update) => updateExpanded(scopeId, bucket, update),
    [bucket, scopeId, updateExpanded],
  );
  return [values, setValues];
}

export function useExplorerExpansionSetState(
  scopeId: string,
  bucket: ExplorerExpansionBucket,
  namespace: string,
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [storedValues, setStoredValues] = useExplorerExpansionState(
    scopeId,
    bucket,
  );
  const prefix = `${namespace}\u0000`;
  const values = useMemo(
    () =>
      new Set(
        storedValues
          .filter((value) => value.startsWith(prefix))
          .map((value) => value.slice(prefix.length)),
      ),
    [prefix, storedValues],
  );
  const setValues = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (update) => {
      setStoredValues((currentStored) => {
        const currentValues = new Set(
          currentStored
            .filter((value) => value.startsWith(prefix))
            .map((value) => value.slice(prefix.length)),
        );
        const nextValues =
          typeof update === "function" ? update(currentValues) : update;
        return [
          ...currentStored.filter((value) => !value.startsWith(prefix)),
          ...[...nextValues].map((value) => `${prefix}${value}`),
        ];
      });
    },
    [prefix, setStoredValues],
  );
  return [values, setValues];
}

export function resetDatabaseExplorerStoreForTests() {
  useDatabaseExplorerStore.setState({ scopes: {} });
}
