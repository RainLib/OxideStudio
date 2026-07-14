import { AppBar } from "@/components/AppBar";
import { DataGrid } from "@/components/workspace/DataGrid";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { QueryEditor } from "@/components/workspace/QueryEditor";
import { QueryShortcuts } from "@/components/workspace/QueryShortcuts";
import {
  SecondaryPanel,
  type SecondaryPanelView,
} from "@/components/workspace/SecondaryPanel";
import { TabBar } from "@/components/workspace/TabBar";
import { SplitEditor } from "@/components/workspace/SplitEditor";
import { TableDataView } from "@/components/workspace/TableDataView";
import { CreateTableTab } from "@/components/workspace/CreateTableTab";
import { ExplainPlanView } from "@/components/workspace/ExplainPlanView";
import { SchemaDiffView } from "@/components/workspace/SchemaDiffView";
import { SideToolWindow } from "@/components/workspace/SideToolWindow";
import {
  WorkbenchGlobalTools,
  WorkbenchStatusBar,
  WorkbenchTitleTools,
} from "@/components/workspace/WorkbenchChrome";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { useEditorGroupStore } from "@/store/useEditorGroupStore";
import { CommandPalette } from "@/components/workspace/CommandPalette";
import { QueryHistorySync } from "@/components/workspace/QueryHistorySync";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { APP_EVENT_OPEN_PROJECT_FILES } from "@/lib/projectFilesNavigation";
import { cn } from "@/lib/utils";
import type { WorkbenchSide } from "@/lib/appSettings";
import { toolWindowAtSide, type SideToolWindowId } from "@/lib/workbenchLayout";
import { ChevronDown, ChevronRight, LineChart, X } from "lucide-react";
import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";

export function WorkspacePage() {
  useUnsavedChangesGuard();
  const [secondaryPanelView, setSecondaryPanelView] =
    useState<SecondaryPanelView>("assistant");
  const {
    tabs,
    activeTabId,
    setActiveResultIndex,
    setQueryOutputView,
    closeResultAt,
  } = useTabStore();
  const connections = useConnectionStore((state) => state.connections);
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const appSettings = useSettingsStore((state) => state.settings);
  const workbenchSettings = appSettings.workbench;
  const layout = workbenchSettings.layout;
  const toolWindows = workbenchSettings.toolWindows;
  const {
    setToolWindowVisible,
    setLeftWidth,
    setRightWidth,
    setBottomHeight,
    setActiveToolWindow,
  } = useWorkbenchLayoutStore();
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const isSchemaLoading = useSchemaStore((state) => state.isLoading);
  const isCollectionsLoading = useSchemaStore(
    (state) => state.isCollectionsLoading,
  );
  const isFunctionsLoading = useSchemaStore(
    (state) => state.isFunctionsLoading,
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const splitDirection = useEditorGroupStore((state) => state.splitDirection);
  const resetEditorGroups = useEditorGroupStore((state) => state.reset);
  const activeConnection = connections.find(
    (connection) => connection.id === activeConnectionId,
  );
  const queryResults = activeTab?.results ?? [];
  const activeResultIndex = Math.min(
    activeTab?.activeResultIndex ?? 0,
    Math.max(0, queryResults.length - 1),
  );
  const currentResult = queryResults[activeResultIndex];
  const isPlanView = activeTab?.queryOutputView === "plan";
  const isQueryTab = activeTab?.type === "query";
  const hasQueryResultSurface =
    Boolean(isQueryTab && activeTab) &&
    Boolean(
      currentResult ||
      activeTab?.explainPlan ||
      activeTab?.isExecuting ||
      activeTab?.error,
    );
  const isIntrospecting =
    isSchemaLoading || isCollectionsLoading || isFunctionsLoading;
  const isDatabaseExplorerOpen =
    toolWindows.databaseExplorer.enabled && layout.visibility.databaseExplorer;
  const isSecondaryPanelOpen =
    toolWindows.assistant.enabled && layout.visibility.assistant;
  const showQueryResultPanel =
    toolWindows.results.enabled &&
    hasQueryResultSurface &&
    layout.visibility.results;
  const showCollapsedResults =
    toolWindows.results.enabled &&
    hasQueryResultSurface &&
    !layout.visibility.results;
  const leftToolWindow = toolWindowAtSide(toolWindows, "left");
  const rightToolWindow = toolWindowAtSide(toolWindows, "right");
  const activePanelClass = "wb-panel-active";

  useEffect(() => {
    if (!tabs.some((tab) => tab.type === "query") && splitDirection) {
      resetEditorGroups();
    }
  }, [resetEditorGroups, splitDirection, tabs]);

  useEffect(() => {
    if (hasQueryResultSurface && toolWindows.results.enabled) {
      setToolWindowVisible("results", true);
    }
  }, [
    hasQueryResultSurface,
    setToolWindowVisible,
    toolWindows.results.enabled,
  ]);

  useEffect(() => {
    const openProjectFiles = () => {
      setSecondaryPanelView("files");
      setToolWindowVisible("assistant", true);
      setActiveToolWindow("assistant");
    };
    window.addEventListener(APP_EVENT_OPEN_PROJECT_FILES, openProjectFiles);
    return () =>
      window.removeEventListener(
        APP_EVENT_OPEN_PROJECT_FILES,
        openProjectFiles,
      );
  }, [setActiveToolWindow, setToolWindowVisible]);

  const toggleSecondaryPanelView = (nextView: SecondaryPanelView) => {
    if (isSecondaryPanelOpen && secondaryPanelView === nextView) {
      setToolWindowVisible("assistant", false);
      return;
    }
    setSecondaryPanelView(nextView);
    setToolWindowVisible("assistant", true);
    setActiveToolWindow("assistant");
  };

  const handleSideDragStart = (
    event: ReactMouseEvent,
    side: WorkbenchSide,
    id: SideToolWindowId,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? layout.leftWidth : layout.rightWidth;

    const handleDrag = (moveEvent: MouseEvent) => {
      const nextWidth =
        side === "left"
          ? startWidth + moveEvent.clientX - startX
          : startWidth + startX - moveEvent.clientX;
      if (nextWidth < 160) {
        setToolWindowVisible(id, false);
      } else if (side === "left") {
        setLeftWidth(nextWidth);
      } else {
        setRightWidth(nextWidth);
      }
    };

    const handleDragEnd = () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
      document.body.style.cursor = "default";
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
    document.body.style.cursor = "col-resize";
  };

  const handleVerticalDragStart = (event: ReactMouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = layout.bottomHeight;

    const handleDrag = (moveEvent: MouseEvent) => {
      setBottomHeight(startHeight + startY - moveEvent.clientY);
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

  const renderSideToolWindow = (id: SideToolWindowId, side: WorkbenchSide) => {
    const width = side === "left" ? layout.leftWidth : layout.rightWidth;
    const isOpen =
      id === "databaseExplorer" ? isDatabaseExplorerOpen : isSecondaryPanelOpen;
    const isActive = layout.activeToolWindow === id;
    const handleDragStart = (event: ReactMouseEvent) =>
      handleSideDragStart(event, side, id);

    if (id === "databaseExplorer") {
      return (
        <LeftPanel
          key={id}
          side={side}
          isDrawerOpen={isOpen}
          sidebarWidth={width}
          onDragStart={handleDragStart}
          isActive={isActive}
          onFocusPanel={() => setActiveToolWindow(id)}
        />
      );
    }

    return (
      <SideToolWindow
        key={id}
        side={side}
        isOpen={isOpen}
        width={width}
        isActive={isActive}
        onFocus={() => setActiveToolWindow(id)}
        onDragStart={handleDragStart}
      >
        <SecondaryPanel view={secondaryPanelView} />
      </SideToolWindow>
    );
  };

  return (
    <div
      className="workbench-shell flex flex-col"
      style={
        {
          "--wb-ui-font-size": `${appSettings.appearance.uiFontSize}px`,
        } as CSSProperties
      }
    >
      <QueryHistorySync />
      <AppBar
        center={
          <WorkbenchTitleTools
            databaseExplorerOpen={isDatabaseExplorerOpen}
            databaseExplorerSide={toolWindows.databaseExplorer.side}
            secondaryPanelOpen={isSecondaryPanelOpen}
            secondaryPanelView={secondaryPanelView}
            assistantSide={toolWindows.assistant.side}
            onToggleDatabaseExplorer={() =>
              setToolWindowVisible("databaseExplorer", !isDatabaseExplorerOpen)
            }
            onToggleAssistant={() => toggleSecondaryPanelView("assistant")}
            onToggleFiles={() => toggleSecondaryPanelView("files")}
          />
        }
        right={<WorkbenchGlobalTools />}
      />

      <main className="wb-workspace-track">
        {renderSideToolWindow(leftToolWindow, "left")}

        <div className="wb-work-surface relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[6px]">
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {tabs.length === 0 ? (
                <QueryShortcuts />
              ) : (
                <div className="z-10 flex h-full min-w-0 flex-col gap-1 bg-[hsl(var(--wb-editor))]">
                  {!(activeTab?.type === "query" && splitDirection) && (
                    <div className="z-20">
                      <TabBar />
                    </div>
                  )}

                  {activeTab?.type === "table" ? (
                    <TableDataView />
                  ) : activeTab?.type === "create_table" ? (
                    <CreateTableTab
                      tabId={activeTab.id}
                      connectionId={activeTab.connectionId || ""}
                      schemaName={activeTab.schemaName || ""}
                    />
                  ) : activeTab?.type === "schema_diff" ? (
                    <SchemaDiffView />
                  ) : (
                    <div className="relative flex h-full min-h-0 flex-col gap-1">
                      <div
                        className={cn(
                          "flex min-h-[160px] flex-1 flex-col overflow-hidden",
                          layout.activeToolWindow === "editor" &&
                            activePanelClass,
                        )}
                        onFocus={() => setActiveToolWindow("editor")}
                      >
                        {splitDirection ? <SplitEditor /> : <QueryEditor />}
                      </div>

                      {showQueryResultPanel && (
                        <>
                          <div
                            className="wb-resizer-y relative z-50"
                            onMouseDown={handleVerticalDragStart}
                          />
                          <div
                            className={cn(
                              "min-h-[140px] shrink-0 overflow-hidden rounded-b-[6px] border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-grid))]",
                              layout.activeToolWindow === "results" &&
                                activePanelClass,
                            )}
                            style={{ height: `${layout.bottomHeight}px` }}
                            onFocus={() => setActiveToolWindow("results")}
                          >
                            <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-2 text-[11px] text-[hsl(var(--wb-text-muted))]">
                              <div className="flex min-w-0 items-center gap-1.5">
                                {(!isPlanView || queryResults.length > 0) && (
                                  <button
                                    type="button"
                                    className={cn(
                                      "mr-1 flex h-5 items-center rounded-[3px] px-2 font-medium",
                                      !isPlanView
                                        ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                                        : "hover:bg-[hsl(var(--wb-hover))]",
                                    )}
                                    onClick={() =>
                                      activeTab &&
                                      setQueryOutputView(
                                        activeTab.id,
                                        "results",
                                      )
                                    }
                                  >
                                    Results
                                  </button>
                                )}
                                {(activeTab?.explainPlan || isPlanView) && (
                                  <button
                                    type="button"
                                    className={cn(
                                      "mr-1 flex h-5 items-center gap-1.5 rounded-[3px] px-2 font-medium",
                                      isPlanView
                                        ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                                        : "hover:bg-[hsl(var(--wb-hover))]",
                                    )}
                                    onClick={() =>
                                      activeTab &&
                                      setQueryOutputView(activeTab.id, "plan")
                                    }
                                  >
                                    <LineChart size={11} />
                                    Explain Plan
                                  </button>
                                )}
                                {!isPlanView && queryResults.length > 1 ? (
                                  <div className="flex min-w-0 items-center gap-0.5">
                                    {queryResults.map((result, index) => (
                                      <button
                                        key={`${activeTab?.id}:result:${index}`}
                                        type="button"
                                        className={cn(
                                          "group/result flex h-5 max-w-[150px] items-center gap-1 rounded-[3px] pl-2 pr-1 text-[10px] hover:bg-[hsl(var(--wb-hover))]",
                                          index === activeResultIndex
                                            ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                                            : "text-[hsl(var(--wb-text-muted))]",
                                        )}
                                        onClick={() =>
                                          activeTab &&
                                          setActiveResultIndex(
                                            activeTab.id,
                                            index,
                                          )
                                        }
                                        title={`${result.rows.length.toLocaleString()} rows`}
                                      >
                                        <span className="truncate">
                                          Result {index + 1}
                                        </span>
                                        <span
                                          role="button"
                                          tabIndex={0}
                                          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] opacity-60 hover:bg-[hsl(var(--wb-hover))] hover:opacity-100"
                                          title="Close result"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            if (activeTab) {
                                              closeResultAt(
                                                activeTab.id,
                                                index,
                                              );
                                            }
                                          }}
                                          onKeyDown={(event) => {
                                            if (
                                              event.key === "Enter" ||
                                              event.key === " "
                                            ) {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              if (activeTab) {
                                                closeResultAt(
                                                  activeTab.id,
                                                  index,
                                                );
                                              }
                                            }
                                          }}
                                        >
                                          <X size={10} />
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                ) : !isPlanView && queryResults.length === 1 ? (
                                  <button
                                    type="button"
                                    className="group/result flex h-5 items-center gap-1 rounded-[3px] bg-[hsl(var(--wb-active-strong))] pl-2 pr-1 text-[10px] text-[hsl(var(--wb-text))]"
                                    onClick={() =>
                                      activeTab &&
                                      setActiveResultIndex(activeTab.id, 0)
                                    }
                                  >
                                    <span>Result</span>
                                    {currentResult && (
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        className="flex h-3.5 w-3.5 items-center justify-center rounded-[2px] opacity-60 hover:bg-[hsl(var(--wb-hover))] hover:opacity-100"
                                        title="Close result"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          if (activeTab) {
                                            closeResultAt(activeTab.id, 0);
                                          }
                                        }}
                                        onKeyDown={(event) => {
                                          if (
                                            event.key === "Enter" ||
                                            event.key === " "
                                          ) {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            if (activeTab) {
                                              closeResultAt(activeTab.id, 0);
                                            }
                                          }
                                        }}
                                      >
                                        <X size={10} />
                                      </span>
                                    )}
                                  </button>
                                ) : null}
                                {!isPlanView && currentResult && (
                                  <span className="whitespace-nowrap text-[10px]">
                                    {currentResult.rows.length.toLocaleString()}{" "}
                                    rows
                                  </span>
                                )}
                                {activeTab?.isExecuting && (
                                  <span className="whitespace-nowrap">
                                    Running...
                                  </span>
                                )}
                                {activeTab?.error && (
                                  <span className="truncate text-[hsl(var(--destructive))]">
                                    {activeTab.error}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="wb-icon-button h-6 w-6"
                                onClick={() =>
                                  setToolWindowVisible("results", false)
                                }
                                title="Hide Results"
                              >
                                <ChevronDown size={14} />
                              </button>
                            </div>
                            <div className="h-[calc(100%-2rem)] min-h-0">
                              {isPlanView ? (
                                activeTab?.explainPlan ? (
                                  <ExplainPlanView
                                    tabId={activeTab.id}
                                    plan={activeTab.explainPlan}
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-[hsl(var(--wb-text-muted))]">
                                    {activeTab?.isExecuting
                                      ? "Generating Explain Plan…"
                                      : activeTab?.error ||
                                        "No Explain Plan is available."}
                                  </div>
                                )
                              ) : (
                                <DataGrid readOnly />
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {showCollapsedResults && (
                        <button
                          type="button"
                          className="flex h-6 shrink-0 items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3 text-left text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]"
                          onClick={() => setToolWindowVisible("results", true)}
                          title="Show Results"
                        >
                          <ChevronRight size={12} />
                          <span className="font-medium text-[hsl(var(--wb-text))]">
                            {isPlanView ? "Explain Plan" : "Results"}
                          </span>
                          {!isPlanView && currentResult && (
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

        {renderSideToolWindow(rightToolWindow, "right")}
      </main>

      <WorkbenchStatusBar
        activeConnectionName={activeConnection?.name}
        currentSchema={currentSchema}
        activeTabTitle={activeTab?.title}
        isIntrospecting={isIntrospecting}
        secondaryPanelOpen={isSecondaryPanelOpen}
        onToggleSecondaryPanel={() =>
          setToolWindowVisible("assistant", !isSecondaryPanelOpen)
        }
      />

      <CommandPalette />
    </div>
  );
}
