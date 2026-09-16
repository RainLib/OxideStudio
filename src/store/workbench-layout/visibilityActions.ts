import {
  closeSideToolWindow,
  openSideToolWindow,
  toggleSideToolWindow,
} from "@/lib/workbenchLayout";
import type { WorkbenchToolWindowId } from "@/lib/appSettings";
import type {
  WorkbenchLayoutSet,
  WorkbenchSettings,
} from "./contracts";
import {
  currentWorkbenchSettings,
  saveWorkbenchSettings,
} from "./settingsRuntime";

function saveResultsVisibility(
  workbench: WorkbenchSettings,
  visible: boolean,
  activeToolWindow: WorkbenchSettings["layout"]["activeToolWindow"],
) {
  saveWorkbenchSettings({
    ...workbench,
    layout: {
      ...workbench.layout,
      visibility: {
        ...workbench.layout.visibility,
        results: visible,
      },
      activeToolWindow,
    },
  });
}

export function createWorkbenchVisibilityActions(set: WorkbenchLayoutSet) {
  return {
    toggleToolWindow: (id: WorkbenchToolWindowId) => {
      const workbench = currentWorkbenchSettings();
      if (id !== "results") {
        const nextWorkbench = toggleSideToolWindow(workbench, id);
        if (nextWorkbench.layout.activeToolWindow === id) {
          set({ lastToolWindow: id, hiddenToolWindowLayout: null });
        }
        saveWorkbenchSettings(nextWorkbench);
        return;
      }
      const visible = workbench.layout.visibility.results;
      if (!visible) set({ lastToolWindow: id, hiddenToolWindowLayout: null });
      saveResultsVisibility(workbench, !visible, !visible ? id : "editor");
    },

    setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => {
      const workbench = currentWorkbenchSettings();
      if (visible) set({ lastToolWindow: id, hiddenToolWindowLayout: null });
      if (id !== "results") {
        saveWorkbenchSettings(
          visible
            ? openSideToolWindow(workbench, id)
            : closeSideToolWindow(workbench, id),
        );
        return;
      }
      saveResultsVisibility(
        workbench,
        visible,
        visible ? id : workbench.layout.activeToolWindow,
      );
    },

    setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => {
      const workbench = currentWorkbenchSettings();
      if (id !== "editor") {
        set({ lastToolWindow: id, hiddenToolWindowLayout: null });
      }
      if (id !== "editor" && id !== "results") {
        saveWorkbenchSettings(openSideToolWindow(workbench, id));
        return;
      }
      saveWorkbenchSettings({
        ...workbench,
        layout: {
          ...workbench.layout,
          activeToolWindow: id,
          visibility:
            id === "editor"
              ? workbench.layout.visibility
              : {
                  ...workbench.layout.visibility,
                  [id]: true,
                },
        },
      });
    },

    hideActiveToolWindow: () => {
      const workbench = currentWorkbenchSettings();
      const active = workbench.layout.activeToolWindow;
      if (active === "editor") return;
      set({ lastToolWindow: active, hiddenToolWindowLayout: null });
      if (active === "results") {
        saveResultsVisibility(workbench, false, "editor");
        return;
      }
      saveWorkbenchSettings(closeSideToolWindow(workbench, active));
    },
  };
}
