import { SchemaSidebar } from "./SchemaSidebar";
import { HistorySidebar } from "./HistorySidebar";
import { SavedQueriesSidebar } from "./SavedQueriesSidebar";
import { Settings } from "lucide-react";
import { SidebarTab } from "./ActivityBar";
import { SidebarStatusBar } from "./SidebarStatusBar";

interface SidebarProps {
  activeTab: SidebarTab | null;
  isDrawerOpen: boolean;
}

export function Sidebar({ activeTab, isDrawerOpen }: SidebarProps) {
  return (
    <div className="flex-1 flex flex-col bg-[#1e1e1e] min-w-0 overflow-hidden h-full">
      {/* Content Area */}
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

      {/* Sidebar Footer */}
      <SidebarStatusBar isDrawerOpen={isDrawerOpen} />
    </div>
  );
}
