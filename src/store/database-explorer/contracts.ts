import type { ExplorerGroupDropPlacement } from "@/features/database-explorer/model/explorerGroupOrder";
import type { ExplorerVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import type { SetStateAction } from "react";
import type { StoreApi } from "zustand";

export type ExplorerExpansionBucket =
  | "connections"
  | "databases"
  | "schemas"
  | "groups"
  | "objects";
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

export type ExplorerStringListUpdate = SetStateAction<string[]>;

export interface DatabaseExplorerStore {
  scopes: Record<string, DatabaseExplorerScopeState>;
  updateExpanded: (
    scopeId: string,
    bucket: ExplorerExpansionBucket,
    update: ExplorerStringListUpdate,
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
  setConnectionOrder: (scopeId: string, connectionIds: readonly string[]) => void;
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
  renameConnectionGroup: (scopeId: string, groupId: string, name: string) => void;
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

export type DatabaseExplorerSet = StoreApi<DatabaseExplorerStore>["setState"];
