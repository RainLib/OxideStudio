import { useState, useEffect } from "react";
import { Sidebar } from "@/components/workspace/Sidebar";
import { TabBar } from "@/components/workspace/TabBar";
import { QueryEditor } from "@/components/workspace/QueryEditor";
import { DataGrid } from "@/components/workspace/DataGrid";
import { EditorStatusBar } from "@/components/workspace/EditorStatusBar";
import { ActivityBar, SidebarTab } from "@/components/workspace/ActivityBar";
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

export function Workspace() {
  const { tabs, activeTabId, createTab } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Default tab creation if empty
  useEffect(() => {
    if (tabs.length === 0) {
      createTab("query", "Query #1", "");
    }
  }, [tabs.length, createTab]);

  const currentResult = Array.isArray(activeTab?.results)
    ? activeTab?.results[0]
    : activeTab?.results;

  // Layout State
  const [activeSidebarTab, setActiveSidebarTab] =
    useState<SidebarTab>("tables");
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280); // Fixed pixel width

  const [isRightCollapsed, setIsRightCollapsed] = useState(true);

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
    <div className="h-screen w-screen flex flex-col bg-[#131313] text-gray-200 font-sans overflow-hidden">
      <AppBar
        title="OxideStudio"
        right={
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
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
              className="h-8 w-8 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
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
        <ActivityBar
          activeTab={activeSidebarTab}
          onTabClick={handleActivityBarClick}
          isDrawerOpen={isLeftDrawerOpen}
        />

        {isLeftDrawerOpen && (
          <div
            className="border-r border-[#111] bg-[#1e1e1e] relative shrink-0 transition-all duration-200"
            style={{ width: `${sidebarWidth}px` }}
          >
            <Sidebar activeTab={activeSidebarTab} />
            <div
              className="absolute right-0 top-0 bottom-0 w-1 bg-[#111] hover:bg-orange-500 cursor-col-resize z-50 transition-colors"
              onMouseDown={handleDragStart}
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex flex-col h-full min-w-0 bg-[#1e1e1e]">
            <div className="border-b border-[#333] bg-[#1e1e1e]">
              <TabBar />
            </div>

            {activeTab?.type === "table" ? (
              <TableDataView />
            ) : (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex-1 min-h-0 relative">
                  <ResizablePanelGroup
                    direction="vertical"
                    className="flex-col"
                  >
                    <ResizablePanel defaultSize={50} minSize={20}>
                      <QueryEditor />
                    </ResizablePanel>
                    <ResizableHandle className="h-1 bg-[#333] hover:bg-orange-500 transition-colors z-50" />
                    <ResizablePanel defaultSize={50} minSize={20}>
                      {currentResult ? <DataGrid /> : <QueryShortcuts />}
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </div>

                <EditorStatusBar
                  rowCount={currentResult?.rows?.length}
                  executionTime={124}
                />
              </div>
            )}
          </div>
        </div>

        {!isRightCollapsed && (
          <div
            className="border-l border-[#111] bg-[#1a1a1a] shrink-0"
            style={{ width: "220px" }}
          >
            <div className="h-full flex flex-col">
              <div className="h-9 border-b border-[#333] flex items-center px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Details
              </div>
              <div className="flex-1 flex flex-col items-center justify-center text-gray-600 text-[11px] p-6 text-center leading-relaxed">
                <Settings2 size={32} className="opacity-20 mb-4" />
                Select an item to view its metadata and properties
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
