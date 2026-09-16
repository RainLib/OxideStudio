import type { WorkbenchToolWindowId } from "@/features/settings/model/settingsTypes";
import {
  APP_EVENT_OPEN_COMMAND_PALETTE,
  APP_EVENT_OPEN_COMMIT,
  APP_EVENT_OPEN_VERSION_CONTROL,
} from "@/lib/actionEvents";
import { APP_EVENT_OPEN_PROJECT_FILES } from "@/lib/projectFilesNavigation";
import { subscribeStartupIntents } from "@/startup/startupIntents";
import { startWorkspaceHydration } from "@/startup/startupProgress";
import { APP_EVENT_OPEN_ASSISTANT } from "@/store/useAssistantComposerStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useEffect } from "react";

interface UseWorkbenchSurfaceEventsContext {
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
  resetEditorGroups: () => void;
  activeConnectionId: string | null;
  currentSchema: string | null;
}

export function useWorkbenchSurfaceEvents({
  setToolWindowVisible,
  setActiveToolWindow,
  resetEditorGroups,
  activeConnectionId,
  currentSchema,
}: UseWorkbenchSurfaceEventsContext) {
  useEffect(() => {
    const openProjectFiles = () => {
      setToolWindowVisible("projectFiles", true);
      setActiveToolWindow("projectFiles");
    };
    window.addEventListener(APP_EVENT_OPEN_PROJECT_FILES, openProjectFiles);
    return () =>
      window.removeEventListener(
        APP_EVENT_OPEN_PROJECT_FILES,
        openProjectFiles,
      );
  }, [setActiveToolWindow, setToolWindowVisible]);

  useEffect(() => {
    const openAssistant = () => {
      setToolWindowVisible("assistant", true);
      setActiveToolWindow("assistant");
    };
    window.addEventListener(APP_EVENT_OPEN_ASSISTANT, openAssistant);
    return () =>
      window.removeEventListener(APP_EVENT_OPEN_ASSISTANT, openAssistant);
  }, [setActiveToolWindow, setToolWindowVisible]);

  useEffect(
    () =>
      subscribeStartupIntents((intent) => {
        if (typeof intent !== "string") {
          setToolWindowVisible("databaseExplorer", true);
          setActiveToolWindow("databaseExplorer");
          void startWorkspaceHydration({
            loadProjects: useProjectStore.getState().loadProjects,
            loadSettings: useSettingsStore.getState().loadSettings,
            loadConnections: useConnectionStore.getState().loadConnections,
          }).then(async () => {
            const connectionStore = useConnectionStore.getState();
            await connectionStore.loadConnections();
            const error = await connectionStore.setActiveConnection(
              intent.connectionId,
            );
            if (error) {
              console.warn(
                `Unable to open startup data source ${intent.connectionId}: ${error}`,
              );
            }
          });
          return;
        }
        if (intent === "new-query") {
          resetEditorGroups();
          useTabStore.getState().createTab("query", "New Query", "", {
            connectionId: activeConnectionId || undefined,
            schemaName: currentSchema || undefined,
          });
          return;
        }
        if (intent === "project-files") {
          setToolWindowVisible("projectFiles", true);
          setActiveToolWindow("projectFiles");
          return;
        }
        window.queueMicrotask(() => {
          window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_COMMAND_PALETTE));
        });
      }),
    [
      activeConnectionId,
      currentSchema,
      resetEditorGroups,
      setActiveToolWindow,
      setToolWindowVisible,
    ],
  );

  useEffect(() => {
    const openCommit = () => setToolWindowVisible("commit", true);
    const openVersionControl = () =>
      setToolWindowVisible("versionControl", true);
    window.addEventListener(APP_EVENT_OPEN_COMMIT, openCommit);
    window.addEventListener(APP_EVENT_OPEN_VERSION_CONTROL, openVersionControl);
    return () => {
      window.removeEventListener(APP_EVENT_OPEN_COMMIT, openCommit);
      window.removeEventListener(
        APP_EVENT_OPEN_VERSION_CONTROL,
        openVersionControl,
      );
    };
  }, [setToolWindowVisible]);
}
