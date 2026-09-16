import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DatabaseExplorerStore } from "./contracts";
import { createExplorerGroupActions } from "./groupActions";
import { createExplorerLifecycleActions } from "./lifecycleActions";
import { createExplorerPreferenceActions } from "./preferenceActions";
import { createExplorerVisibilityActions } from "./visibilityActions";

export function createDatabaseExplorerStore() {
  return create<DatabaseExplorerStore>()(
    persist(
      (set) => ({
        scopes: {},
        ...createExplorerPreferenceActions(set),
        ...createExplorerVisibilityActions(set),
        ...createExplorerGroupActions(set),
        ...createExplorerLifecycleActions(set),
      }),
      {
        name: "oxide-database-explorer-state-v1",
        partialize: (state) => ({ scopes: state.scopes }),
      },
    ),
  );
}
