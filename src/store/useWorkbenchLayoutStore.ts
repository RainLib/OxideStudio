import { create } from "zustand";
import type {
  AppSettings,
  WorkbenchSide,
  WorkbenchToolWindowId,
} from "@/lib/appSettings";
import {
  moveSideToolWindow,
  type SideToolWindowId,
} from "@/lib/workbenchLayout";
import { useSettingsStore } from "@/store/useSettingsStore";

type ResizeDirection = "left" | "right" | "up" | "down";
type WorkbenchLayoutSettings = AppSettings["workbench"]["layout"];

type WorkbenchLayoutState = {
  toggleToolWindow: (id: WorkbenchToolWindowId) => void;
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setBottomHeight: (height: number) => void;
  moveToolWindow: (id: SideToolWindowId, side: WorkbenchSide) => void;
  moveActiveToolWindow: (side: WorkbenchSide) => void;
  resizeActiveToolWindow: (direction: ResizeDirection) => void;
};

export const useWorkbenchLayoutStore = create<WorkbenchLayoutState>(() => ({
  toggleToolWindow: (id) => {
    const settingsStore = useSettingsStore.getState();
    const layout = settingsStore.settings.workbench.layout;
    const visible = visibilityForToolWindow(layout, id);
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
      activeToolWindow !== "databaseExplorer" &&
      activeToolWindow !== "assistant"
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

  resizeActiveToolWindow: (direction) => {
    const settingsStore = useSettingsStore.getState();
    const layout = settingsStore.settings.workbench.layout;
    const delta = 24;
    if (
      layout.activeToolWindow === "databaseExplorer" ||
      layout.activeToolWindow === "assistant"
    ) {
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
