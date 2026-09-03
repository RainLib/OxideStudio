import { create } from "zustand";
import type {
  AppSettings,
  PinnableTitleToolId,
  WorkbenchSide,
  WorkbenchToolWindowId,
} from "@/lib/appSettings";
import {
  closeSideToolWindow,
  moveSideToolWindow,
  openSideToolWindow,
  toggleSideToolWindow,
  type SideToolWindowId,
} from "@/lib/workbenchLayout";
import { useSettingsStore } from "@/store/useSettingsStore";

type ResizeDirection = "left" | "right" | "up" | "down";
type WorkbenchLayoutSettings = AppSettings["workbench"]["layout"];

type WorkbenchLayoutState = {
  lastToolWindow: WorkbenchToolWindowId | null;
  hiddenToolWindowLayout: WorkbenchLayoutSettings | null;
  toggleToolWindow: (id: WorkbenchToolWindowId) => void;
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setBottomHeight: (height: number) => void;
  moveToolWindow: (id: SideToolWindowId, side: WorkbenchSide) => void;
  moveActiveToolWindow: (side: WorkbenchSide) => void;
  setTitleToolPinned: (id: PinnableTitleToolId, pinned: boolean) => void;
  resizeActiveToolWindow: (direction: ResizeDirection) => void;
  hideActiveToolWindow: () => void;
  toggleAllToolWindows: () => void;
  jumpToLastToolWindow: () => void;
};

export const useWorkbenchLayoutStore = create<WorkbenchLayoutState>((set, get) => ({
  lastToolWindow: "databaseExplorer",
  hiddenToolWindowLayout: null,

  toggleToolWindow: (id) => {
    const settingsStore = useSettingsStore.getState();
    if (id !== "results") {
      const nextWorkbench = toggleSideToolWindow(
        settingsStore.settings.workbench,
        id,
      );
      if (nextWorkbench.layout.activeToolWindow === id) {
        set({ lastToolWindow: id, hiddenToolWindowLayout: null });
      }
      void settingsStore.updateSettings({
        workbench: nextWorkbench,
      });
      return;
    }
    const layout = settingsStore.settings.workbench.layout;
    const visible = visibilityForToolWindow(layout, id);
    if (!visible) set({ lastToolWindow: id, hiddenToolWindowLayout: null });
    void settingsStore.updateSettings({
      workbench: {
        ...settingsStore.settings.workbench,
        layout: {
          ...layout,
          visibility: {
            ...layout.visibility,
            [id]: !visible,
          },
          activeToolWindow: !visible ? id : "editor",
        },
      },
    });
  },

  setToolWindowVisible: (id, visible) => {
    const settingsStore = useSettingsStore.getState();
    if (visible) set({ lastToolWindow: id, hiddenToolWindowLayout: null });
    if (id !== "results") {
      void settingsStore.updateSettings({
        workbench: visible
          ? openSideToolWindow(settingsStore.settings.workbench, id)
          : closeSideToolWindow(settingsStore.settings.workbench, id),
      });
      return;
    }
    const layout = settingsStore.settings.workbench.layout;
    void settingsStore.updateSettings({
      workbench: {
        ...settingsStore.settings.workbench,
        layout: {
          ...layout,
          visibility: {
            ...layout.visibility,
            [id]: visible,
          },
          activeToolWindow: visible ? id : layout.activeToolWindow,
        },
      },
    });
  },

  setActiveToolWindow: (id) => {
    const settingsStore = useSettingsStore.getState();
    if (id !== "editor") {
      set({ lastToolWindow: id, hiddenToolWindowLayout: null });
    }
    if (id !== "editor" && id !== "results") {
      void settingsStore.updateSettings({
        workbench: openSideToolWindow(settingsStore.settings.workbench, id),
      });
      return;
    }
    const layout = settingsStore.settings.workbench.layout;
    void settingsStore.updateSettings({
      workbench: {
        ...settingsStore.settings.workbench,
        layout: {
          ...layout,
          activeToolWindow: id,
          visibility:
            id === "editor"
              ? layout.visibility
              : {
                  ...layout.visibility,
                  [id]: true,
                },
        },
      },
    });
  },

  setLeftWidth: (width) => updateLayout({ leftWidth: clamp(width, 240, 760) }),
  setRightWidth: (width) => updateLayout({ rightWidth: clamp(width, 260, 640) }),
  setBottomHeight: (height) =>
    updateLayout({ bottomHeight: clamp(height, 140, window.innerHeight - 220) }),

  moveToolWindow: (id, side) => {
    const settingsStore = useSettingsStore.getState();
    const workbench = moveSideToolWindow(
      settingsStore.settings.workbench,
      id,
      side
    );
    void settingsStore.updateSettings({ workbench });
  },

  moveActiveToolWindow: (side) => {
    const settingsStore = useSettingsStore.getState();
    const activeToolWindow =
      settingsStore.settings.workbench.layout.activeToolWindow;
    if (
      activeToolWindow === "editor" || activeToolWindow === "results"
    ) {
      return;
    }
    const workbench = moveSideToolWindow(
      settingsStore.settings.workbench,
      activeToolWindow,
      side
    );
    void settingsStore.updateSettings({ workbench });
  },

  setTitleToolPinned: (id, pinned) => {
    const settingsStore = useSettingsStore.getState();
    const layout = settingsStore.settings.workbench.layout;
    const pinnedTitleTools = layout.pinnedTitleTools.filter(
      (candidate) => candidate !== id,
    );
    if (pinned) pinnedTitleTools.push(id);
    void settingsStore.updateSettings({
      workbench: {
        ...settingsStore.settings.workbench,
        layout: {
          ...layout,
          pinnedTitleTools,
        },
      },
    });
  },

  resizeActiveToolWindow: (direction) => {
    const settingsStore = useSettingsStore.getState();
    const layout = settingsStore.settings.workbench.layout;
    const delta = 24;
    if (layout.activeToolWindow !== "editor" && layout.activeToolWindow !== "results") {
      const side =
        settingsStore.settings.workbench.toolWindows[layout.activeToolWindow].side;
      if (side === "left") {
        updateLayout({
          leftWidth: clamp(
            layout.leftWidth +
              (direction === "right" ? delta : direction === "left" ? -delta : 0),
            240,
            760
          ),
        });
      } else {
        updateLayout({
          rightWidth: clamp(
            layout.rightWidth +
              (direction === "left" ? delta : direction === "right" ? -delta : 0),
            260,
            640
          ),
        });
      }
    } else if (layout.activeToolWindow === "results") {
      updateLayout({
        bottomHeight: clamp(
          layout.bottomHeight + (direction === "up" ? delta : direction === "down" ? -delta : 0),
          140,
          window.innerHeight - 220
        ),
      });
    }
  },

  hideActiveToolWindow: () => {
    const settingsStore = useSettingsStore.getState();
    const workbench = settingsStore.settings.workbench;
    const active = workbench.layout.activeToolWindow;
    if (active === "editor") return;
    set({ lastToolWindow: active, hiddenToolWindowLayout: null });
    if (active === "results") {
      const layout = workbench.layout;
      void settingsStore.updateSettings({
        workbench: {
          ...workbench,
          layout: {
            ...layout,
            visibility: { ...layout.visibility, results: false },
            activeToolWindow: "editor",
          },
        },
      });
      return;
    }
    void settingsStore.updateSettings({
      workbench: closeSideToolWindow(workbench, active),
    });
  },

  toggleAllToolWindows: () => {
    const settingsStore = useSettingsStore.getState();
    const workbench = settingsStore.settings.workbench;
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
      void settingsStore.updateSettings({
        workbench: { ...workbench, layout: restoredLayout },
      });
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
    void settingsStore.updateSettings({
      workbench: {
        ...workbench,
        layout: {
          ...layout,
          visibility: Object.fromEntries(
            Object.keys(layout.visibility).map((id) => [id, false]),
          ) as WorkbenchLayoutSettings["visibility"],
          activeToolWindow: "editor",
          activeSideToolWindows: { left: null, right: null },
        },
      },
    });
  },

  jumpToLastToolWindow: () => {
    const settingsStore = useSettingsStore.getState();
    const active = settingsStore.settings.workbench.layout.activeToolWindow;
    if (active !== "editor") {
      set({ lastToolWindow: active });
      get().setActiveToolWindow("editor");
      return;
    }
    const target = get().lastToolWindow;
    if (target) get().setActiveToolWindow(target);
  },
}));

function updateLayout(patch: Partial<WorkbenchLayoutSettings>) {
  const settingsStore = useSettingsStore.getState();
  void settingsStore.updateSettings({
    workbench: {
      ...settingsStore.settings.workbench,
      layout: {
        ...settingsStore.settings.workbench.layout,
        ...patch,
      },
    },
  });
}

function visibilityForToolWindow(
  layout: WorkbenchLayoutSettings,
  id: WorkbenchToolWindowId
) {
  return layout.visibility[id];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
