import type {
  AppSettings,
  SideToolWindowId,
  WorkbenchToolWindowId,
} from "@/features/settings/model/settingsTypes";
import {
  APP_EVENT_VIM_WINDOW_NAVIGATE,
  type VimWindowNavigation,
} from "@/lib/vimMode";
import { useTabStore } from "@/store/useTabStore";
import { useEffect } from "react";

interface UseWorkbenchWindowNavigationContext {
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
  leftToolWindow: SideToolWindowId | null;
  rightToolWindow: SideToolWindowId | null;
  showQueryResultPanel: boolean;
  appSettings: { editor: Pick<AppSettings["editor"], "keybindingMode"> };
  layout: Pick<AppSettings["workbench"]["layout"], "activeToolWindow">;
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
}

export function useWorkbenchWindowNavigation({
  setActiveToolWindow,
  leftToolWindow,
  rightToolWindow,
  showQueryResultPanel,
  appSettings,
  layout,
  setToolWindowVisible,
}: UseWorkbenchWindowNavigationContext) {
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
      const direction = (
        event as CustomEvent<{ direction?: VimWindowNavigation }>
      ).detail?.direction;
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
}
