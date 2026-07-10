import { AppBar } from "@/components/AppBar";
import { DataGrid } from "@/components/workspace/DataGrid";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { QueryEditor } from "@/components/workspace/QueryEditor";
import { QueryShortcuts } from "@/components/workspace/QueryShortcuts";
import { AssistantSidebar } from "@/components/workspace/AssistantSidebar";
import { TabBar } from "@/components/workspace/TabBar";
import { TableDataView } from "@/components/workspace/TableDataView";
import { CreateTableTab } from "@/components/workspace/CreateTableTab";
import { TaskStatusCenter } from "@/components/workspace/TaskStatusCenter";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { CommandPalette } from "@/components/workspace/CommandPalette";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { useEffect, useState } from "react";

export function WorkspacePage() {
  const { tabs, activeTabId } = useTabStore();
  const { connections, activeConnectionId } = useConnectionStore();
  const {
    currentSchema,
    isLoading: isSchemaLoading,
    isCollectionsLoading,
    isFunctionsLoading,
  } = useSchemaStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const isIntrospecting =
    isSchemaLoading || isCollectionsLoading || isFunctionsLoading;

  const currentResult = Array.isArray(activeTab?.results)
    ? activeTab?.results[0]
    : activeTab?.results;

  // Layout State
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(true);
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(400); // Fixed pixel width
  const [rightSidebarWidth, setRightSidebarWidth] = useState(360);
  const [resultPanelHeight, setResultPanelHeight] = useState(320);
  const [isResultPanelHidden, setIsResultPanelHidden] = useState(false);
  const isQueryTab =
    activeTab?.type !== "table" && activeTab?.type !== "create_table";
  const hasQueryResultSurface =
    Boolean(isQueryTab && activeTab) &&
    Boolean(currentResult || activeTab?.isExecuting || activeTab?.error);
  const showQueryResultPanel = hasQueryResultSurface && !isResultPanelHidden;

  useEffect(() => {
    if (hasQueryResultSurface) {
      setIsResultPanelHidden(false);
    }
  }, [activeTab?.id, activeTab?.isExecuting, currentResult, hasQueryResultSurface]);

  const handleDragStart = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(0, startWidth + deltaX);

      if (newWidth < 160) {
        setIsLeftDrawerOpen(false);
        setSidebarWidth(400);
      } else {
        setSidebarWidth(Math.min(newWidth, 680));
      }
    };

    const handleDragEnd = () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
  };

  const handleRightDragStart = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = rightSidebarWidth;

    const handleDrag = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(0, startWidth + deltaX);

      if (newWidth < 180) {
        setIsRightDrawerOpen(false);
        setRightSidebarWidth(360);
      } else {
        setRightSidebarWidth(Math.min(newWidth, 560));
      }
    };

    const handleDragEnd = () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
  };

  const handleVerticalDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = resultPanelHeight;

    const handleDrag = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(
        140,
        Math.min(startHeight + deltaY, window.innerHeight - 220)
      );
      setResultPanelHeight(newHeight);
    };

    const handleDragEnd = () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
      document.body.style.cursor = "default";
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
    document.body.style.cursor = "row-resize";
  };

  return (
    <div className="workbench-shell flex flex-col">
      <AppBar
        right={
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="wb-icon-button"
              onClick={() => setIsLeftDrawerOpen(!isLeftDrawerOpen)}
              title="Toggle Left Panel"
            >
              {isLeftDrawerOpen ? (
                <PanelLeftClose size={14} />
              ) : (
                <PanelLeft size={14} />
              )}
            </button>
            <button
              type="button"
              className="wb-icon-button"
              onClick={() => setIsRightDrawerOpen(!isRightDrawerOpen)}
              title="Toggle AI Assistant"
            >
              {isRightDrawerOpen ? (
                <PanelRightClose size={14} />
              ) : (
                <PanelRight size={14} />
              )}
            </button>
          </div>
        }
      />

      <div className="flex flex-1 gap-1 overflow-hidden bg-[hsl(var(--wb-frame))] p-1">
        {/* Unified Left Panel */}
        <LeftPanel
          isDrawerOpen={isLeftDrawerOpen}
          sidebarWidth={sidebarWidth}
          onDragStart={handleDragStart}
        />

        {/* Main Content Area + Right Panel with Unified Bottom StatusBar */}
        <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[6px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))]">
          {/* Top: Content Areas */}
          <div className="flex flex-1 min-h-0">
            {/* Main Editor Area */}
            <div className="flex-1 min-w-0 flex flex-col">
              {tabs.length === 0 ? (
                <QueryShortcuts />
              ) : (
                <div className="flex flex-col h-full min-w-0 gap-1 bg-[hsl(var(--wb-editor))] z-10">
                  {/* Main functionality area */}
                  <div className="z-20">
                    <TabBar />
                  </div>

                  {activeTab?.type === "table" ? (
                    <TableDataView />
                  ) : activeTab?.type === "create_table" ? (
                    <CreateTableTab
                      tabId={activeTab.id}
                      connectionId={activeTab.connectionId || ""}
                      schemaName={activeTab.schemaName || ""}
                    />
                  ) : (
                    <div className="flex flex-col h-full min-h-0 gap-1 relative">
                      <div className="min-h-[160px] flex-1 flex flex-col overflow-hidden">
                        <QueryEditor />
                      </div>

                      {showQueryResultPanel && (
                        <>
                          <div
                            className="wb-resizer-y z-50 relative group"
                            onMouseDown={handleVerticalDragStart}
                          />

                          <div
                            className="min-h-[140px] shrink-0 overflow-hidden rounded-b-[6px] border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-grid))]"
                            style={{ height: `${resultPanelHeight}px` }}
                          >
                            <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-2 text-[11px] text-[hsl(var(--wb-text-muted))]">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-[hsl(var(--wb-text))]">
                                  Results
                                </span>
                                {currentResult && (
                                  <span>
                                    {currentResult.rows.length.toLocaleString()} rows
                                  </span>
                                )}
                                {activeTab?.isExecuting && <span>Running...</span>}
                              </div>
                              <button
                                type="button"
                                className="wb-icon-button h-6 w-6"
                                onClick={() => setIsResultPanelHidden(true)}
                                title="Hide Results"
                              >
                                <ChevronDown size={14} />
                              </button>
                            </div>
                            <div className="h-[calc(100%-2rem)] min-h-0">
                              <DataGrid readOnly />
                            </div>
                          </div>
                        </>
                      )}
                      {hasQueryResultSurface && isResultPanelHidden && (
                        <button
                          type="button"
                          className="flex h-6 shrink-0 items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3 text-left text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]"
                          onClick={() => setIsResultPanelHidden(false)}
                          title="Show Results"
                        >
                          <ChevronRight size={12} />
                          <span className="font-medium text-[hsl(var(--wb-text))]">
                            Results
                          </span>
                          {currentResult && (
                            <span>
                              {currentResult.rows.length.toLocaleString()} rows
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className={cn(
            "relative z-10 flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-150 ease-out",
            isRightDrawerOpen
              ? "wb-panel rounded-[6px] border border-[hsl(var(--wb-border-subtle))]"
              : "border-0"
          )}
          style={{ width: `${isRightDrawerOpen ? rightSidebarWidth : 0}px` }}
        >
          {isRightDrawerOpen && (
            <>
              <div
                className="absolute left-0 top-0 bottom-0 wb-resizer-x z-50"
                onMouseDown={handleRightDragStart}
              />
              <AssistantSidebar />
            </>
          )}
        </div>
      </div>

      {/* Bottom: DataGrip-style path/status line. Component status can still use the right slot. */}
      <div className="wb-statusbar z-30 flex w-full items-center transition-colors duration-200">
        <div className="flex min-w-0 items-center gap-1 px-2">
          <span className="shrink-0">Database</span>
          {activeConnection && (
            <>
              <ChevronRight size={12} className="shrink-0 wb-muted" />
              <span className="truncate">{activeConnection.name}</span>
            </>
          )}
          {currentSchema && (
            <>
              <ChevronRight size={12} className="shrink-0 wb-muted" />
              <span className="truncate">{currentSchema}</span>
            </>
          )}
          {activeTab && (
            <>
              <ChevronRight size={12} className="shrink-0 wb-muted" />
              <span className="truncate">{activeTab.title}</span>
            </>
          )}
        </div>
        <div className="ml-auto flex h-full items-center">
          {isIntrospecting && (
            <div className="hidden h-full items-center gap-2 border-l border-[hsl(var(--wb-border-subtle))] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] sm:flex">
              <span className="whitespace-nowrap">Introspecting metadata</span>
              <span className="wb-progress-track">
                <span className="wb-progress-bar" />
              </span>
            </div>
          )}
          <TaskStatusCenter />
          <div id="status-bar-slot" className="h-full flex items-center" />
        </div>
      </div>

      <CommandPalette />
    </div>
  );
}
