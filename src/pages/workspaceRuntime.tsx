import { AppBar } from "@/components/AppBar";
import { QueryShortcuts } from "@/components/workspace/QueryShortcuts";
import { TabBar } from "@/components/workspace/TabBar";
import {
  WorkbenchGlobalTools,
  WorkbenchStatusBar,
  WorkbenchTitleTools,
} from "@/components/workspace/WorkbenchChrome";
import { useSqliteBackupScheduler } from "@/features/database-admin/model/useSqliteBackupScheduler";
import { useWorkbenchSessionLifecycle } from "@/features/workbench/hooks/useWorkbenchSessionLifecycle";
import { useWorkbenchSurfaceEvents } from "@/features/workbench/hooks/useWorkbenchSurfaceEvents";
import { useWorkbenchWindowNavigation } from "@/features/workbench/hooks/useWorkbenchWindowNavigation";
import { createWorkbenchResizeActions } from "@/features/workbench/model/createWorkbenchResizeActions";
import { createSideToolWindowRenderer } from "@/features/workbench/ui/createSideToolWindowRenderer";
import { DeferredCommandPalette } from "@/features/workbench/ui/DeferredCommandPalette";
import { DeferredDatabaseSearch } from "@/features/workbench/ui/DeferredDatabaseSearch";
import { DeferredQueryHistorySync } from "@/features/workbench/ui/DeferredQueryHistorySync";
import { WorkbenchSurfaceFallback } from "@/features/workbench/ui/WorkbenchFallbacks";
import {
  CreateTableTab,
  DatabaseBrowser,
  DataCompareView,
  LspConnectionSyncer,
  ObjectBrowser,
  QueryEditor,
  RocketMqWorkspace,
  SchemaDiagramView,
  SchemaDiffView,
  SplitEditor,
  TableDataView,
} from "@/features/workbench/ui/WorkbenchLazySurfaces";
import { WorkbenchQueryResults } from "@/features/workbench/ui/WorkbenchQueryResults";
import { WorkspaceStartupHydration } from "@/features/workbench/ui/WorkspaceStartupHydration";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { presentQueryError } from "@/lib/queryErrorPresentation";
import { tabPlacementFlexDirection } from "@/lib/tabOrganization";
import { cn } from "@/lib/utils";
import { toolWindowAtSide } from "@/lib/workbenchLayout";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useEditorGroupStore } from "@/store/useEditorGroupStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { ChevronRight } from "lucide-react";
import { Suspense, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";

export function WorkspaceRuntime() {
  useShortcuts();
  useUnsavedChangesGuard();
  useSqliteBackupScheduler();
  const activeTab = useTabStore(
    useShallow((state) => {
      const tab = state.tabs.find((item) => item.id === state.activeTabId);
      if (!tab) return null;
      return {
        id: tab.id,
        type: tab.type,
        title: tab.title,
        connectionId: tab.connectionId,
        schemaName: tab.schemaName,
        error: tab.error,
        queryError: tab.queryError,
        results: tab.results,
        activeResultIndex: tab.activeResultIndex,
        resultRuns: tab.resultRuns,
        activeResultRunId: tab.activeResultRunId,
        queryOutputView: tab.queryOutputView,
        explainPlan: tab.explainPlan,
        isExecuting: tab.isExecuting,
      };
    }),
  );
  const tabCount = useTabStore((state) => state.tabs.length);
  const queryTabSignature = useTabStore((state) =>
    state.tabs
      .filter((tab) => tab.type === "query")
      .map((tab) => tab.id)
      .join("\u0000"),
  );
  const lspTabSignature = useTabStore((state) =>
    state.tabs
      .filter((tab) => tab.type === "query" || tab.type === "table")
      .map((tab) => `${tab.type}:${tab.id}`)
      .join("\u0000"),
  );
  const setActiveResultIndex = useTabStore(
    (state) => state.setActiveResultIndex,
  );
  const setActiveResultRun = useTabStore((state) => state.setActiveResultRun);
  const toggleResultRunPin = useTabStore((state) => state.toggleResultRunPin);
  const closeResultRun = useTabStore((state) => state.closeResultRun);
  const setQueryOutputView = useTabStore((state) => state.setQueryOutputView);
  const closeResultAt = useTabStore((state) => state.closeResultAt);
  const connections = useConnectionStore((state) => state.connections);
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const appSettings = useSettingsStore((state) => state.settings);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const loadSavedSqlProject = useSavedQueryStore((state) => state.loadProject);
  const workbenchSettings = appSettings.workbench;
  const layout = workbenchSettings.layout;
  const toolWindows = workbenchSettings.toolWindows;
  const {
    setToolWindowVisible,
    setLeftWidth,
    setRightWidth,
    setBottomHeight,
    setActiveToolWindow,
    setTitleToolPinned,
    toggleToolWindow,
  } = useWorkbenchLayoutStore();
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const isSchemaLoading = useSchemaStore((state) => state.isLoading);
  const isCollectionsLoading = useSchemaStore(
    (state) => state.isCollectionsLoading,
  );
  const isFunctionsLoading = useSchemaStore(
    (state) => state.isFunctionsLoading,
  );
  const hasLspSurface = Boolean(lspTabSignature);
  const splitDirection = useEditorGroupStore((state) => state.splitDirection);
  const resetEditorGroups = useEditorGroupStore((state) => state.reset);
  const usesSplitEditor = Boolean(
    activeTab?.type === "query" && splitDirection,
  );
  const tabWorkspaceLayoutClass = usesSplitEditor
    ? "flex-col"
    : tabPlacementFlexDirection(appSettings.editor.tabPlacement);
  const activeConnection = connections.find(
    (connection) => connection.id === activeConnectionId,
  );
  const queryConnection = connections.find(
    (connection) => connection.id === activeTab?.connectionId,
  );
  const queryErrorPresentation = activeTab?.error
    ? presentQueryError(
        activeTab.error,
        queryConnection?.name,
        activeTab.queryError,
      )
    : null;
  const queryResults = activeTab?.results ?? [];
  const queryResultRuns = activeTab?.resultRuns ?? [];
  const pinnedQueryResultRunCount = queryResultRuns.filter(
    (run) => run.pinned,
  ).length;
  const activeResultIndex = Math.min(
    activeTab?.activeResultIndex ?? 0,
    Math.max(0, queryResults.length - 1),
  );
  const currentResult = queryResults[activeResultIndex];
  const isPlanView = activeTab?.queryOutputView === "plan";
  const isQueryTab = activeTab?.type === "query";
  const hasQueryResultSurface =
    Boolean(isQueryTab && activeTab) &&
    Boolean(currentResult || activeTab?.explainPlan || activeTab?.error);
  const isIntrospecting =
    isSchemaLoading || isCollectionsLoading || isFunctionsLoading;
  const leftToolWindow = toolWindowAtSide(workbenchSettings, "left");
  const rightToolWindow = toolWindowAtSide(workbenchSettings, "right");
  const isDatabaseExplorerOpen =
    leftToolWindow === "databaseExplorer" ||
    rightToolWindow === "databaseExplorer";
  const isAssistantOpen =
    leftToolWindow === "assistant" || rightToolWindow === "assistant";
  const isProjectFilesOpen =
    leftToolWindow === "projectFiles" || rightToolWindow === "projectFiles";
  const isSqlLibraryOpen =
    leftToolWindow === "sqlLibrary" || rightToolWindow === "sqlLibrary";
  const isCommitOpen =
    leftToolWindow === "commit" || rightToolWindow === "commit";
  const isVersionControlOpen =
    leftToolWindow === "versionControl" || rightToolWindow === "versionControl";
  const showQueryResultPanel =
    toolWindows.results.enabled &&
    hasQueryResultSurface &&
    layout.visibility.results;
  const showCollapsedResults =
    toolWindows.results.enabled &&
    hasQueryResultSurface &&
    !layout.visibility.results;
  const activePanelClass = "wb-panel-active";

  useWorkbenchSessionLifecycle({
    loadSavedSqlProject,
    activeProjectId,
    queryTabSignature,
    splitDirection,
    resetEditorGroups,
    hasQueryResultSurface,
    toolWindows,
    setToolWindowVisible,
  });

  useWorkbenchWindowNavigation({
    setActiveToolWindow,
    leftToolWindow,
    rightToolWindow,
    showQueryResultPanel,
    appSettings,
    layout,
    setToolWindowVisible,
  });

  useWorkbenchSurfaceEvents({
    setToolWindowVisible,
    setActiveToolWindow,
    resetEditorGroups,
    activeConnectionId,
    currentSchema,
  });

  const { handleSideDragStart, handleVerticalDragStart } =
    createWorkbenchResizeActions({
      layout,
      setToolWindowVisible,
      setLeftWidth,
      setRightWidth,
      setBottomHeight,
    });

  const { renderSideToolWindow } = createSideToolWindowRenderer({
    layout,
    handleSideDragStart,
    setActiveToolWindow,
  });

  return (
    <div
      className="workbench-shell flex flex-col"
      style={
        {
          "--wb-ui-font-size": `${appSettings.appearance.uiFontSize}px`,
        } as CSSProperties
      }
    >
      <WorkspaceStartupHydration />
      <DeferredQueryHistorySync />
      {hasLspSurface && (
        <Suspense fallback={null}>
          <LspConnectionSyncer />
        </Suspense>
      )}
      <AppBar
        center={
          <WorkbenchTitleTools
            databaseExplorerOpen={isDatabaseExplorerOpen}
            databaseExplorerSide={toolWindows.databaseExplorer.side}
            assistantOpen={isAssistantOpen}
            assistantSide={toolWindows.assistant.side}
            projectFilesOpen={isProjectFilesOpen}
            projectFilesSide={toolWindows.projectFiles.side}
            sqlLibraryOpen={isSqlLibraryOpen}
            sqlLibrarySide={toolWindows.sqlLibrary.side}
            commitOpen={isCommitOpen}
            commitPinned={
              toolWindows.commit.enabled &&
              layout.pinnedTitleTools.includes("commit")
            }
            versionControlOpen={isVersionControlOpen}
            versionControlPinned={
              layout.pinnedTitleTools.includes("versionControl") &&
              toolWindows.versionControl.enabled
            }
            onToggleDatabaseExplorer={() =>
              toggleToolWindow("databaseExplorer")
            }
            onToggleAssistant={() => toggleToolWindow("assistant")}
            onToggleFiles={() => toggleToolWindow("projectFiles")}
            onToggleSqlLibrary={() => toggleToolWindow("sqlLibrary")}
            onToggleCommit={() => toggleToolWindow("commit")}
            onToggleVersionControl={() => toggleToolWindow("versionControl")}
            onSetCommitPinned={(pinned) => setTitleToolPinned("commit", pinned)}
            onSetVersionControlPinned={(pinned) =>
              setTitleToolPinned("versionControl", pinned)
            }
          />
        }
        right={<WorkbenchGlobalTools />}
      />

      <main className="wb-workspace-track">
        {renderSideToolWindow(leftToolWindow, "left")}

        <div className="wb-work-surface relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[6px]">
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {tabCount === 0 ? (
                <QueryShortcuts />
              ) : (
                <div
                  className={cn(
                    "z-10 flex h-full min-h-0 min-w-0 gap-1 bg-[hsl(var(--wb-editor))]",
                    tabWorkspaceLayoutClass,
                  )}
                >
                  {!usesSplitEditor && (
                    <div className="z-20 min-h-0 min-w-0 shrink-0">
                      <TabBar />
                    </div>
                  )}

                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <Suspense fallback={<WorkbenchSurfaceFallback />}>
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
                      ) : activeTab?.type === "schema_diagram" ? (
                        <SchemaDiagramView />
                      ) : activeTab?.type === "data_compare" ? (
                        <DataCompareView />
                      ) : activeTab?.type === "database_browser" ? (
                        <DatabaseBrowser />
                      ) : activeTab?.type === "object_browser" ? (
                        <ObjectBrowser />
                      ) : activeTab?.type === "rocketmq_workspace" ? (
                        <RocketMqWorkspace />
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
                              <WorkbenchQueryResults
                                layout={layout}
                                activePanelClass={activePanelClass}
                                setActiveToolWindow={setActiveToolWindow}
                                isPlanView={isPlanView}
                                queryResults={queryResults}
                                activeTab={activeTab}
                                setQueryOutputView={setQueryOutputView}
                                queryResultRuns={queryResultRuns}
                                setActiveResultRun={setActiveResultRun}
                                pinnedQueryResultRunCount={
                                  pinnedQueryResultRunCount
                                }
                                toggleResultRunPin={toggleResultRunPin}
                                closeResultRun={closeResultRun}
                                activeResultIndex={activeResultIndex}
                                setActiveResultIndex={setActiveResultIndex}
                                closeResultAt={closeResultAt}
                                currentResult={currentResult}
                                queryErrorPresentation={queryErrorPresentation}
                                setToolWindowVisible={setToolWindowVisible}
                              />
                            </>
                          )}

                          {showCollapsedResults && (
                            <button
                              type="button"
                              className="flex h-6 shrink-0 items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3 text-left text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]"
                              onClick={() =>
                                setToolWindowVisible("results", true)
                              }
                              title="Show Results"
                            >
                              <ChevronRight size={12} />
                              <span className="font-medium text-[hsl(var(--wb-text))]">
                                {isPlanView ? "Explain Plan" : "Results"}
                              </span>
                              {!isPlanView && currentResult && (
                                <span>
                                  {currentResult.rows.length.toLocaleString()}{" "}
                                  rows
                                </span>
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </Suspense>
                  </div>
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
        secondaryPanelOpen={Boolean(rightToolWindow)}
        onToggleSecondaryPanel={() =>
          rightToolWindow
            ? setToolWindowVisible(rightToolWindow, false)
            : setToolWindowVisible("assistant", true)
        }
      />

      <DeferredCommandPalette />
      <DeferredDatabaseSearch />
    </div>
  );
}
