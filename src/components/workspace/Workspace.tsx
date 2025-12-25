import { useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { QueryEditor } from "./QueryEditor";
import { DataGrid } from "./DataGrid";
import { EditorStatusBar } from "./EditorStatusBar";
import { ActivityBar, SidebarTab } from "./ActivityBar";
import { AppBar } from "../AppBar";
import { useTabStore } from "@/store/useTabStore";
import {
  ResizableHandle,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Panel } from "react-resizable-panels";
import { Button } from "../ui/button";
import {
  Play,
  Save,
  PanelLeft,
  PanelRight,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";

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
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  // Toggle Logic
  const handleActivityBarClick = (tab: SidebarTab) => {
    if (activeSidebarTab === tab) {
      // Toggle visibility
      setIsLeftDrawerOpen(!isLeftDrawerOpen);
    } else {
      // Switch tab and ensure open
      setActiveSidebarTab(tab);
      if (!isLeftDrawerOpen) {
        setIsLeftDrawerOpen(true);
      }
    }
  };

  const toggleRightPanel = () => {
    const panel = rightPanelRef.current;
    if (panel) {
      if (isRightCollapsed) {
        panel.expand();
      } else {
        panel.collapse();
      }
    }
  };

  // Drag to collapse handler
  const handleDragStart = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(0, startWidth + deltaX);

      // If dragged below threshold (100px), collapse
      if (newWidth < 100) {
        setIsLeftDrawerOpen(false);
        setSidebarWidth(280); // Reset to default for next open
      } else {
        setSidebarWidth(Math.min(newWidth, 600)); // Max 600px
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
    <div className="h-screen w-screen flex flex-col bg-[#131313] text-gray-200 font-sans">
      {/* Universal AppBar */}
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

      {/* Main Flex Container: ActivityBar + Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Fixed Activity Bar */}
        <ActivityBar
          activeTab={activeSidebarTab}
          onTabClick={handleActivityBarClick}
          isDrawerOpen={isLeftDrawerOpen}
        />

        {/* Left Sidebar: Fixed Width Collapsible Drawer */}
        {isLeftDrawerOpen && (
          <div
            className="border-r border-[#111] bg-[#1e1e1e] relative shrink-0 transition-all duration-200"
            style={{ width: `${sidebarWidth}px` }}
          >
            <Sidebar activeTab={activeSidebarTab} />
            {/* Drag Handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 bg-[#111] hover:bg-[#f39c12] cursor-col-resize z-50 transition-colors"
              onMouseDown={handleDragStart}
            />
          </div>
        )}

        {/* Center Area: Editor + Results */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-col h-full min-w-0 bg-[#1e1e1e]">
            {/* Header: Tabs */}
            <div className="border-b border-[#333] bg-[#1e1e1e]">
              <TabBar />
            </div>

            {/* Toolbar */}
            <div className="h-10 bg-[#252525] flex items-center px-4 gap-2 border-b border-[#333]">
              <Button
                size="sm"
                className="h-7 px-3 bg-[#2d2d2d] hover:bg-[#3d3d3d] text-gray-200 border border-[#444] text-[11px] gap-1.5"
              >
                <Play size={12} className="fill-green-500 text-green-500" />
                Run
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-3 text-gray-400 hover:text-gray-200 text-[11px] gap-1.5"
              >
                <Save size={12} />
                Save
              </Button>
              <div className="ml-auto text-[10px] text-gray-500 font-mono">
                Auto Commit
              </div>
            </div>

            {/* Split View */}
            <div className="flex-1 min-h-0 relative">
              <ResizablePanelGroup direction="vertical">
                <Panel defaultSize={50} minSize={20}>
                  <QueryEditor />
                </Panel>

                <ResizableHandle className="h-1 bg-[#333] hover:bg-[#f39c12] transition-colors z-50" />

                <Panel defaultSize={50} minSize={20}>
                  {currentResult ? (
                    <div className="h-full w-full bg-[#1e1e1e]">
                      <DataGrid
                        data={currentResult.rows}
                        columns={currentResult.columns}
                      />
                    </div>
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-gray-600 text-sm bg-[#1e1e1e]">
                      <div className="flex flex-col items-center gap-2 opacity-30 select-none">
                        <Play size={48} strokeWidth={0.5} />
                        <span>Run a query to see results</span>
                      </div>
                    </div>
                  )}
                </Panel>
              </ResizablePanelGroup>
            </div>

            {/* Editor Status Bar */}
            <EditorStatusBar
              rowCount={currentResult?.rows?.length}
              executionTime={124}
            />
          </div>
        </div>

        {/* Right Panel: Details (Separate from center) */}
        {!isRightCollapsed && (
          <div
            className="border-l border-[#111] bg-[#1a1a1a] shrink-0"
            style={{ width: "200px" }}
          >
            <div className="h-full flex flex-col">
              <div className="h-9 border-b border-[#333] flex items-center px-3 text-xs font-bold text-gray-400 uppercase tracking-widest">
                Details
              </div>
              <div className="flex-1 flex items-center justify-center text-gray-600 text-xs p-4 text-center">
                Select an item to view details
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
