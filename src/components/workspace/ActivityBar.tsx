import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Database, Clock, Settings, Code, Hexagon } from "lucide-react";
import { SidebarStatusBar } from "./SidebarStatusBar";

export type SidebarTab = "tables" | "history" | "saved" | "settings";

interface ActivityBarProps {
  activeTab: SidebarTab | null;
  onTabClick: (tab: SidebarTab) => void;
  isDrawerOpen: boolean;
}

export function ActivityBar({
  activeTab,
  onTabClick,
  isDrawerOpen,
}: ActivityBarProps) {
  return (
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

      {/* Bottom Status Bar - only shows when sidebar is closed */}
      {!isDrawerOpen && <SidebarStatusBar isDrawerOpen={false} />}
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
