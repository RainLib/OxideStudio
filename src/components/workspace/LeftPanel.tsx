import React from "react";
import type { WorkbenchSide } from "@/lib/appSettings";
import { SchemaSidebar } from "./SchemaSidebar";
import { SideToolWindow } from "./SideToolWindow";

export type SidebarTab = "tables" | "history" | "saved" | "settings";

interface LeftPanelProps {
  activeTab?: SidebarTab | null;
  onTabClick?: (tab: SidebarTab) => void;
  isDrawerOpen: boolean;
  sidebarWidth: number;
  side?: WorkbenchSide;
  onDragStart: (e: React.MouseEvent) => void;
  isActive?: boolean;
  onFocusPanel?: () => void;
}

export function LeftPanel(props: LeftPanelProps) {
  return (
    <SideToolWindow
      side={props.side ?? "left"}
      isOpen={props.isDrawerOpen}
      width={props.sidebarWidth}
      isActive={props.isActive}
      onFocus={props.onFocusPanel}
      onDragStart={props.onDragStart}
    >
      <SchemaSidebar />
    </SideToolWindow>
  );
}
