import type {
  WorkbenchToolWindowId,
  WorkbenchToolWindows,
} from "@/features/settings/model/settingsTypes";
import type { EditorSplitDirection } from "@/store/useEditorGroupStore";
import { useEffect, useLayoutEffect } from "react";

interface UseWorkbenchSessionLifecycleContext {
  loadSavedSqlProject: (projectId: string) => Promise<void>;
  activeProjectId: string;
  queryTabSignature: string;
  splitDirection: EditorSplitDirection | null;
  resetEditorGroups: () => void;
  hasQueryResultSurface: boolean;
  toolWindows: WorkbenchToolWindows;
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
}

export function useWorkbenchSessionLifecycle({
  loadSavedSqlProject,
  activeProjectId,
  queryTabSignature,
  splitDirection,
  resetEditorGroups,
  hasQueryResultSurface,
  toolWindows,
  setToolWindowVisible,
}: UseWorkbenchSessionLifecycleContext) {
  useEffect(() => {
    void loadSavedSqlProject(activeProjectId);
  }, [activeProjectId, loadSavedSqlProject]);

  useEffect(() => {
    if (!queryTabSignature && splitDirection) {
      resetEditorGroups();
    }
  }, [queryTabSignature, resetEditorGroups, splitDirection]);

  useLayoutEffect(() => {
    if (hasQueryResultSurface && toolWindows.results.enabled) {
      setToolWindowVisible("results", true);
    }
  }, [
    hasQueryResultSurface,
    setToolWindowVisible,
    toolWindows.results.enabled,
  ]);
}
