import { confirmDiscardAllTabChanges, hasUnsavedTabChanges, useTabStore } from "@/store/useTabStore";
import { useEffect } from "react";

/** Protect project files and table edits when the desktop window is closed. */
export function useUnsavedChangesGuard() {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let confirming = false;

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(async (event) => {
          if (!useTabStore.getState().tabs.some(hasUnsavedTabChanges)) return;
          // Prevent synchronously: an async UI cannot block the native event.
          event.preventDefault();
          if (confirming) return;
          confirming = true;
          try {
            if (await confirmDiscardAllTabChanges("close the window")) {
              if (!disposed) await getCurrentWindow().destroy();
            }
          } finally { confirming = false; }
        })
      )
      .then((disposeListener) => {
        if (disposed) {
          disposeListener();
          return;
        }
        unlisten = disposeListener;
      })
      .catch(() => {
        // The web-only development surface has no Tauri window event source.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
