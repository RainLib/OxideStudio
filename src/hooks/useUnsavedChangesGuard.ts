import { confirmDiscardAllTabChanges } from "@/store/useTabStore";
import { useEffect } from "react";

/** Protect project files and table edits when the desktop window is closed. */
export function useUnsavedChangesGuard() {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((event) => {
          if (!confirmDiscardAllTabChanges("close the window")) {
            event.preventDefault();
          }
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
