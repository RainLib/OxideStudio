import { useState } from "react";
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

export function Workspace() {
  const { tabs, activeTabId } = useTabStore();
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
        {/* Unified Left Panel */}
        <LeftPanel
          activeTab={activeSidebarTab}
          onTabClick={handleActivityBarClick}
          isDrawerOpen={isLeftDrawerOpen}
          sidebarWidth={sidebarWidth}
          onDragStart={handleDragStart}
        />

        {/* Main Content Area + Right Panel with Unified Bottom StatusBar */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top: Content Areas */}
          <div className="flex flex-1 min-h-0">
            {/* Main Editor Area */}
            <div className="flex-1 min-w-0">
              {tabs.length === 0 ? (
                <QueryShortcuts />
              ) : (
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
                          className="!flex-col"
                          style={{ flexDirection: "column" }}
                        >
                          <ResizablePanel defaultSize={50} minSize={20}>
                            <QueryEditor />
                          </ResizablePanel>
                          <ResizableHandle
                            withHandle
                            className="h-1.5 w-full bg-[#333] hover:bg-orange-500 transition-colors z-50 cursor-row-resize"
                          />
                          <ResizablePanel defaultSize={50} minSize={20}>
                            {currentResult ? <DataGrid /> : <QueryShortcuts />}
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Panel */}
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

          {/* Bottom: Unified EditorStatusBar spanning entire width */}
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
  );
}
