import type {
  AppSettings,
  PinnableTitleToolId,
  WorkbenchSide,
  WorkbenchToolWindowId,
} from "@/lib/appSettings";
import type { SideToolWindowId } from "@/lib/workbenchLayout";
import type { StoreApi } from "zustand";

export type ResizeDirection = "left" | "right" | "up" | "down";
export type WorkbenchLayoutSettings = AppSettings["workbench"]["layout"];
export type WorkbenchSettings = AppSettings["workbench"];

export interface WorkbenchLayoutState {
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
}

export type WorkbenchLayoutSet = StoreApi<WorkbenchLayoutState>["setState"];
export type WorkbenchLayoutGet = StoreApi<WorkbenchLayoutState>["getState"];
