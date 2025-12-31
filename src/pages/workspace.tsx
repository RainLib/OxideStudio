import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme/useTheme";
import { TabBar } from "@/components/workspace/TabBar";
import { QueryEditor } from "@/components/workspace/QueryEditor";
import { DataGrid } from "@/components/workspace/DataGrid";
import { EditorStatusBar } from "@/components/workspace/EditorStatusBar";
import { LeftPanel, SidebarTab } from "@/components/workspace/LeftPanel";
import { TableDataView } from "@/components/workspace/TableDataView";
import { QueryShortcuts } from "@/components/workspace/QueryShortcuts";
import { AppBar } from "@/components/AppBar";
import { useTabStore } from "@/store/useTabStore";
import {
  ResizableHandle,
  ResizablePanelGroup,
  ResizablePanel,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  PanelLeft,
  PanelRight,
  PanelLeftClose,
  PanelRightClose,
  Settings2,
} from "lucide-react";

export function WorkspacePage() {
  const { mode } = useTheme();
  // const { activeConnectionId } = useConnectionStore(); // Removed unused
  const { tabs, activeTabId, createTab } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const currentResult = Array.isArray(activeTab?.results)
    ? activeTab?.results[0]
    : activeTab?.results;

  // Layout State
  const [activeSidebarTab, setActiveSidebarTab] =
    useState<SidebarTab>("tables");
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280); // Fixed pixel width

  const [isRightCollapsed, setIsRightCollapsed] = useState(true);

  // Auto-create default SQL tab on first load
  useEffect(() => {
    if (tabs.length === 0) {
      createTab("query", "Query #1", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Toggle Logic
  const handleActivityBarClick = (tab: SidebarTab) => {
    if (activeSidebarTab === tab) {
      setIsLeftDrawerOpen(!isLeftDrawerOpen);
    } else {
      setActiveSidebarTab(tab);
      if (!isLeftDrawerOpen) {
        setIsLeftDrawerOpen(true);
      }
    }
  };

  const handleDragStart = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(0, startWidth + deltaX);

      if (newWidth < 100) {
        setIsLeftDrawerOpen(false);
        setSidebarWidth(280);
      } else {
        setSidebarWidth(Math.min(newWidth, 600));
      }
    };

    const handleDragEnd = () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground font-sans overflow-hidden">
      <AppBar
        right={
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50"
              onClick={() => setIsLeftDrawerOpen(!isLeftDrawerOpen)}
              title="Toggle Left Panel"
            >
              {isLeftDrawerOpen ? (
                <PanelLeftClose size={16} />
              ) : (
                <PanelLeft size={16} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50"
              onClick={() => setIsRightCollapsed(!isRightCollapsed)}
              title="Toggle Right Panel"
            >
              {isRightCollapsed ? (
                <PanelRight size={16} />
              ) : (
                <PanelRightClose size={16} />
              )}
            </Button>
          </>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Unified Left Panel */}
        <LeftPanel
          activeTab={activeSidebarTab}
          onTabClick={handleActivityBarClick}
          isDrawerOpen={isLeftDrawerOpen}
          sidebarWidth={sidebarWidth}
          onDragStart={handleDragStart}
        />

        {/* Main Content Area + Right Panel with Unified Bottom StatusBar */}
        <div className="flex-1 flex flex-col min-w-0 bg-background/50 relative z-10">
          {/* Top: Content Areas */}
          <div className="flex flex-1 min-h-0">
            {/* Main Editor Area */}
            <div className="flex-1 min-w-0 flex flex-col">
              {tabs.length === 0 ? (
                <QueryShortcuts />
              ) : (
                <div className="flex flex-col h-full min-w-0 bg-background shadow-sm z-10">
                  {/* Main functionality area */}
                  <div className="border-b border-border/40 bg-background/95 backdrop-blur z-20">
                    <TabBar />
                  </div>

                  {activeTab?.type === "table" ? (
                    <TableDataView />
                  ) : (
                    <div className="flex flex-col h-full min-h-0 relative">
                      {/* Top: Editor */}
                      <div className="h-1/2 min-h-0 border-b border-border/40 flex flex-col">
                        <QueryEditor />
                      </div>
                      {/* Bottom: Results or Shortcuts */}
                      <div className="h-1/2 min-h-0 flex flex-col bg-muted/5 z-0">
                        {currentResult ? <DataGrid /> : <QueryShortcuts />}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Panel */}
            <div
              className={cn(
                "border-l border-border/40 bg-muted/10 shrink-0 transition-all duration-300 ease-in-out overflow-hidden flex flex-col",
                isRightCollapsed
                  ? "w-0 opacity-0 border-l-0"
                  : "w-[260px] opacity-100"
              )}
            >
              <div className="h-full flex flex-col min-w-[260px]">
                <div className="h-10 border-b border-border/40 flex items-center px-4 bg-muted/20">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Item Details
                  </span>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 text-xs p-8 text-center leading-relaxed gap-3">
                  <div className="p-4 rounded-full bg-muted/30 text-muted-foreground/40">
                    <Settings2 size={24} strokeWidth={1.5} />
                  </div>
                  <p>Select an item to view its properties</p>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: Unified EditorStatusBar */}
          <div
            className={cn(
              "h-8 w-full flex items-center border-t z-30 transition-colors duration-300",
              mode === "dark"
                ? "bg-orange-500/10 text-orange-500 border-orange-500/20"
                : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
            )}
          >
            <EditorStatusBar
              type={activeTab?.type === "table" ? "table" : "editor"}
              rowCount={currentResult?.rows?.length}
              executionTime={activeTab?.type === "table" ? undefined : 124}
              onRefresh={() => console.log("Refresh table")}
              onAdd={() => console.log("Add row")}
              onSettings={() => console.log("Table settings")}
              onStructure={() => console.log("View structure")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
