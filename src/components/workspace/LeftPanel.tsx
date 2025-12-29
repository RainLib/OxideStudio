import React from "react";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { cn } from "@/lib/utils";
import { Database, Clock, Settings, Code, Hexagon } from "lucide-react";
import { SchemaSidebar } from "./SchemaSidebar";
import { HistorySidebar } from "./HistorySidebar";
import { SavedQueriesSidebar } from "./SavedQueriesSidebar";
import { SidebarStatusBar } from "./SidebarStatusBar";

export type SidebarTab = "tables" | "history" | "saved" | "settings";

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
      className="flex flex-col shrink-0"
      style={{ width: `${totalWidth}px` }}
    >
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />

      {/* Top section: ActivityBar + Sidebar content */}
      <div className="flex flex-1 min-h-0">
        {/* ActivityBar */}
        <div className="w-[50px] flex flex-col bg-muted border-r border-border shrink-0 z-50">
          <div className="flex-1 flex flex-col items-center py-4 gap-3">
            {/* App Logo */}
            <div className="mb-2">
              <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                <Database size={20} strokeWidth={2.5} />
              </div>
            </div>

            {/* Navigation Items */}
            <div className="flex flex-col gap-2 w-full px-1">
              <ActivityBarButton
                active={activeTab === "tables" && isDrawerOpen}
                onClick={() => onTabClick("tables")}
                icon={Hexagon}
                title="Entities (Tables)"
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

            {/* Bottom Items */}
            <div className="mt-auto flex flex-col gap-2 w-full px-1">
              <ActivityBarButton
                active={showSettings}
                onClick={() => setShowSettings(true)}
                icon={Settings}
                title="Settings"
              />
            </div>
          </div>
        </div>

        {/* Sidebar Content */}
        {isDrawerOpen && (
          <div
            className="border-r border-border bg-card relative shrink-0 transition-all duration-200 flex flex-col"
            style={{ width: `${sidebarWidth}px` }}
          >
            {/* Sidebar Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {activeTab === "tables" && <SchemaSidebar />}
              {activeTab === "history" && <HistorySidebar />}
              {activeTab === "saved" && <SavedQueriesSidebar />}
              {/* Settings removed from here as it is now a modal */}
              {!activeTab && (
                <div className="p-4 text-center text-muted-foreground text-xs mt-10">
                  Select a tab
                </div>
              )}
            </div>

            {/* Resize Handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 bg-border hover:bg-primary cursor-col-resize z-50 transition-colors"
              onMouseDown={onDragStart}
            />
          </div>
        )}
      </div>

      {/* Bottom: Unified Status Bar spanning entire width */}
      <div style={{ width: `${totalWidth}px` }}>
        <SidebarStatusBar isDrawerOpen={isDrawerOpen} />
      </div>
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
        "relative w-full h-10 transition-all rounded-md group",
        active
          ? "text-foreground bg-accent"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
      onClick={onClick}
      title={title}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-primary rounded-r-md shadow-[0_0_8px_rgba(var(--primary),0.4)]" />
      )}
      <Icon
        size={20}
        strokeWidth={1.5}
        className={cn(
          "transition-transform group-hover:scale-105",
          active && "stroke-[2px]"
        )}
      />
    </Button>
  );
}
