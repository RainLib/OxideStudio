import type {
  DatabaseExplorerSet,
  DatabaseExplorerStore,
} from "./contracts";

type LifecycleActions = Pick<DatabaseExplorerStore, "forgetScope">;

export function createExplorerLifecycleActions(
  set: DatabaseExplorerSet,
): LifecycleActions {
  return {
    forgetScope: (scopeId) =>
      set((state) => {
        if (!(scopeId in state.scopes)) return state;
        const { [scopeId]: _removed, ...scopes } = state.scopes;
        return { scopes };
      }),
  };
}
