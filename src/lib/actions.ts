import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { settingsService } from "@/services/tauri/settings.service";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";

export type WorkbenchActionId =
  | "commandPalette.open"
  | "settings.open"
  | "settings.openJson"
  | "window.new"
  | "query.newConsole"
  | "query.reopenClosed"
  | "query.closeTab"
  | "query.run"
  | "query.runCurrentStatement"
  | "query.format"
  | "workbench.toggleDatabaseExplorer"
  | "workbench.toggleAssistant"
  | "workbench.toggleResults"
  | "workbench.focusEditor"
  | "workbench.focusDatabaseExplorer"
  | "workbench.focusAssistant"
  | "workbench.focusResults"
  | "workbench.moveActiveToolWindowLeft"
  | "workbench.moveActiveToolWindowRight"
  | "workbench.resizeActiveToolWindowLeft"
  | "workbench.resizeActiveToolWindowRight"
  | "workbench.resizeActiveToolWindowUp"
  | "workbench.resizeActiveToolWindowDown";

export type WorkbenchAction = {
  id: WorkbenchActionId;
  title: string;
  group: "Workbench" | "Query" | "Window" | "Settings";
  run: () => void | Promise<void>;
};

export const APP_EVENT_RUN_QUERY = "oxide:run-query";
export const APP_EVENT_RUN_CURRENT = "oxide:run-current";
export const APP_EVENT_FORMAT_SQL = "oxide:format-sql";
export const APP_EVENT_OPEN_COMMAND_PALETTE = "oxide:open-command-palette";
export const APP_EVENT_OPEN_SETTINGS = "oxide:open-settings";

export function workbenchActions(): WorkbenchAction[] {
  return [
    {
      id: "commandPalette.open",
      title: "Open Command Palette",
      group: "Workbench",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_COMMAND_PALETTE));
      },
    },
    {
      id: "settings.open",
      title: "Open Settings",
      group: "Settings",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_SETTINGS));
      },
    },
    {
      id: "settings.openJson",
      title: "Open Settings JSON",
      group: "Settings",
      run: async () => {
        const settings = useSettingsStore.getState().settings;
        await settingsService.saveAppSettings(settings);
        await openPath(await settingsService.getAppSettingsPath());
      },
    },
    {
      id: "window.new",
      title: "New Window",
      group: "Window",
      run: async () => {
        await invoke<string>("create_new_window");
      },
    },
    {
      id: "query.newConsole",
      title: "New Query Console",
      group: "Query",
      run: () => {
        useTabStore.getState().createTab("query", "New Query", "");
      },
    },
    {
      id: "query.reopenClosed",
      title: "Reopen Closed Tab",
      group: "Query",
      run: () => useTabStore.getState().reopenTab(),
    },
    {
      id: "query.closeTab",
      title: "Close Active Tab",
      group: "Query",
      run: () => {
        const { activeTabId, closeTab } = useTabStore.getState();
        if (activeTabId) closeTab(activeTabId);
      },
    },
    {
      id: "query.run",
      title: "Run Query",
      group: "Query",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_RUN_QUERY));
      },
    },
    {
      id: "query.runCurrentStatement",
      title: "Run Current Statement",
      group: "Query",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_RUN_CURRENT));
      },
    },
    {
      id: "query.format",
      title: "Format Query",
      group: "Query",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_FORMAT_SQL));
      },
    },
    {
      id: "workbench.toggleDatabaseExplorer",
      title: "Toggle Database Explorer",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().toggleToolWindow("databaseExplorer"),
    },
    {
      id: "workbench.toggleAssistant",
      title: "Toggle AI Assistant",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().toggleToolWindow("assistant"),
    },
    {
      id: "workbench.toggleResults",
      title: "Toggle Results",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().toggleToolWindow("results"),
    },
    {
      id: "workbench.focusEditor",
      title: "Focus Editor",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().setActiveToolWindow("editor"),
    },
    {
      id: "workbench.focusDatabaseExplorer",
      title: "Focus Database Explorer",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().setActiveToolWindow("databaseExplorer"),
    },
    {
      id: "workbench.focusAssistant",
      title: "Focus AI Assistant",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().setActiveToolWindow("assistant"),
    },
    {
      id: "workbench.focusResults",
      title: "Focus Results",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().setActiveToolWindow("results"),
    },
    {
      id: "workbench.moveActiveToolWindowLeft",
      title: "Move Active Tool Window Left",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().moveActiveToolWindow("left"),
    },
    {
      id: "workbench.moveActiveToolWindowRight",
      title: "Move Active Tool Window Right",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().moveActiveToolWindow("right"),
    },
    {
      id: "workbench.resizeActiveToolWindowLeft",
      title: "Resize Active Tool Window Left",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().resizeActiveToolWindow("left"),
    },
    {
      id: "workbench.resizeActiveToolWindowRight",
      title: "Resize Active Tool Window Right",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().resizeActiveToolWindow("right"),
    },
    {
      id: "workbench.resizeActiveToolWindowUp",
      title: "Resize Active Tool Window Up",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().resizeActiveToolWindow("up"),
    },
    {
      id: "workbench.resizeActiveToolWindowDown",
      title: "Resize Active Tool Window Down",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().resizeActiveToolWindow("down"),
    },
  ];
}

export function findWorkbenchAction(id: string) {
  return workbenchActions().find((action) => action.id === id);
}
