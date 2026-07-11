import { invoke } from "@tauri-apps/api/core";

export const settingsService = {
  getAppSettings: async (): Promise<unknown> => {
    return await invoke("get_app_settings");
  },

  getAppSettingsPath: async (): Promise<string> => {
    return await invoke("get_app_settings_path");
  },

  saveAppSettings: async (settings: unknown): Promise<void> => {
    return await invoke("save_app_settings", { settings });
  },

  resetAppSettings: async (): Promise<void> => {
    return await invoke("reset_app_settings");
  },
};
