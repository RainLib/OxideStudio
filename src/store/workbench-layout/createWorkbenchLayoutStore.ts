import { create } from "zustand";
import type { WorkbenchLayoutState } from "./contracts";
import { createWorkbenchLayoutActions } from "./layoutActions";
import { createWorkbenchSessionActions } from "./sessionActions";
import { createWorkbenchVisibilityActions } from "./visibilityActions";

export function createWorkbenchLayoutStore() {
  return create<WorkbenchLayoutState>((set, get) => ({
    lastToolWindow: "databaseExplorer",
    hiddenToolWindowLayout: null,
    ...createWorkbenchVisibilityActions(set),
    ...createWorkbenchLayoutActions(),
    ...createWorkbenchSessionActions(set, get),
  }));
}
