import { SideToolWindow } from "@/components/workspace/SideToolWindow";
import { ToolWindowPanel } from "@/components/workspace/ToolWindowPanel";
import type {
  AppSettings,
  SideToolWindowId,
  WorkbenchSide,
  WorkbenchToolWindowId,
} from "@/features/settings/model/settingsTypes";
import { ToolWindowFallback } from "@/features/workbench/ui/WorkbenchFallbacks";
import { LeftPanel } from "@/features/workbench/ui/WorkbenchLazySurfaces";
import { Suspense, type MouseEvent as ReactMouseEvent } from "react";

interface CreateSideToolWindowRendererContext {
  layout: AppSettings["workbench"]["layout"];
  handleSideDragStart: (
    event: React.MouseEvent<Element, MouseEvent>,
    side: WorkbenchSide,
    id: SideToolWindowId,
  ) => void;
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
}

export function createSideToolWindowRenderer({
  layout,
  handleSideDragStart,
  setActiveToolWindow,
}: CreateSideToolWindowRendererContext) {
  const renderSideToolWindow = (
    id: SideToolWindowId | null,
    side: WorkbenchSide,
  ) => {
    const width = side === "left" ? layout.leftWidth : layout.rightWidth;
    const isOpen = id !== null;
    if (!id) {
      return <ToolWindowFallback side={side} isOpen={false} width={width} />;
    }
    const isActive = layout.activeToolWindow === id;
    const handleDragStart = (event: ReactMouseEvent) =>
      handleSideDragStart(event, side, id);

    if (id === "databaseExplorer") {
      return (
        <Suspense
          key={id}
          fallback={
            <ToolWindowFallback side={side} isOpen={isOpen} width={width} />
          }
        >
          <LeftPanel
            side={side}
            isDrawerOpen={isOpen}
            sidebarWidth={width}
            onDragStart={handleDragStart}
            isActive={isActive}
            onFocusPanel={() => setActiveToolWindow(id)}
          />
        </Suspense>
      );
    }

    return (
      <SideToolWindow
        key={id}
        side={side}
        isOpen={isOpen}
        width={width}
        isActive={isActive}
        onFocus={() => setActiveToolWindow(id)}
        onDragStart={handleDragStart}
      >
        {isOpen ? <ToolWindowPanel id={id} /> : null}
      </SideToolWindow>
    );
  };

  return { renderSideToolWindow };
}
