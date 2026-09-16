import { startWorkspaceHydration } from "@/startup/startupProgress";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useEffect } from "react";

export function WorkspaceStartupHydration() {
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
  }, [loadConnections, loadDatabaseDriverCatalog, loadProjects, loadSettings]);

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
