import { useTabStore, TabType } from "@/store/useTabStore";
import { cn } from "@/lib/utils";
import {
  X,
  Plus,
  Terminal,
  Table as TableIcon,
  ChevronDown,
  Database,
  Pin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useEffect, useRef, useState } from "react";

const TabIcon = ({ type }: { type: TabType }) => {
  if (type === "table") return <TableIcon size={12} className="text-primary" />;
  return <Terminal size={12} className="text-blue-500" />;
};

export function TabBar() {
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [contextMenuTabId, setContextMenuTabId] = useState<string | null>(null);

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
  }, [tabs]);

  // Auto-scroll to active tab
  useEffect(() => {
    if (activeTabId && tabRefs.current.has(activeTabId)) {
      const activeTabElement = tabRefs.current.get(activeTabId);
      if (activeTabElement && scrollContainerRef.current) {
        // Scroll the active tab into view with smooth behavior
        activeTabElement.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }
  }, [activeTabId]);

  return (
    <div className="flex items-center bg-[#18181b] h-10 w-full overflow-visible border-b border-white/5 pt-1">
      {/* Scrollable tabs container*/}
      <div
        ref={scrollContainerRef}
        className="flex-1 flex overflow-x-auto h-full items-end scrollbar-hide"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {tabs.map((tab) => {
          const tabIndex = tabs.findIndex((t) => t.id === tab.id);
          const canCloseLeft =
            tabIndex > 0 && tabs.slice(0, tabIndex).some((t) => !t.isPinned);
          const canCloseRight =
            tabIndex < tabs.length - 1 &&
            tabs.slice(tabIndex + 1).some((t) => !t.isPinned);
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
                    "flex items-center gap-2 px-4 h-9 min-w-[120px] max-w-[200px] text-[11px] cursor-pointer select-none group transition-all shrink-0 relative top-px",
                    activeTabId === tab.id
                      ? "bg-[#09090b] text-foreground font-semibold border-t border-x border-white/10 rounded-t-md z-10 shadow-sm relative -bottom-px"
                      : "bg-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent opacity-70 hover:opacity-100"
                  )}
                  onClick={() => setActiveTab(tab.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuTabId(tab.id);
                  }}
                >
                  {tab.isPinned && <Pin size={10} className="text-primary" />}
                  <TabIcon type={tab.type} />
                  <span className="truncate flex-1">{tab.title}</span>
                  {!tab.isPinned && (
                    <div
                      className="opacity-0 group-hover:opacity-100 hover:bg-background-elevated rounded p-0.5 transition-opacity"
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
                className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-background-elevated"
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
                const queryTabs = tabs.filter((t) => t.type === "query");
                const tableTabs = tabs.filter((t) => t.type === "table");

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
                        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold px-2 py-1">
                          Queries
                        </DropdownMenuLabel>
                        {queryTabs.map((tab) => (
                          <DropdownMenuItem
                            key={tab.id}
                            className={cn(
                              "flex items-center gap-2 text-[11px] cursor-pointer",
                              activeTabId === tab.id
                                ? "bg-background-tertiary text-foreground"
                                : "text-muted-foreground hover:text-foreground focus:bg-background-tertiary"
                            )}
                            onClick={() => setActiveTab(tab.id)}
                          >
                            <TabIcon type={tab.type} />
                            <span className="truncate flex-1">{tab.title}</span>
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
                          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold px-2 py-1 flex items-center gap-1.5">
                            <Database size={11} className="text-primary" />
                            {schema}
                          </DropdownMenuLabel>
                          {tablesBySchema[schema]?.map((tab) => (
                            <DropdownMenuItem
                              key={tab.id}
                              className={cn(
                                "flex items-center gap-2 text-[11px] cursor-pointer pl-4",
                                activeTabId === tab.id
                                  ? "bg-background-tertiary text-foreground"
                                  : "text-muted-foreground hover:text-foreground focus:bg-background-tertiary"
                              )}
                              onClick={() => setActiveTab(tab.id)}
                            >
                              <TabIcon type={tab.type} />
                              <span className="truncate flex-1">
                                {tab.title}
                              </span>
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
          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-background-elevated"
          onClick={() =>
            createTab(
              "query",
              `Query #${tabs.filter((t) => t.type === "query").length + 1}`
            )
          }
        >
          <Plus size={14} />
        </Button>
      </div>
    </div>
  );
}
