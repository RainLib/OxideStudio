import {
  moveSideToolWindow,
  type SideToolWindowId,
} from "@/lib/workbenchLayout";
import type {
  PinnableTitleToolId,
  WorkbenchSide,
} from "@/lib/appSettings";
import type { ResizeDirection, WorkbenchLayoutState } from "./contracts";
import {
  bottomPanelMaximumHeight,
  clampLayoutDimension,
} from "./layoutMath";
import {
  currentWorkbenchSettings,
  saveWorkbenchSettings,
  updateWorkbenchLayout,
} from "./settingsRuntime";

const RESIZE_DELTA = 24;

export function createWorkbenchLayoutActions() {
  return {
    setLeftWidth: (width: number) =>
      updateWorkbenchLayout({ leftWidth: clampLayoutDimension(width, 240, 760) }),
    setRightWidth: (width: number) =>
      updateWorkbenchLayout({ rightWidth: clampLayoutDimension(width, 260, 640) }),
    setBottomHeight: (height: number) =>
      updateWorkbenchLayout({
        bottomHeight: clampLayoutDimension(height, 140, bottomPanelMaximumHeight()),
      }),

    moveToolWindow: (id: SideToolWindowId, side: WorkbenchSide) => {
      const workbench = currentWorkbenchSettings();
      saveWorkbenchSettings(moveSideToolWindow(workbench, id, side));
    },

    moveActiveToolWindow: (side: WorkbenchSide) => {
      const workbench = currentWorkbenchSettings();
      const activeToolWindow = workbench.layout.activeToolWindow;
      if (activeToolWindow === "editor" || activeToolWindow === "results") {
        return;
      }
      saveWorkbenchSettings(
        moveSideToolWindow(workbench, activeToolWindow, side),
      );
    },

    setTitleToolPinned: (id: PinnableTitleToolId, pinned: boolean) => {
      const workbench = currentWorkbenchSettings();
      const pinnedTitleTools = workbench.layout.pinnedTitleTools.filter(
        (candidate) => candidate !== id,
      );
      if (pinned) pinnedTitleTools.push(id);
      saveWorkbenchSettings({
        ...workbench,
        layout: {
          ...workbench.layout,
          pinnedTitleTools,
        },
      });
    },

    resizeActiveToolWindow: (direction: ResizeDirection) => {
      const workbench = currentWorkbenchSettings();
      const layout = workbench.layout;
      if (layout.activeToolWindow !== "editor" && layout.activeToolWindow !== "results") {
        const side = workbench.toolWindows[layout.activeToolWindow].side;
        if (side === "left") {
          updateWorkbenchLayout({
            leftWidth: clampLayoutDimension(
              layout.leftWidth +
                (direction === "right"
                  ? RESIZE_DELTA
                  : direction === "left"
                    ? -RESIZE_DELTA
                    : 0),
              240,
              760,
            ),
          });
          return;
        }
        updateWorkbenchLayout({
          rightWidth: clampLayoutDimension(
            layout.rightWidth +
              (direction === "left"
                ? RESIZE_DELTA
                : direction === "right"
                  ? -RESIZE_DELTA
                  : 0),
            260,
            640,
          ),
        });
        return;
      }
      if (layout.activeToolWindow === "results") {
        updateWorkbenchLayout({
          bottomHeight: clampLayoutDimension(
            layout.bottomHeight +
              (direction === "up"
                ? RESIZE_DELTA
                : direction === "down"
                  ? -RESIZE_DELTA
                  : 0),
            140,
            bottomPanelMaximumHeight(),
          ),
        });
      }
    },
  } satisfies Pick<
    WorkbenchLayoutState,
    | "setLeftWidth"
    | "setRightWidth"
    | "setBottomHeight"
    | "moveToolWindow"
    | "moveActiveToolWindow"
    | "setTitleToolPinned"
    | "resizeActiveToolWindow"
  >;
}
