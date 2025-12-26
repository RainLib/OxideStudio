import { Button } from "@/components/ui/button";
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

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: `${totalWidth}px` }}
    >
      {/* Top section: ActivityBar + Sidebar content */}
      <div className="flex flex-1 min-h-0">
        {/* ActivityBar */}
        <div className="w-[50px] flex flex-col bg-[#1a1a1a] border-r border-[#2a2a2a] shrink-0 z-50">
          <div className="flex-1 flex flex-col items-center py-4 gap-3">
            {/* App Logo */}
            <div className="mb-2">
              <div className="h-8 w-8 bg-[#f39c12] rounded-lg flex items-center justify-center text-[#1a1a1a] shadow-lg shadow-orange-900/20">
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
                active={activeTab === "settings" && isDrawerOpen}
                onClick={() => onTabClick("settings")}
                icon={Settings}
                title="Settings"
              />
            </div>
          </div>
        </div>

        {/* Sidebar Content */}
        {isDrawerOpen && (
          <div
            className="border-r border-[#111] bg-[#1e1e1e] relative shrink-0 transition-all duration-200 flex flex-col"
            style={{ width: `${sidebarWidth}px` }}
          >
            {/* Sidebar Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {activeTab === "tables" && <SchemaSidebar />}
              {activeTab === "history" && <HistorySidebar />}
              {activeTab === "saved" && <SavedQueriesSidebar />}
              {activeTab === "settings" && (
                <div className="p-8 text-center text-gray-500 text-xs mt-10">
                  <Settings size={32} className="mx-auto mb-4 opacity-20" />
                  <p>Settings panel coming soon</p>
                </div>
              )}
              {!activeTab && (
                <div className="p-4 text-center text-gray-600 text-xs mt-10">
                  Select a tab
                </div>
              )}
            </div>

            {/* Resize Handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 bg-[#111] hover:bg-orange-500 cursor-col-resize z-50 transition-colors"
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
          ? "text-gray-100 bg-[#252525]"
          : "text-gray-500 hover:text-gray-300 hover:bg-[#252525]"
      )}
      onClick={onClick}
      title={title}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-[#f39c12] rounded-r-md shadow-[0_0_8px_rgba(243,156,18,0.4)]" />
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
