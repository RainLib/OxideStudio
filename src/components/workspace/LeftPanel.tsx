import React from "react";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { cn } from "@/lib/utils";
import { Database, Clock, Code, Sparkles } from "lucide-react";
import { SchemaSidebar } from "./SchemaSidebar";
import { HistorySidebar } from "./HistorySidebar";
import { SavedQueriesSidebar } from "./SavedQueriesSidebar";
import { AssistantSidebar } from "./AssistantSidebar";
import { SidebarStatusBar } from "./SidebarStatusBar";
import { StatusBarLeftPortal } from "./StatusBarPortal";

export type SidebarTab =
  | "tables"
  | "assistant"
  | "history"
  | "saved"
  | "settings";

interface LeftPanelProps {
  activeTab: SidebarTab | null;
  onTabClick: (tab: SidebarTab) => void;
  isDrawerOpen: boolean;
  sidebarWidth: number;
  onDragStart: (e: React.MouseEvent) => void;
}

export function LeftPanel({
  activeTab,
  onTabClick,
  isDrawerOpen,
  sidebarWidth,
  onDragStart,
}: LeftPanelProps) {
  const totalWidth = isDrawerOpen ? 50 + sidebarWidth : 50;
  const [showSettings, setShowSettings] = React.useState(false);

  return (
    <div
      className={cn(
        "flex flex-col shrink-0 h-full transition-[width] duration-300 ease-in-out",
        // Unified background for the entire left panel (Frame)
        "bg-[#18181b] border-r border-white/5"
      )}
      style={{ width: `${totalWidth}px` }}
    >
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />

      {/* Top section: ActivityBar + Sidebar content */}
      <div className="flex flex-1 min-h-0">
        {/* ActivityBar */}
        <div className="w-[50px] flex flex-col items-center py-4 gap-4 shrink-0 z-20 bg-transparent">
          {/* Navigation Items */}
          <div className="flex flex-col gap-3 w-full px-2">
            <ActivityBarButton
              active={activeTab === "tables" && isDrawerOpen}
              onClick={() => onTabClick("tables")}
              icon={Database}
              title="Entities (Tables)"
            />
            <ActivityBarButton
              active={activeTab === "assistant" && isDrawerOpen}
              onClick={() => onTabClick("assistant")}
              icon={Sparkles}
              title="Assistant"
            />
            <ActivityBarButton
              active={activeTab === "history" && isDrawerOpen}
              onClick={() => onTabClick("history")}
              icon={Clock}
              title="History"
            />
            <ActivityBarButton
              active={activeTab === "saved" && isDrawerOpen}
              onClick={() => onTabClick("saved")}
              icon={Code}
              title="Saved Queries"
            />
          </div>
        </div>

        {/* Sidebar Content */}
        {isDrawerOpen && (
          <div
            className="border-r border-white/5 relative shrink-0 flex flex-col overflow-hidden"
            style={{ width: `${sidebarWidth}px` }}
          >
            {/* Sidebar Content Area */}
            <div className="flex-1 h-full min-w-0 flex flex-col">
              {activeTab === "tables" && <SchemaSidebar />}
              {activeTab === "assistant" && <AssistantSidebar />}
              {activeTab === "history" && <HistorySidebar />}
              {activeTab === "saved" && <SavedQueriesSidebar />}
              {!activeTab && (
                <div className="flex-1 flex items-center justify-center p-4 text-center text-muted-foreground text-xs">
                  <span className="opacity-50">Select a section</span>
                </div>
              )}
            </div>

            {/* Resize Handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-[3px] hover:w-[4px] bg-transparent hover:bg-primary/50 cursor-col-resize z-50 transition-all flex items-center justify-center group"
              onMouseDown={onDragStart}
            >
              <div className="w-px h-8 bg-border group-hover:bg-primary transition-colors delay-75" />
            </div>
          </div>
        )}
      </div>

      {/* Status Bar via Portal to unified bottom bar */}
      <StatusBarLeftPortal>
        <SidebarStatusBar isDrawerOpen={isDrawerOpen} width={totalWidth} />
      </StatusBarLeftPortal>
    </div>
  );
}

function ActivityBarButton({
  active,
  onClick,
  icon: Icon,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  title: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative w-full h-9 transition-all rounded-lg group",
        active
          ? "text-primary bg-primary/10 shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
      onClick={onClick}
      title={title}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-primary rounded-r-full" />
      )}
      <Icon
        size={18}
        strokeWidth={2}
        className={cn(
          "transition-transform duration-300 group-active:scale-95",
          active ? "scale-100" : "opacity-80 group-hover:opacity-100"
        )}
      />
    </Button>
  );
}
