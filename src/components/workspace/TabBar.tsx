import {
  hasUnsavedTabChanges,
  useTabStore,
  TabType,
} from "@/store/useTabStore";
import { cn } from "@/lib/utils";
import {
  X,
  Plus,
  Terminal,
  Table as TableIcon,
  ChevronDown,
  Database,
  FileCode2,
  Image as ImageIcon,
  Pin,
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelBottom,
  GitCompareArrows,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import {
  useEditorGroupStore,
  type EditorSplitDirection,
} from "@/store/useEditorGroupStore";

const TabIcon = ({
  type,
  isFile,
  isImage,
}: {
  type: TabType;
  isFile?: boolean;
  isImage?: boolean;
}) => {
  if (type === "table") return <TableIcon size={12} className="wb-muted" />;
  if (type === "schema_diff") {
    return <GitCompareArrows size={12} className="text-amber-300" />;
  }
  if (isImage) return <ImageIcon size={12} className="text-violet-400" />;
  if (isFile) return <FileCode2 size={12} className="text-sky-400" />;
  return <Terminal size={12} className="text-sky-400" />;
};

interface TabBarProps {
  activeTabIdOverride?: string | null;
  queryOnly?: boolean;
  allowSplit?: boolean;
  onSelectTab?: (tabId: string) => void;
  onCloseGroup?: () => void;
}

export function TabBar({
  activeTabIdOverride,
  queryOnly = false,
  allowSplit = true,
  onSelectTab,
  onCloseGroup,
}: TabBarProps = {}) {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    forceCloseTab,
    closeOtherTabs,
    closeAllTabs,
    closeTabsToLeft,
    closeTabsToRight,
    togglePinTab,
    createTab,
  } = useTabStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [contextMenuTabId, setContextMenuTabId] = useState<string | null>(null);
  const activeConnection = connections.find(
    (connection) => connection.id === activeConnectionId
  );
  const displayedActiveTabId =
    activeTabIdOverride === undefined ? activeTabId : activeTabIdOverride;
  const visibleTabs = queryOnly
    ? tabs.filter((tab) => tab.type === "query")
    : tabs;
  const activateTab = (tabId: string) => {
    onSelectTab?.(tabId);
    setActiveTab(tabId);
  };
  const splitTab = (direction: EditorSplitDirection, tabId: string) => {
    useEditorGroupStore.getState().split(direction, tabId);
    setActiveTab(tabId);
  };

  const createQueryConsole = () => {
    useEditorGroupStore.getState().reset();
    const queryNumber = tabs.filter((tab) => tab.type === "query").length + 1;
    createTab(
      "query",
      activeConnection
        ? `console [${activeConnection.name}]`
        : `Query #${queryNumber}`,
      "",
      {
        connectionId: activeConnectionId || undefined,
        schemaName: currentSchema || undefined,
      }
    );
  };

  // Check for overflow
  useEffect(() => {
    const checkOverflow = () => {
      const container = scrollContainerRef.current;
      if (container) {
        setHasOverflow(container.scrollWidth > container.clientWidth);
      }
    };

    checkOverflow();
    window.addEventListener("resize", checkOverflow);
    return () => window.removeEventListener("resize", checkOverflow);
  }, [visibleTabs]);

  // Auto-scroll to active tab
  useEffect(() => {
    if (displayedActiveTabId && tabRefs.current.has(displayedActiveTabId)) {
      const activeTabElement = tabRefs.current.get(displayedActiveTabId);
      if (activeTabElement && scrollContainerRef.current) {
        // Scroll the active tab into view with smooth behavior
        activeTabElement.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }
  }, [displayedActiveTabId]);

  return (
    <div className="flex items-center h-8 w-full overflow-visible border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] shadow-[inset_0_-1px_0_hsl(var(--wb-accent)/0.08)]">
      {/* Scrollable tabs container*/}
      <div
        ref={scrollContainerRef}
        className="flex-1 flex overflow-x-auto h-full items-stretch scrollbar-hide"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {visibleTabs.map((tab) => {
          const tabIndex = visibleTabs.findIndex((t) => t.id === tab.id);
          const canCloseLeft =
            tabIndex > 0 && visibleTabs.slice(0, tabIndex).some((t) => !t.isPinned);
          const canCloseRight =
            tabIndex < visibleTabs.length - 1 &&
            visibleTabs.slice(tabIndex + 1).some((t) => !t.isPinned);
          const isContextMenuOpen = contextMenuTabId === tab.id;

          return (
            <DropdownMenu
              key={tab.id}
              open={isContextMenuOpen}
              onOpenChange={(open) => {
                if (!open) setContextMenuTabId(null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <div
                  ref={(el) => {
                    if (el) {
                      tabRefs.current.set(tab.id, el);
                    } else {
                      tabRefs.current.delete(tab.id);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 h-full min-w-[118px] max-w-[220px] text-[11px] cursor-pointer select-none group transition-colors shrink-0 border-r border-[hsl(var(--wb-border-subtle))]",
                    displayedActiveTabId === tab.id
                      ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))] font-semibold shadow-[inset_0_1px_0_hsl(var(--wb-accent)/0.34)]"
                      : "bg-transparent text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                  )}
                  onClick={() => activateTab(tab.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuTabId(tab.id);
                  }}
                >
                  {tab.isPinned && <Pin size={10} className="text-primary" />}
                  <TabIcon
                    type={tab.type}
                    isFile={Boolean(tab.fileRelativePath)}
                    isImage={Boolean(tab.filePreview)}
                  />
                  <span
                    className="truncate flex-1"
                    title={tab.fileRelativePath || tab.title}
                  >
                    {tab.title}
                  </span>
                  {hasUnsavedTabChanges(tab) && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--wb-accent))]"
                      title="Unsaved changes"
                    />
                  )}
                  {!tab.isPinned && (
                    <div
                      className="opacity-0 group-hover:opacity-100 hover:bg-[hsl(var(--wb-hover))] rounded-[3px] p-0.5 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                    >
                      <X size={10} />
                    </div>
                  )}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-48 bg-background-elevated border-border text-foreground">
                {allowSplit && tab.type === "query" && <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="text-[11px] cursor-pointer focus:bg-background-tertiary">
                    <PanelRight size={12} className="mr-2" />
                    Split Editor
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-40 bg-background-elevated border-border text-foreground">
                    {([
                      ["left", "Split Left", PanelLeft],
                      ["right", "Split Right", PanelRight],
                      ["up", "Split Up", PanelTop],
                      ["down", "Split Down", PanelBottom],
                    ] as const).map(([direction, label, Icon]) => (
                      <DropdownMenuItem
                        key={direction}
                        className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                        onClick={() => splitTab(direction, tab.id)}
                      >
                        <Icon size={12} className="mr-2" />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>}
                {allowSplit && tab.type === "query" && <DropdownMenuSeparator className="bg-border" />}
                <DropdownMenuItem
                  onClick={() => {
                    togglePinTab(tab.id);
                    setContextMenuTabId(null);
                  }}
                  className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                >
                  <Pin size={12} className="mr-2" />
                  {tab.isPinned ? "Unpin Tab" : "Pin Tab"}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  onClick={() => {
                    closeTab(tab.id);
                    setContextMenuTabId(null);
                  }}
                  className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                  disabled={tab.isPinned}
                >
                  <X size={12} className="mr-2" />
                  Close
                </DropdownMenuItem>
                {tab.isPinned && (
                  <DropdownMenuItem
                    onClick={() => {
                      forceCloseTab(tab.id);
                      setContextMenuTabId(null);
                    }}
                    className="text-[11px] cursor-pointer focus:bg-background-tertiary text-red-500"
                  >
                    <X size={12} className="mr-2" />
                    Close with Pin
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    closeOtherTabs(tab.id);
                    setContextMenuTabId(null);
                  }}
                  className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                >
                  <X size={12} className="mr-2" />
                  Close Others
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    closeTabsToLeft(tab.id);
                    setContextMenuTabId(null);
                  }}
                  className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                  disabled={!canCloseLeft}
                >
                  <X size={12} className="mr-2" />
                  Close to the Left
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    closeTabsToRight(tab.id);
                    setContextMenuTabId(null);
                  }}
                  className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                  disabled={!canCloseRight}
                >
                  <X size={12} className="mr-2" />
                  Close to the Right
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  onClick={() => {
                    closeAllTabs();
                    setContextMenuTabId(null);
                  }}
                  className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                >
                  <X size={12} className="mr-2" />
                  Close All
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>

      {/* Overflow dropdown */}
      {hasOverflow && (
        <div className="px-1 h-full flex items-center border-l border-border-subtle">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="wb-icon-button"
                title="All tabs"
              >
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 bg-background-elevated border-border text-foreground max-h-[400px] overflow-y-auto"
            >
              {(() => {
                const queryTabs = visibleTabs.filter((t) => t.type === "query");
                const tableTabs = visibleTabs.filter((t) => t.type === "table");

                const tablesBySchema = tableTabs.reduce((acc, tab) => {
                  const schema = tab.schemaName || "Unknown";
                  if (!acc[schema]) {
                    acc[schema] = [];
                  }
                  acc[schema].push(tab);
                  return acc;
                }, {} as Record<string, typeof tabs>);

                return (
                  <>
                    {queryTabs.length > 0 && (
                      <>
                        <DropdownMenuLabel className="text-[10px] text-muted-foreground font-semibold px-2 py-1">
                          Queries
                        </DropdownMenuLabel>
                        {queryTabs.map((tab) => (
                          <DropdownMenuItem
                            key={tab.id}
                            className={cn(
                              "flex items-center gap-2 text-[11px] cursor-pointer",
                              displayedActiveTabId === tab.id
                                ? "bg-background-tertiary text-foreground"
                                : "text-muted-foreground hover:text-foreground focus:bg-background-tertiary"
                            )}
                            onClick={() => activateTab(tab.id)}
                          >
                            <TabIcon
                              type={tab.type}
                              isFile={Boolean(tab.fileRelativePath)}
                              isImage={Boolean(tab.filePreview)}
                            />
                            <span className="truncate flex-1">{tab.title}</span>
                            {hasUnsavedTabChanges(tab) && (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--wb-accent))]"
                                title="Unsaved changes"
                              />
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                closeTab(tab.id);
                              }}
                              className="opacity-60 hover:opacity-100 hover:bg-border rounded p-0.5"
                            >
                              <X size={10} />
                            </button>
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}

                    {queryTabs.length > 0 && tableTabs.length > 0 && (
                      <DropdownMenuSeparator className="my-1 bg-border" />
                    )}

                    {Object.keys(tablesBySchema)
                      .sort()
                      .map((schema, idx) => (
                        <div key={schema}>
                          {idx > 0 && (
                            <DropdownMenuSeparator className="my-1 bg-border" />
                          )}
                          <DropdownMenuLabel className="text-[10px] text-muted-foreground font-semibold px-2 py-1 flex items-center gap-1.5">
                            <Database size={11} className="text-primary" />
                            {schema}
                          </DropdownMenuLabel>
                          {tablesBySchema[schema]?.map((tab) => (
                            <DropdownMenuItem
                              key={tab.id}
                              className={cn(
                                "flex items-center gap-2 text-[11px] cursor-pointer pl-4",
                                displayedActiveTabId === tab.id
                                  ? "bg-background-tertiary text-foreground"
                                  : "text-muted-foreground hover:text-foreground focus:bg-background-tertiary"
                              )}
                              onClick={() => activateTab(tab.id)}
                            >
                              <TabIcon
                                type={tab.type}
                                isFile={Boolean(tab.fileRelativePath)}
                                isImage={Boolean(tab.filePreview)}
                              />
                              <span className="truncate flex-1">
                                {tab.title}
                              </span>
                              {hasUnsavedTabChanges(tab) && (
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--wb-accent))]"
                                  title="Unsaved changes"
                                />
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeTab(tab.id);
                                }}
                                className="opacity-60 hover:opacity-100 hover:bg-background-elevated rounded p-0.5"
                              >
                                <X size={10} />
                              </button>
                            </DropdownMenuItem>
                          ))}
                        </div>
                      ))}
                  </>
                );
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* New tab button */}
      <div className="px-2 h-full flex items-center border-l border-border-subtle">
        <Button
          variant="ghost"
          size="icon"
          className="wb-icon-button h-7 w-7"
          onClick={createQueryConsole}
          title="New Query Console"
        >
          <Plus size={14} />
        </Button>
      </div>
      {onCloseGroup && (
        <div className="h-full flex items-center border-l border-border-subtle px-1">
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={onCloseGroup}
            title="Close Editor Group"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
