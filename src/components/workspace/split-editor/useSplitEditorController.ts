import { useCallback, useEffect, useMemo } from "react";
import { APP_EVENT_VIM_WINDOW_NAVIGATE, type VimWindowNavigation } from "@/lib/vimMode";
import { tabPlacementFlexDirection } from "@/lib/tabOrganization";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import {
  adjacentEditorGroup,
  editorGroupInDirection,
  editorGroups,
  useEditorGroupStore,
  type EditorGroupId,
} from "@/store/useEditorGroupStore";
import { useShallow } from "zustand/react/shallow";

export function useSplitEditorController() {
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
  const queryTabIds = useMemo(() => new Set(queryTabIdList), [queryTabIdList]);
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

  const activate = useCallback(
    (group: EditorGroupId, tabId: string) => {
      setActiveGroup(group);
      setGroupTab(group, tabId);
      setActiveTab(tabId);
    },
    [setActiveGroup, setActiveTab, setGroupTab],
  );
  const close = useCallback(
    (group: EditorGroupId) => {
      closeGroup(group);
      const nextState = useEditorGroupStore.getState();
      const remaining = editorGroups(nextState.root).find(
        (item) => item.id === nextState.activeGroup,
      );
      if (remaining?.tabId) setActiveTab(remaining.tabId);
    },
    [closeGroup, setActiveTab],
  );
  const navigateFromGroup = useCallback(
    (groupId: EditorGroupId, direction: VimWindowNavigation) => {
      if (direction === "close") {
        close(groupId);
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
    [close, setActiveTab],
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

  return {
    root,
    activeGroup,
    fallbackTabId,
    groupLayoutClass,
    queryTabIds,
    activate,
    close,
    vimNavigationHandlers,
  };
}
