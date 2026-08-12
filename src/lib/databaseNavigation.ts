import { create } from "zustand";

export type DatabaseObjectNavigationTarget = {
  projectId: string;
  connectionId: string;
  databaseName?: string;
  schemaName?: string;
  objectType?: string;
  objectName?: string;
};

type DatabaseObjectRevealRequest = {
  id: string;
  target: DatabaseObjectNavigationTarget;
};

type DatabaseNavigationState = {
  revealRequest: DatabaseObjectRevealRequest | null;
  revealObject: (target: DatabaseObjectNavigationTarget) => string;
  clearReveal: (requestId: string) => void;
};

export const useDatabaseNavigationStore = create<DatabaseNavigationState>(
  (set) => ({
    revealRequest: null,
    revealObject: (target) => {
      const id = `database-reveal-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      set({ revealRequest: { id, target } });
      return id;
    },
    clearReveal: (requestId) =>
      set((state) =>
        state.revealRequest?.id === requestId
          ? { revealRequest: null }
          : state
      ),
  })
);

export function requestDatabaseObjectReveal(
  target: DatabaseObjectNavigationTarget & { schemaName: string; objectName: string }
) {
  return useDatabaseNavigationStore.getState().revealObject(target);
}

export function requestDatabaseSchemaReveal(
  target: Omit<DatabaseObjectNavigationTarget, "objectName" | "objectType" | "schemaName"> & {
    schemaName: string;
  },
) {
  return useDatabaseNavigationStore.getState().revealObject(target);
}

export function requestDatabaseReveal(
  target: Pick<
    DatabaseObjectNavigationTarget,
    "projectId" | "connectionId" | "databaseName"
  >,
) {
  return useDatabaseNavigationStore.getState().revealObject(target);
}

export function databaseObjectNavigationKey(
  target: Pick<
    DatabaseObjectNavigationTarget & { objectName: string },
    "connectionId" | "databaseName" | "schemaName" | "objectName"
  >
) {
  return [
    target.connectionId,
    target.databaseName || "",
    target.schemaName || "",
    target.objectName,
  ]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function databaseSchemaNavigationKey(
  target: Pick<
    DatabaseObjectNavigationTarget,
    "connectionId" | "databaseName" | "schemaName"
  >,
) {
  return [
    target.connectionId,
    target.databaseName || "",
    target.schemaName || "",
  ]
    .map((part) => encodeURIComponent(part))
    .join(":");
}
