import { AppBar } from "@/components/AppBar";
import { QueryShortcuts } from "@/components/workspace/QueryShortcuts";
import { ToolWindowPanel } from "@/components/workspace/ToolWindowPanel";
import { TabBar } from "@/components/workspace/TabBar";
import { SideToolWindow } from "@/components/workspace/SideToolWindow";
import { ElasticsearchResponseView } from "@/components/workspace/ElasticsearchResponseView";
import {
  WorkbenchGlobalTools,
  WorkbenchStatusBar,
  WorkbenchTitleTools,
} from "@/components/workspace/WorkbenchChrome";
import { useTabStore } from "@/store/useTabStore";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { useEditorGroupStore } from "@/store/useEditorGroupStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useSqliteBackupScheduler } from "@/features/database-admin/model/useSqliteBackupScheduler";
import { useProjectStore } from "@/store/useProjectStore";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useShortcuts } from "@/hooks/useShortcuts";
import { APP_EVENT_OPEN_PROJECT_FILES } from "@/lib/projectFilesNavigation";
import {
  APP_EVENT_OPEN_COMMAND_PALETTE,
  APP_EVENT_OPEN_COMMIT,
  APP_EVENT_OPEN_VERSION_CONTROL,
} from "@/lib/actionEvents";
import { APP_EVENT_OPEN_ASSISTANT } from "@/store/useAssistantComposerStore";
import { subscribeStartupIntents } from "@/startup/startupIntents";
import { startWorkspaceHydration } from "@/startup/startupProgress";
import { cn } from "@/lib/utils";
import { presentQueryError } from "@/lib/queryErrorPresentation";
import type { WorkbenchSide } from "@/lib/appSettings";
import { toolWindowAtSide, type SideToolWindowId } from "@/lib/workbenchLayout";
import {
  APP_EVENT_VIM_WINDOW_NAVIGATE,
  type VimWindowNavigation,
} from "@/lib/vimMode";
import { ChevronDown, ChevronRight, LineChart, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";

const DataGrid = lazy(() =>
  import("@/components/workspace/DataGrid").then((module) => ({
    default: module.DataGrid,
  })),
);
const LeftPanel = lazy(() =>
  import("@/components/workspace/LeftPanel").then((module) => ({
    default: module.LeftPanel,
  })),
);
const QueryEditor = lazy(() =>
  import("@/components/workspace/QueryEditor").then((module) => ({
    default: module.QueryEditor,
  })),
);
const SplitEditor = lazy(() =>
  import("@/components/workspace/SplitEditor").then((module) => ({
    default: module.SplitEditor,
  })),
);
const TableDataView = lazy(() =>
  import("@/components/workspace/TableDataView").then((module) => ({
    default: module.TableDataView,
  })),
);
const CreateTableTab = lazy(() =>
  import("@/components/workspace/CreateTableTab").then((module) => ({
    default: module.CreateTableTab,
  })),
);
const ExplainPlanView = lazy(() =>
  import("@/components/workspace/ExplainPlanView").then((module) => ({
    default: module.ExplainPlanView,
  })),
);
const SchemaDiffView = lazy(() =>
  import("@/components/workspace/SchemaDiffView").then((module) => ({
    default: module.SchemaDiffView,
  })),
);
const SchemaDiagramView = lazy(() =>
  import("@/components/workspace/SchemaDiagramView").then((module) => ({
    default: module.SchemaDiagramView,
  })),
);
const DataCompareView = lazy(() =>
  import("@/components/workspace/DataCompareView").then((module) => ({
    default: module.DataCompareView,
  })),
);
const DatabaseBrowser = lazy(() =>
  import("@/components/workspace/DatabaseBrowser").then((module) => ({
    default: module.DatabaseBrowser,
  })),
);
const LspConnectionSyncer = lazy(() =>
  import("@/components/lsp/LspConnectionSyncer").then((module) => ({
    default: module.LspConnectionSyncer,
  })),
);
const CommandPalette = lazy(() =>
  import("@/components/workspace/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);
const QueryHistorySync = lazy(() =>
  import("@/components/workspace/QueryHistorySync").then((module) => ({
    default: module.QueryHistorySync,
  })),
);

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
  const setQueryOutputView = useTabStore((state) => state.setQueryOutputView);
  const closeResultAt = useTabStore((state) => state.closeResultAt);
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
      activeTab?.error,
    );
  const isIntrospecting =
    isSchemaLoading || isCollectionsLoading || isFunctionsLoading;
  const leftToolWindow = toolWindowAtSide(workbenchSettings, "left");
  const rightToolWindow = toolWindowAtSide(workbenchSettings, "right");
  const isDatabaseExplorerOpen = leftToolWindow === "databaseExplorer" || rightToolWindow === "databaseExplorer";
  const isAssistantOpen = leftToolWindow === "assistant" || rightToolWindow === "assistant";
  const isProjectFilesOpen = leftToolWindow === "projectFiles" || rightToolWindow === "projectFiles";
  const isCommitOpen = leftToolWindow === "commit" || rightToolWindow === "commit";
  const isVersionControlOpen = leftToolWindow === "versionControl" || rightToolWindow === "versionControl";
  const showQueryResultPanel =
    toolWindows.results.enabled &&
    hasQueryResultSurface &&
    layout.visibility.results;
  const showCollapsedResults =
    toolWindows.results.enabled &&
    hasQueryResultSurface &&
    !layout.visibility.results;
  const activePanelClass = "wb-panel-active";

  useEffect(() => {
    if (!queryTabSignature && splitDirection) {
      resetEditorGroups();
    }
  }, [queryTabSignature, resetEditorGroups, splitDirection]);

  useLayoutEffect(() => {
    if (hasQueryResultSurface && toolWindows.results.enabled) {
      setToolWindowVisible("results", true);
    }
  }, [
    hasQueryResultSurface,
    setToolWindowVisible,
    toolWindows.results.enabled,
  ]);

  useEffect(() => {
    const focusSurface = (
      selector: string,
      surface: "editor" | "results" | SideToolWindowId,
    ) => {
      const container = document.querySelector<HTMLElement>(selector);
      if (!container) return false;
      setActiveToolWindow(surface);
      window.requestAnimationFrame(() => {
        const focusTarget = container.querySelector<HTMLElement>(
          'textarea:not([disabled]), input:not([disabled]), button:not([disabled]), [tabindex="0"]',
        );
        (focusTarget || container).focus();
      });
      return true;
    };
    const handleVimWindowNavigation = (event: Event) => {
      const direction = (event as CustomEvent<{ direction?: VimWindowNavigation }>)
        .detail?.direction;
      if (!direction) return;
      if (direction === "close") {
        const tabId = useTabStore.getState().activeTabId;
        if (tabId) useTabStore.getState().closeTab(tabId);
        return;
      }
      if (
        direction === "left" &&
        leftToolWindow &&
        focusSurface('[data-tool-window-side="left"]', leftToolWindow)
      ) {
        return;
      }
      if (
        direction === "right" &&
        rightToolWindow &&
        focusSurface('[data-tool-window-side="right"]', rightToolWindow)
      ) {
        return;
      }
      if (
        direction === "down" &&
        showQueryResultPanel &&
        focusSurface("[data-workbench-results]", "results")
      ) {
        return;
      }
      if (direction === "next") {
        if (
          rightToolWindow &&
          focusSurface('[data-tool-window-side="right"]', rightToolWindow)
        ) {
          return;
        }
        if (showQueryResultPanel) {
          focusSurface("[data-workbench-results]", "results");
        }
      }
    };
    let awaitingWindowKey = false;
    let prefixTimer: number | null = null;
    const clearPrefix = () => {
      awaitingWindowKey = false;
      if (prefixTimer !== null) window.clearTimeout(prefixTimer);
      prefixTimer = null;
    };
    const handleWorkbenchVimKey = (event: KeyboardEvent) => {
      if (appSettings.editor.keybindingMode !== "vim") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".monaco-editor")) return;
      const editingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      if (!awaitingWindowKey) {
        if (editingText || !event.ctrlKey || event.key.toLowerCase() !== "w") {
          return;
        }
        event.preventDefault();
        awaitingWindowKey = true;
        prefixTimer = window.setTimeout(clearPrefix, 900);
        return;
      }

      const key = event.key;
      const direction =
        key === "h" || key === "ArrowLeft"
          ? "left"
          : key === "l" || key === "ArrowRight"
            ? "right"
            : key === "k" || key === "ArrowUp"
              ? "up"
              : key === "j" || key === "ArrowDown"
                ? "down"
                : key === "w"
                  ? "next"
                  : key === "W"
                    ? "previous"
                    : key === "q" || key === "c"
                      ? "close"
                      : null;
      clearPrefix();
      if (!direction) return;
      event.preventDefault();
      const activeSurface = layout.activeToolWindow;
      if (direction === "close") {
        if (activeSurface === "results") {
          setToolWindowVisible("results", false);
        } else if (activeSurface !== "editor") {
          setToolWindowVisible(activeSurface, false);
        }
        return;
      }
      if (
        (activeSurface === leftToolWindow &&
          (direction === "right" || direction === "next")) ||
        (activeSurface === rightToolWindow && direction === "left") ||
        (activeSurface === "results" && direction === "up")
      ) {
        focusSurface(".wb-query-editor", "editor");
        return;
      }
      handleVimWindowNavigation(
        new CustomEvent(APP_EVENT_VIM_WINDOW_NAVIGATE, {
          detail: { direction, source: activeSurface },
        }),
      );
    };
    window.addEventListener(
      APP_EVENT_VIM_WINDOW_NAVIGATE,
      handleVimWindowNavigation,
    );
    window.addEventListener("keydown", handleWorkbenchVimKey, true);
    return () => {
      clearPrefix();
      window.removeEventListener(
        APP_EVENT_VIM_WINDOW_NAVIGATE,
        handleVimWindowNavigation,
      );
      window.removeEventListener("keydown", handleWorkbenchVimKey, true);
    };
  }, [
    appSettings.editor.keybindingMode,
    layout.activeToolWindow,
    leftToolWindow,
    rightToolWindow,
    setActiveToolWindow,
    setToolWindowVisible,
    showQueryResultPanel,
  ]);

  useEffect(() => {
    const openProjectFiles = () => {
      setToolWindowVisible("projectFiles", true);
      setActiveToolWindow("projectFiles");
    };
    window.addEventListener(APP_EVENT_OPEN_PROJECT_FILES, openProjectFiles);
    return () =>
      window.removeEventListener(
        APP_EVENT_OPEN_PROJECT_FILES,
        openProjectFiles,
      );
  }, [setActiveToolWindow, setToolWindowVisible]);

  useEffect(() => {
    const openAssistant = () => {
      setToolWindowVisible("assistant", true);
      setActiveToolWindow("assistant");
    };
    window.addEventListener(APP_EVENT_OPEN_ASSISTANT, openAssistant);
    return () =>
      window.removeEventListener(APP_EVENT_OPEN_ASSISTANT, openAssistant);
  }, [setActiveToolWindow, setToolWindowVisible]);

  useEffect(
    () =>
      subscribeStartupIntents((intent) => {
        if (typeof intent !== "string") {
          setToolWindowVisible("databaseExplorer", true);
          setActiveToolWindow("databaseExplorer");
          void startWorkspaceHydration({
            loadProjects: useProjectStore.getState().loadProjects,
            loadSettings: useSettingsStore.getState().loadSettings,
            loadConnections: useConnectionStore.getState().loadConnections,
          }).then(async () => {
            const connectionStore = useConnectionStore.getState();
            await connectionStore.loadConnections();
            const error = await connectionStore.setActiveConnection(
              intent.connectionId,
            );
            if (error) {
              console.warn(
                `Unable to open startup data source ${intent.connectionId}: ${error}`,
              );
            }
          });
          return;
        }
        if (intent === "new-query") {
          resetEditorGroups();
          useTabStore.getState().createTab("query", "New Query", "", {
            connectionId: activeConnectionId || undefined,
            schemaName: currentSchema || undefined,
          });
          return;
        }
        if (intent === "project-files") {
          setToolWindowVisible("projectFiles", true);
          setActiveToolWindow("projectFiles");
          return;
        }
        window.queueMicrotask(() => {
          window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_COMMAND_PALETTE));
        });
      }),
    [
      activeConnectionId,
      currentSchema,
      resetEditorGroups,
      setActiveToolWindow,
      setToolWindowVisible,
    ],
  );

  useEffect(() => {
    const openCommit = () => setToolWindowVisible("commit", true);
    const openVersionControl = () => setToolWindowVisible("versionControl", true);
    window.addEventListener(APP_EVENT_OPEN_COMMIT, openCommit);
    window.addEventListener(APP_EVENT_OPEN_VERSION_CONTROL, openVersionControl);
    return () => {
      window.removeEventListener(APP_EVENT_OPEN_COMMIT, openCommit);
      window.removeEventListener(APP_EVENT_OPEN_VERSION_CONTROL, openVersionControl);
    };
  }, [setToolWindowVisible]);

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

  const renderSideToolWindow = (id: SideToolWindowId | null, side: WorkbenchSide) => {
    const width = side === "left" ? layout.leftWidth : layout.rightWidth;
    const isOpen = id !== null;
    if (!id) {
      return <ToolWindowFallback side={side} isOpen={false} width={width} />;
    }
    const isActive = layout.activeToolWindow === id;
    const handleDragStart = (event: ReactMouseEvent) =>
      handleSideDragStart(event, side, id);

    if (id === "databaseExplorer") {
      return (
        <Suspense
          key={id}
          fallback={
            <ToolWindowFallback side={side} isOpen={isOpen} width={width} />
          }
        >
          <LeftPanel
            side={side}
            isDrawerOpen={isOpen}
            sidebarWidth={width}
            onDragStart={handleDragStart}
            isActive={isActive}
            onFocusPanel={() => setActiveToolWindow(id)}
          />
        </Suspense>
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
        {isOpen ? <ToolWindowPanel id={id} /> : null}
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
            commitOpen={isCommitOpen}
            commitPinned={
              toolWindows.commit.enabled &&
              layout.pinnedTitleTools.includes("commit")
            }
            versionControlOpen={isVersionControlOpen}
            versionControlPinned={layout.pinnedTitleTools.includes(
              "versionControl",
            ) && toolWindows.versionControl.enabled}
            onToggleDatabaseExplorer={() =>
              toggleToolWindow("databaseExplorer")
            }
            onToggleAssistant={() => toggleToolWindow("assistant")}
            onToggleFiles={() => toggleToolWindow("projectFiles")}
            onToggleCommit={() => toggleToolWindow("commit")}
            onToggleVersionControl={() => toggleToolWindow("versionControl")}
            onSetCommitPinned={(pinned) =>
              setTitleToolPinned("commit", pinned)
            }
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
                <div className="z-10 flex h-full min-w-0 flex-col gap-1 bg-[hsl(var(--wb-editor))]">
                  {!(activeTab?.type === "query" && splitDirection) && (
                    <div className="z-20">
                      <TabBar />
                    </div>
                  )}

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
                              data-workbench-results
                              tabIndex={-1}
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
                                            {result.responseMeta?.requestPath ||
                                              `Result ${index + 1}`}
                                          </span>
                                          <span
                                            role="button"
                                            tabIndex={0}
                                          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] opacity-0 transition-opacity hover:bg-[hsl(var(--wb-hover))] hover:opacity-100 group-hover/result:opacity-100 focus-visible:opacity-100"
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
                                  ) : !isPlanView &&
                                    queryResults.length === 1 ? (
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
                                          className="flex h-3.5 w-3.5 items-center justify-center rounded-[2px] opacity-0 transition-opacity hover:bg-[hsl(var(--wb-hover))] hover:opacity-100 group-hover/result:opacity-100 focus-visible:opacity-100"
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
                                    <>
                                      <span className="whitespace-nowrap text-[10px]">
                                        {currentResult.rows.length.toLocaleString()}{" "}
                                        rows
                                      </span>
                                      {currentResult.responseMeta && (
                                        <span className="whitespace-nowrap text-[10px] text-emerald-400">
                                          HTTP {currentResult.responseMeta.status}
                                          {" · "}
                                          {currentResult.responseMeta.durationMs.toLocaleString()}{" "}
                                          ms
                                        </span>
                                      )}
                                    </>
                                  )}
                                  {activeTab?.isExecuting && (
                                    <span className="whitespace-nowrap">
                                      Running...
                                    </span>
                                  )}
                                  {activeTab?.error && (
                                    <span className="truncate text-[hsl(var(--destructive))]">
                                      {queryErrorPresentation?.title ||
                                        "Query failed"}
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
                                <Suspense fallback={<QueryResultsFallback />}>
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
                                    currentResult ? (
                                      <ElasticsearchResponseView
                                        result={currentResult}
                                      >
                                        <DataGrid readOnly />
                                      </ElasticsearchResponseView>
                                    ) : (
                                      <DataGrid readOnly />
                                    )
                                  )}
                                </Suspense>
                              </div>
                            </div>
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
    </div>
  );
}

function DeferredCommandPalette() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const requestMount = () => setMounted(true);
    window.addEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, requestMount);
    window.addEventListener("oxide:command-palette-open", requestMount);
    return () => {
      window.removeEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, requestMount);
      window.removeEventListener("oxide:command-palette-open", requestMount);
    };
  }, []);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette initiallyOpen />
    </Suspense>
  );
}

function DeferredQueryHistorySync() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setEnabled(true), {
        timeout: 1_500,
      });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => setEnabled(true), 1_000);
    return () => window.clearTimeout(handle);
  }, []);

  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <QueryHistorySync />
    </Suspense>
  );
}

function WorkspaceStartupHydration() {
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const loadConnections = useConnectionStore((state) => state.loadConnections);
  const loadDatabaseDriverCatalog = useDatabaseDriverCatalogStore(
    (state) => state.load,
  );

  useEffect(() => {
    let disposed = false;
    let idleHandle: number | null = null;
    let timerHandle: number | null = null;

    const loadDeferredDriverCatalog = () => {
      if (disposed) return;
      const idleWindow = window as Window & {
        requestIdleCallback?: (
          callback: IdleRequestCallback,
          options?: IdleRequestOptions,
        ) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(
          () => void loadDatabaseDriverCatalog(),
          { timeout: 2_000 },
        );
        return;
      }
      timerHandle = window.setTimeout(
        () => void loadDatabaseDriverCatalog(),
        750,
      );
    };

    const start = () => {
      void startWorkspaceHydration({
        loadProjects,
        loadSettings,
        loadConnections,
      }).finally(loadDeferredDriverCatalog);
    };
    const frame = window.requestAnimationFrame(start);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      if (idleHandle !== null) {
        (
          window as Window & {
            cancelIdleCallback?: (handle: number) => void;
          }
        ).cancelIdleCallback?.(idleHandle);
      }
      if (timerHandle !== null) window.clearTimeout(timerHandle);
    };
  }, [
    loadConnections,
    loadDatabaseDriverCatalog,
    loadProjects,
    loadSettings,
  ]);

  useEffect(() => {
    const reloadExternalSettings = () => {
      if (document.visibilityState === "visible") {
        void loadSettings();
      }
    };
    window.addEventListener("focus", reloadExternalSettings);
    document.addEventListener("visibilitychange", reloadExternalSettings);
    return () => {
      window.removeEventListener("focus", reloadExternalSettings);
      document.removeEventListener("visibilitychange", reloadExternalSettings);
    };
  }, [loadSettings]);

  return null;
}

function ToolWindowFallback({
  side,
  isOpen,
  width,
}: {
  side: WorkbenchSide;
  isOpen: boolean;
  width: number;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="wb-tool-window h-full shrink-0 rounded-[6px]"
      style={{ width }}
      data-tool-window-side={side}
      aria-hidden="true"
    >
      <div className="h-8 border-b border-[hsl(var(--wb-border-subtle))]" />
    </div>
  );
}

function QueryResultsFallback() {
  return (
    <div
      className="h-full bg-[linear-gradient(to_right,hsl(var(--wb-border-subtle))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--wb-border-subtle))_1px,transparent_1px)] bg-[size:160px_28px] opacity-45"
      aria-label="Loading query results"
    />
  );
}

function WorkbenchSurfaceFallback() {
  return (
    <div
      className="h-full min-h-0 bg-[hsl(var(--wb-editor))]"
      aria-hidden="true"
    />
  );
}
