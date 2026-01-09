import { useEffect } from "react";
import { useTabStore } from "@/store/useTabStore";
import { invoke } from "@tauri-apps/api/core";

export const APP_EVENT_RUN_QUERY = "oxide:run-query";
export const APP_EVENT_RUN_CURRENT = "oxide:run-current";
export const APP_EVENT_FORMAT_SQL = "oxide:format-sql";

export function useShortcuts() {
  const { activeTabId, createTab, closeTab, reopenTab } = useTabStore();

  useEffect(() => {
    console.log("[useShortcuts] Registering keyboard shortcuts");

    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      console.log("[useShortcuts] Key pressed:", {
        key: e.key,
        isMod,
        isShift,
        target: e.target,
      });

      // ⌘ + ⇧ + N: New Window
      if (isMod && isShift && e.key.toLowerCase() === "n") {
        console.log(
          "[useShortcuts] Matched Cmd+Shift+N, creating new window..."
        );
        e.preventDefault();
        try {
          const windowLabel = await invoke<string>("create_new_window");
          console.log("New window created:", windowLabel);
        } catch (error) {
          console.error("Failed to create new window:", error);
        }
      }

      // ⌘ + T: New Tab
      if (isMod && e.key === "t" && !isShift) {
        e.preventDefault();
        createTab("query", "New Query", "");
      }

      // ⌘ + ⇧ + T: Reopen Tab
      if (isMod && isShift && e.key === "t") {
        e.preventDefault();
        reopenTab();
      }

      // ⌘ + W: Close Active Tab
      if (isMod && e.key === "w") {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
      }

      // ⌘ + Enter: Run Query
      if (isMod && e.key === "Enter" && !isShift) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(APP_EVENT_RUN_QUERY));
      }

      // ⌘ + ⇧ + Enter: Run Current
      if (isMod && isShift && e.key === "Enter") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(APP_EVENT_RUN_CURRENT));
      }

      // ⌘ + L: Format
      if (isMod && e.key === "l") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(APP_EVENT_FORMAT_SQL));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, createTab, closeTab, reopenTab]);
}
