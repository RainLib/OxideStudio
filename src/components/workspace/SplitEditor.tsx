import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { tabPlacementFlexDirection } from "@/lib/tabOrganization";
import { useTabStore } from "@/store/useTabStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useShallow } from "zustand/react/shallow";
import {
  adjacentEditorGroup,
  editorGroupInDirection,
  editorGroups,
  useEditorGroupStore,
  type EditorGroupId,
  type EditorGroupNode,
  type EditorLayoutNode,
  type EditorSplitNode,
} from "@/store/useEditorGroupStore";
import {
  APP_EVENT_VIM_WINDOW_NAVIGATE,
  type VimWindowNavigation,
} from "@/lib/vimMode";
import { QueryEditor } from "./QueryEditor";
import { TabBar } from "./TabBar";

function SplitNodeView({
  node,
  renderNode,
}: {
  node: EditorSplitNode;
  renderNode: (node: EditorLayoutNode) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(50);
  const horizontal = node.direction === "left" || node.direction === "right";

  const startResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const resize = (moveEvent: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const rawRatio = horizontal
        ? ((moveEvent.clientX - rect.left) / rect.width) * 100
        : ((moveEvent.clientY - rect.top) / rect.height) * 100;
      setRatio(Math.max(15, Math.min(85, rawRatio)));
    };
    const stop = () => {
      document.removeEventListener("mousemove", resize);
      document.removeEventListener("mouseup", stop);
    };
    document.addEventListener("mousemove", resize);
    document.addEventListener("mouseup", stop);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1",
        horizontal ? "flex-row" : "flex-col"
      )}
    >
      <div className="min-h-0 min-w-0" style={{ flexBasis: `calc(${ratio}% - 2px)` }}>
        {renderNode(node.children[0])}
      </div>
      <div
        className={cn(
          "shrink-0 bg-[hsl(var(--wb-border))]",
          horizontal
            ? "w-1 cursor-col-resize hover:bg-[hsl(var(--wb-accent)/0.65)]"
            : "h-1 cursor-row-resize hover:bg-[hsl(var(--wb-accent)/0.65)]"
        )}
        onMouseDown={startResize}
        aria-hidden="true"
      />
      <div className="min-h-0 min-w-0" style={{ flexBasis: `calc(${100 - ratio}% - 2px)` }}>
        {renderNode(node.children[1])}
      </div>
    </div>
  );
}

export function SplitEditor() {
  const tabPlacement = useSettingsStore(
    (state) => state.settings.editor.tabPlacement,
  );
  const groupLayoutClass = tabPlacementFlexDirection(tabPlacement);
  const queryTabIdList = useTabStore(
    useShallow((state) =>
      state.tabs.filter((tab) => tab.type === "query").map((tab) => tab.id),
    ),
  );
  const globalActiveTabId = useTabStore((state) => state.activeTabId);
  const setActiveTab = useTabStore((state) => state.setActiveTab);
  const { root, activeGroup, setActiveGroup, setGroupTab, closeGroup, reset } =
    useEditorGroupStore();
  const queryTabIds = new Set(queryTabIdList);
  const fallbackTabId =
    (globalActiveTabId && queryTabIds.has(globalActiveTabId)
      ? globalActiveTabId
      : queryTabIdList[0]) || null;

  useEffect(() => {
    if (queryTabIdList.length === 0) {
      reset();
      return;
    }
    for (const group of editorGroups(root)) {
      if (!group.tabId || !queryTabIds.has(group.tabId)) {
        setGroupTab(group.id, fallbackTabId);
      }
    }
  }, [fallbackTabId, queryTabIdList.length, reset, root, setGroupTab]);

  useEffect(() => {
    if (globalActiveTabId && queryTabIds.has(globalActiveTabId)) {
      setGroupTab(activeGroup, globalActiveTabId);
    }
  }, [activeGroup, globalActiveTabId, setGroupTab]);

  const activate = (group: EditorGroupId, tabId: string) => {
    setActiveGroup(group);
    setGroupTab(group, tabId);
    setActiveTab(tabId);
  };

  const close = (group: EditorGroupId) => {
    closeGroup(group);
    const nextState = useEditorGroupStore.getState();
    const remaining = editorGroups(nextState.root).find(
      (item) => item.id === nextState.activeGroup
    );
    if (remaining?.tabId) setActiveTab(remaining.tabId);
  };

  const navigateFromGroup = useCallback(
    (groupId: EditorGroupId, direction: VimWindowNavigation) => {
      if (direction === "close") {
        useEditorGroupStore.getState().closeGroup(groupId);
        const nextState = useEditorGroupStore.getState();
        const remaining = editorGroups(nextState.root).find(
          (item) => item.id === nextState.activeGroup,
        );
        if (remaining?.tabId) setActiveTab(remaining.tabId);
        return;
      }

      const state = useEditorGroupStore.getState();
      const target =
        direction === "next" || direction === "previous"
          ? adjacentEditorGroup(state.root, groupId, direction === "previous")
          : editorGroupInDirection(state.root, groupId, direction);
      if (!target?.tabId || target.id === groupId) {
        window.dispatchEvent(
          new CustomEvent(APP_EVENT_VIM_WINDOW_NAVIGATE, {
            detail: { direction, source: "editor" },
          }),
        );
        return;
      }
      useEditorGroupStore.getState().setActiveGroup(target.id);
      setActiveTab(target.tabId);
    },
    [setActiveTab],
  );
  const vimNavigationHandlers = useMemo(
    () =>
      new Map(
        editorGroups(root).map((group) => [
          group.id,
          (direction: VimWindowNavigation) =>
            navigateFromGroup(group.id, direction),
        ]),
      ),
    [navigateFromGroup, root],
  );

  const renderGroup = (group: EditorGroupNode) => {
    const tabId =
      group.tabId && queryTabIds.has(group.tabId) ? group.tabId : fallbackTabId;
    if (!tabId) return null;
    const isActive = group.id === activeGroup;
    return (
      <section
        key={group.id}
        className={cn(
          "flex h-full min-h-0 min-w-0 overflow-hidden bg-[hsl(var(--wb-editor))]",
          groupLayoutClass,
          isActive && "shadow-[inset_0_0_0_1px_hsl(var(--wb-accent)/0.42)]"
        )}
        onPointerDown={() => activate(group.id, tabId)}
        data-editor-group={group.id}
      >
        <TabBar
          activeTabIdOverride={tabId}
          queryOnly
          compact
          onSelectTab={(nextTabId) => activate(group.id, nextTabId)}
          onCloseGroup={() => close(group.id)}
        />
        <div className="min-h-0 min-w-0 flex-1">
          <QueryEditor
            tabId={tabId}
            isActivePane={isActive}
            editorGroupId={group.id}
            onActivate={() => activate(group.id, tabId)}
            onVimWindowNavigate={vimNavigationHandlers.get(group.id)}
          />
        </div>
      </section>
    );
  };

  const renderNode = (node: EditorLayoutNode): ReactNode =>
    node.type === "group" ? (
      renderGroup(node)
    ) : (
      <SplitNodeView key={node.id} node={node} renderNode={renderNode} />
    );

  return <>{renderNode(root)}</>;
}
