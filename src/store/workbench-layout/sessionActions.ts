import type {
  WorkbenchLayoutGet,
  WorkbenchLayoutSet,
  WorkbenchLayoutSettings,
  WorkbenchLayoutState,
} from "./contracts";
import {
  currentWorkbenchSettings,
  saveWorkbenchSettings,
} from "./settingsRuntime";

export function createWorkbenchSessionActions(
  set: WorkbenchLayoutSet,
  get: WorkbenchLayoutGet,
) {
  return {
    toggleAllToolWindows: () => {
      const workbench = currentWorkbenchSettings();
      const layout = workbench.layout;
      const hasVisibleToolWindow = Object.values(layout.visibility).some(Boolean);
      const hiddenToolWindowLayout = get().hiddenToolWindowLayout;
      if (!hasVisibleToolWindow && hiddenToolWindowLayout) {
        const restoredLayout = hiddenToolWindowLayout;
        set({
          hiddenToolWindowLayout: null,
          lastToolWindow:
            restoredLayout.activeToolWindow === "editor"
              ? get().lastToolWindow
              : restoredLayout.activeToolWindow,
        });
        saveWorkbenchSettings({ ...workbench, layout: restoredLayout });
        return;
      }
      if (!hasVisibleToolWindow) return;
      set({
        hiddenToolWindowLayout: layout,
        lastToolWindow:
          layout.activeToolWindow === "editor"
            ? get().lastToolWindow
            : layout.activeToolWindow,
      });
      saveWorkbenchSettings({
        ...workbench,
        layout: {
          ...layout,
          visibility: Object.fromEntries(
            Object.keys(layout.visibility).map((id) => [id, false]),
          ) as WorkbenchLayoutSettings["visibility"],
          activeToolWindow: "editor",
          activeSideToolWindows: { left: null, right: null },
        },
      });
    },

    jumpToLastToolWindow: () => {
      const active = currentWorkbenchSettings().layout.activeToolWindow;
      if (active !== "editor") {
        set({ lastToolWindow: active });
        get().setActiveToolWindow("editor");
        return;
      }
      const target = get().lastToolWindow;
      if (target) get().setActiveToolWindow(target);
    },
  } satisfies Pick<
    WorkbenchLayoutState,
    "toggleAllToolWindows" | "jumpToLastToolWindow"
  >;
}
