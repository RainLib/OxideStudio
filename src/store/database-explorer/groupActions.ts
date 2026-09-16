import { placeExplorerConnectionGroup } from "@/features/database-explorer/model/explorerGroupOrder";
import type {
  DatabaseExplorerSet,
  DatabaseExplorerStore,
} from "./contracts";
import { createExplorerGroupId, updateExplorerScope } from "./state";

type GroupActions = Pick<
  DatabaseExplorerStore,
  | "createConnectionGroup"
  | "renameConnectionGroup"
  | "deleteConnectionGroup"
  | "moveConnectionsToGroup"
  | "moveConnectionGroup"
  | "placeConnectionGroup"
>;

export function createExplorerGroupActions(
  set: DatabaseExplorerSet,
): GroupActions {
  return {
    createConnectionGroup: (scopeId, name, parentId = null) => {
      const id = createExplorerGroupId();
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => ({
          ...scope,
          connectionGroups: [
            ...(scope.connectionGroups ?? []),
            { id, name: name.trim() || "New Group", parentId },
          ],
        })),
      );
      return id;
    },
    renameConnectionGroup: (scopeId, groupId, name) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
          const nextName = name.trim();
          if (!nextName) return scope;
          return {
            ...scope,
            connectionGroups: (scope.connectionGroups ?? []).map((group) =>
              group.id === groupId ? { ...group, name: nextName } : group,
            ),
          };
        }),
      ),
    deleteConnectionGroup: (scopeId, groupId) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
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
            ...scope,
            connectionGroups: (scope.connectionGroups ?? []).filter(
              (group) => !deletedIds.has(group.id),
            ),
            connectionGroupIds: Object.fromEntries(
              Object.entries(scope.connectionGroupIds ?? {}).filter(
                ([, assignedGroupId]) => !deletedIds.has(assignedGroupId),
              ),
            ),
          };
        }),
      ),
    moveConnectionsToGroup: (scopeId, connectionIds, groupId) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
          const assignments = { ...(scope.connectionGroupIds ?? {}) };
          for (const connectionId of connectionIds) {
            if (groupId) assignments[connectionId] = groupId;
            else delete assignments[connectionId];
          }
          return { ...scope, connectionGroupIds: assignments };
        }),
      ),
    moveConnectionGroup: (scopeId, groupId, parentId) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
          const groups = scope.connectionGroups ?? [];
          if (!groups.some((group) => group.id === groupId)) return scope;
          if (parentId && !groups.some((group) => group.id === parentId)) {
            return scope;
          }
          let ancestorId = parentId;
          const visited = new Set<string>();
          while (ancestorId && !visited.has(ancestorId)) {
            if (ancestorId === groupId) return scope;
            visited.add(ancestorId);
            ancestorId =
              groups.find((group) => group.id === ancestorId)?.parentId ?? null;
          }
          return {
            ...scope,
            connectionGroups: groups.map((group) =>
              group.id === groupId ? { ...group, parentId } : group,
            ),
          };
        }),
      ),
    placeConnectionGroup: (scopeId, groupId, targetGroupId, placement) =>
      set((state) =>
        updateExplorerScope(state, scopeId, (scope) => {
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
            return scope;
          }
          return { ...scope, connectionGroups };
        }),
      ),
  };
}
