import { Fragment } from "react";
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
import { cn } from "@/lib/utils";
import {
  X, Plus, Terminal, Table as TableIcon, ChevronDown, FileCode2,
  Image as ImageIcon, Pin, PanelLeft, PanelRight, PanelTop, PanelBottom,
  GitCompareArrows, Network, Rows3, DatabaseZap,
} from "lucide-react";
import { useTabBarController } from "@/features/workspace-tabs/hooks/useTabBarController";
import type { TabBarProps } from "@/features/workspace-tabs/model/tabBar";
import type { TabType } from "@/store/useTabStore";

const TabIcon = ({ type, isFile, isImage }: { type: TabType; isFile?: boolean; isImage?: boolean }) => {
  if (type === "table") return <TableIcon size={12} className="wb-muted" />;
  if (type === "schema_diff") return <GitCompareArrows size={12} className="text-amber-300" />;
  if (type === "schema_diagram") return <Network size={12} className="text-violet-300" />;
  if (type === "data_compare") return <Rows3 size={12} className="text-cyan-300" />;
  if (type === "database_browser") return <DatabaseZap size={12} className="text-emerald-400" />;
  if (type === "object_browser") return <TableIcon size={12} className="text-emerald-400" />;
  if (type === "rocketmq_workspace") return <Network size={12} className="text-orange-300" />;
  if (isImage) return <ImageIcon size={12} className="text-violet-400" />;
  if (isFile) return <FileCode2 size={12} className="text-sky-400" />;
  return <Terminal size={12} className="text-sky-400" />;
};

export function TabBarView({ allowSplit = true, compact = false, onCloseGroup, ...controllerProps }: TabBarProps = {}) {
  const {
    tabs, tabPlacement, tabGroupMode, tabSortMode, isVertical, organizedTabs,
    visibleTabs, visibleTabIndex, hasPinnedVisibleTabs, dataCompareSourceIds,
    displayedActiveTabId, canDragTabs, hasOverflow, scrollContainerRef, tabRefs,
    contextMenuTabId, setContextMenuTabId, tabDrag, setTabDrag, activateTab, splitTab,
    closeVisibleTab, closeVisibleTabs, closeVisibleOtherTabs, closeVisibleAllTabs,
    handleDragOver, finishDrag, createQueryConsole, togglePinTab, forceCloseTab,
    openDataCompareTab, hasUnsavedTabChanges,
  } = useTabBarController(controllerProps);
  return (
    <div
      className={cn(
        "flex shrink-0 overflow-visible bg-[hsl(var(--wb-toolbar))]",
        isVertical
          ? cn(
              compact ? "h-full w-40 flex-col" : "h-full w-56 flex-col",
              tabPlacement === "right"
                ? "border-l border-[hsl(var(--wb-border-subtle))]"
                : "border-r border-[hsl(var(--wb-border-subtle))]",
            )
          : cn(
              "h-8 w-full items-center",
              tabPlacement === "bottom"
                ? "border-t border-[hsl(var(--wb-border-subtle))]"
                : "border-b border-[hsl(var(--wb-border-subtle))]",
            ),
      )}
      data-tab-placement={tabPlacement}
      data-tab-group-mode={tabGroupMode}
      data-tab-sort-mode={tabSortMode}
      role="tablist"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
    >
      {/* Scrollable tabs container*/}
      <div
        ref={scrollContainerRef}
        className={cn(
          "scrollbar-hide flex min-h-0 min-w-0 flex-1",
          isVertical
            ? "w-full flex-col items-stretch overflow-x-hidden overflow-y-auto py-1"
            : "h-full items-end overflow-x-auto",
        )}
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {organizedTabs.map((organized) => {
          const tab = organized.tab;
          const tabIndex = visibleTabIndex.get(tab.id) ?? -1;
          const canCloseLeft =
            tabIndex > 0 &&
            visibleTabs.slice(0, tabIndex).some((t) => !t.isPinned);
          const canCloseRight =
            tabIndex < visibleTabs.length - 1 &&
            visibleTabs.slice(tabIndex + 1).some((t) => !t.isPinned);
          const isContextMenuOpen = contextMenuTabId === tab.id;
          const canCompareSource = dataCompareSourceIds.has(tab.id);
          const compareTargets =
            isContextMenuOpen && canCompareSource
              ? tabs.filter(
                  (candidate) =>
                    candidate.id !== tab.id &&
                    dataCompareSourceIds.has(candidate.id),
                )
              : [];

          const showRegularDivider =
            organized.startsRegularRegion &&
            hasPinnedVisibleTabs &&
            !tab.isPinned;
          const isDropTarget = tabDrag?.targetId === tab.id;
          return (
            <Fragment key={tab.id}>
              {showRegularDivider && (
                <div
                  className={cn(
                    "shrink-0 border-[hsl(var(--wb-border-subtle))]",
                    isVertical ? "mx-2 my-1 border-t" : "mx-1 h-5 border-l",
                  )}
                  aria-hidden="true"
                />
              )}
              {organized.startsGroup && (
                <div
                  className={cn(
                    "shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold uppercase tracking-[0.08em] text-[hsl(var(--wb-text-muted))]",
                    isVertical
                      ? "w-full px-3 pb-1 pt-2 text-[9px]"
                      : "flex h-full max-w-[132px] items-center border-l border-[hsl(var(--wb-border-subtle))] px-2 text-[8px]",
                  )}
                  title={organized.groupLabel}
                >
                  {organized.groupLabel}
                </div>
              )}
              <DropdownMenu
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
                      "group flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-[4px] border px-3 text-[11px] transition-[background-color,border-color,box-shadow,opacity]",
                      isVertical
                        ? "mx-1 my-0.5 h-7 min-w-0 max-w-none"
                        : "my-[3px] h-[calc(100%-6px)] min-w-[118px] max-w-[220px]",
                      canDragTabs && "cursor-grab active:cursor-grabbing",
                      displayedActiveTabId === tab.id
                        ? "border-[hsl(var(--wb-accent)/0.55)] bg-[hsl(var(--wb-editor))] font-semibold text-[hsl(var(--wb-text))] shadow-[inset_0_1px_0_hsl(var(--wb-accent)/0.18)]"
                        : "border-transparent bg-transparent text-[hsl(var(--wb-text-muted))] hover:border-[hsl(var(--wb-border-subtle))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                      tabDrag?.draggedId === tab.id && "opacity-45",
                      isDropTarget &&
                        (isVertical
                          ? tabDrag.position === "before"
                            ? "shadow-[inset_0_2px_0_hsl(var(--wb-accent))]"
                            : "shadow-[inset_0_-2px_0_hsl(var(--wb-accent))]"
                          : tabDrag.position === "before"
                            ? "shadow-[inset_2px_0_0_hsl(var(--wb-accent))]"
                            : "shadow-[inset_-2px_0_0_hsl(var(--wb-accent))]"),
                    )}
                    draggable={canDragTabs}
                    aria-grabbed={tabDrag?.draggedId === tab.id}
                    aria-selected={displayedActiveTabId === tab.id}
                    aria-label={
                      organized.groupLabel
                        ? `${tab.title}, ${organized.groupLabel}`
                        : tab.title
                    }
                    role="tab"
                    tabIndex={displayedActiveTabId === tab.id ? 0 : -1}
                    data-tab-id={tab.id}
                    onDragStart={(event) => {
                      if (!canDragTabs) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", tab.id);
                      setTabDrag({
                        draggedId: tab.id,
                        targetId: null,
                        position: null,
                      });
                    }}
                    onDragOver={(event) => handleDragOver(event, tab.id)}
                    onDrop={(event) => {
                      event.preventDefault();
                      finishDrag(event, tab.id);
                    }}
                    onDragEnd={() => setTabDrag(null)}
                    onClick={() => activateTab(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activateTab(tab.id);
                        return;
                      }
                      const previousKey = isVertical ? "ArrowUp" : "ArrowLeft";
                      const nextKey = isVertical ? "ArrowDown" : "ArrowRight";
                      if (event.key !== previousKey && event.key !== nextKey) {
                        return;
                      }
                      event.preventDefault();
                      const direction = event.key === previousKey ? -1 : 1;
                      const nextIndex =
                        (tabIndex + direction + visibleTabs.length) %
                        visibleTabs.length;
                      const nextTab = visibleTabs[nextIndex];
                      if (!nextTab) return;
                      activateTab(nextTab.id);
                      requestAnimationFrame(() =>
                        tabRefs.current.get(nextTab.id)?.focus(),
                      );
                    }}
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
                      <button
                        type="button"
                        aria-label={`Close ${tab.title}`}
                        className="rounded-[3px] p-0.5 opacity-0 transition-opacity hover:bg-[hsl(var(--wb-hover))] group-hover:opacity-100 group-focus-within:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeVisibleTab(tab.id);
                        }}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-48 bg-background-elevated border-border text-foreground">
                  {allowSplit && tab.type === "query" && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-[11px] cursor-pointer focus:bg-background-tertiary">
                        <PanelRight size={12} className="mr-2" />
                        Split Editor
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-40 bg-background-elevated border-border text-foreground">
                        {(
                          [
                            ["left", "Split Left", PanelLeft],
                            ["right", "Split Right", PanelRight],
                            ["up", "Split Up", PanelTop],
                            ["down", "Split Down", PanelBottom],
                          ] as const
                        ).map(([direction, label, Icon]) => (
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
                    </DropdownMenuSub>
                  )}
                  {allowSplit && tab.type === "query" && (
                    <DropdownMenuSeparator className="bg-border" />
                  )}
                  {canCompareSource && compareTargets.length > 0 && (
                    <>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="text-[11px] cursor-pointer focus:bg-background-tertiary">
                          <Rows3 size={12} className="mr-2" />
                          Compare Data With
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto bg-background-elevated border-border text-foreground">
                          {compareTargets.map((candidate) => (
                            <DropdownMenuItem
                              key={candidate.id}
                              className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                              onClick={() => {
                                openDataCompareTab(tab.id, candidate.id);
                                setContextMenuTabId(null);
                              }}
                            >
                              <TabIcon
                                type={candidate.type}
                                isFile={Boolean(candidate.fileRelativePath)}
                                isImage={Boolean(candidate.filePreview)}
                              />
                              <span className="ml-2 truncate">
                                {candidate.title}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator className="bg-border" />
                    </>
                  )}
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
                      closeVisibleTab(tab.id);
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
                      closeVisibleOtherTabs(tab.id);
                    }}
                    className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                  >
                    <X size={12} className="mr-2" />
                    Close Others
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      closeVisibleTabs(
                        visibleTabs
                          .slice(0, tabIndex)
                          .filter((candidate) => !candidate.isPinned)
                          .map((candidate) => candidate.id),
                      );
                    }}
                    className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                    disabled={!canCloseLeft}
                  >
                    <X size={12} className="mr-2" />
                    Close to the Left
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      closeVisibleTabs(
                        visibleTabs
                          .slice(tabIndex + 1)
                          .filter((candidate) => !candidate.isPinned)
                          .map((candidate) => candidate.id),
                      );
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
                      closeVisibleAllTabs();
                    }}
                    className="text-[11px] cursor-pointer focus:bg-background-tertiary"
                  >
                    <X size={12} className="mr-2" />
                    Close All
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Fragment>
          );
        })}
      </div>

      {/* Overflow dropdown */}
      {hasOverflow && (
        <div
          className={cn(
            "flex shrink-0 items-center border-[hsl(var(--wb-border-subtle))]",
            isVertical
              ? "h-9 w-full justify-center border-t px-1"
              : "h-full border-l px-1",
          )}
        >
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
              align={isVertical ? "start" : "end"}
              side={
                isVertical
                  ? tabPlacement === "right"
                    ? "left"
                    : "right"
                  : "bottom"
              }
              className="w-56 bg-background-elevated border-border text-foreground max-h-[400px] overflow-y-auto"
            >
              {organizedTabs.map((organized) => {
                const tab = organized.tab;
                return (
                  <Fragment key={tab.id}>
                    {organized.startsRegularRegion && (
                      <DropdownMenuSeparator className="my-1 bg-border" />
                    )}
                    {organized.startsGroup && (
                      <DropdownMenuLabel className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {organized.groupLabel}
                      </DropdownMenuLabel>
                    )}
                    <DropdownMenuItem
                      className={cn(
                        "group/overflow flex cursor-pointer items-center gap-2 text-[11px]",
                        displayedActiveTabId === tab.id
                          ? "bg-background-tertiary text-foreground"
                          : "text-muted-foreground hover:text-foreground focus:bg-background-tertiary",
                      )}
                      onClick={() => activateTab(tab.id)}
                    >
                      {tab.isPinned && (
                        <Pin size={10} className="text-primary" />
                      )}
                      <TabIcon
                        type={tab.type}
                        isFile={Boolean(tab.fileRelativePath)}
                        isImage={Boolean(tab.filePreview)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {tab.title}
                      </span>
                      {hasUnsavedTabChanges(tab) && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--wb-accent))]"
                          title="Unsaved changes"
                        />
                      )}
                      {!tab.isPinned && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            closeVisibleTab(tab.id);
                          }}
                          className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background-elevated group-hover/overflow:opacity-100 focus-visible:opacity-100"
                          aria-label={`Close ${tab.title}`}
                        >
                          <X size={10} />
                        </button>
                      )}
                    </DropdownMenuItem>
                  </Fragment>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* New tab button */}
      <div
        className={cn(
          "flex shrink-0 items-center border-[hsl(var(--wb-border-subtle))]",
          isVertical
            ? "h-9 w-full justify-center border-t px-1"
            : "h-full border-l px-2",
        )}
      >
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
        <div
          className={cn(
            "flex shrink-0 items-center border-[hsl(var(--wb-border-subtle))] px-1",
            isVertical
              ? "h-8 w-full justify-center border-t"
              : "h-full border-l",
          )}
        >
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