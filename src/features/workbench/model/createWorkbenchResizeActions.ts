import type {
  AppSettings,
  WorkbenchToolWindowId,
} from "@/features/settings/model/settingsTypes";
import type { WorkbenchSide } from "@/lib/appSettings";
import { type SideToolWindowId } from "@/lib/workbenchLayout";
import { type MouseEvent as ReactMouseEvent } from "react";

interface CreateWorkbenchResizeActionsContext {
  layout: AppSettings["workbench"]["layout"];
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setBottomHeight: (height: number) => void;
}

export function createWorkbenchResizeActions({
  layout,
  setToolWindowVisible,
  setLeftWidth,
  setRightWidth,
  setBottomHeight,
}: CreateWorkbenchResizeActionsContext) {
  const handleSideDragStart = (
    event: ReactMouseEvent,
    side: WorkbenchSide,
    id: SideToolWindowId,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? layout.leftWidth : layout.rightWidth;

    const handleDrag = (moveEvent: MouseEvent) => {
      const nextWidth =
        side === "left"
          ? startWidth + moveEvent.clientX - startX
          : startWidth + startX - moveEvent.clientX;
      if (nextWidth < 160) {
        setToolWindowVisible(id, false);
      } else if (side === "left") {
        setLeftWidth(nextWidth);
      } else {
        setRightWidth(nextWidth);
      }
    };

    const handleDragEnd = () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
      document.body.style.cursor = "default";
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
    document.body.style.cursor = "col-resize";
  };

  const handleVerticalDragStart = (event: ReactMouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = layout.bottomHeight;

    const handleDrag = (moveEvent: MouseEvent) => {
      setBottomHeight(startHeight + startY - moveEvent.clientY);
    };

    const handleDragEnd = () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
      document.body.style.cursor = "default";
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
    document.body.style.cursor = "row-resize";
  };

  return { handleSideDragStart, handleVerticalDragStart };
}
