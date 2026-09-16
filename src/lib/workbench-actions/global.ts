import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  APP_EVENT_OPEN_COMMAND_PALETTE,
  APP_EVENT_OPEN_SETTINGS,
} from "@/lib/actionEvents";
import { settingsService } from "@/services/tauri/settings.service";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { WorkbenchAction } from "./contracts";
import { dispatchWorkbenchActionEvent } from "./events";

export function createGlobalWorkbenchActions(): WorkbenchAction[] {
  return [
    {
      id: "commandPalette.open",
      title: "Open Command Palette",
      group: "Workbench",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_OPEN_COMMAND_PALETTE),
    },
    {
      id: "settings.open",
      title: "Open Settings",
      group: "Settings",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_OPEN_SETTINGS),
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
  ];
}
