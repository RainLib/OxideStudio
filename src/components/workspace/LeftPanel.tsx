import React from "react";
import { cn } from "@/lib/utils";
import { SchemaSidebar } from "./SchemaSidebar";

export type SidebarTab = "tables" | "history" | "saved" | "settings";

interface LeftPanelProps {
  activeTab?: SidebarTab | null;
  onTabClick?: (tab: SidebarTab) => void;
  isDrawerOpen: boolean;
  sidebarWidth: number;
  onDragStart: (e: React.MouseEvent) => void;
}

export function LeftPanel(props: LeftPanelProps) {
  const width = props.isDrawerOpen ? props.sidebarWidth : 0;

  return (
    <div
      className={cn(
        "relative flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-150 ease-out",
        props.isDrawerOpen
          ? "wb-panel rounded-[6px] border border-[hsl(var(--wb-border-subtle))]"
          : "border-0"
      )}
      style={{ width: `${width}px` }}
    >
      {props.isDrawerOpen && (
        <>
          <SchemaSidebar />
          <div
            className="absolute right-0 top-0 bottom-0 wb-resizer-x z-50"
            onMouseDown={props.onDragStart}
          />
        </>
      )}

    </div>
  );
}
