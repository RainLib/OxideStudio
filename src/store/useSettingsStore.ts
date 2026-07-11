import { create } from "zustand";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type AppSettings,
} from "@/lib/appSettings";
import { settingsService } from "@/services/tauri/settings.service";

type SettingsState = {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  setSettings: (settings: AppSettings) => Promise<void>;
  resetSettings: () => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_APP_SETTINGS,
  isLoading: false,
  error: null,

  loadSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const raw = await settingsService.getAppSettings();
      set({
        settings: normalizeAppSettings(raw),
        isLoading: false,
        error: null,
      });
    } catch (error: any) {
      set({
        isLoading: false,
        error: error?.message || String(error),
      });
    }
  },

  updateSettings: async (updates) => {
    const next = normalizeAppSettings(deepMerge(get().settings, updates));
    set({ settings: next, error: null });
    try {
      await settingsService.saveAppSettings(next);
    } catch (error: any) {
      set({ error: error?.message || String(error) });
      throw error;
    }
  },

  setSettings: async (settings) => {
    const next = normalizeAppSettings(settings);
    set({ settings: next, error: null });
    try {
      await settingsService.saveAppSettings(next);
    } catch (error: any) {
      set({ error: error?.message || String(error) });
      throw error;
    }
  },

  resetSettings: async () => {
    try {
      await settingsService.resetAppSettings();
      set({ settings: DEFAULT_APP_SETTINGS, error: null });
    } catch (error: any) {
      set({ error: error?.message || String(error) });
      throw error;
    }
  },
}));

function deepMerge<T extends Record<string, any>>(base: T, patch: Partial<T>): T {
  const next: Record<string, any> = { ...base };

  Object.entries(patch).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = deepMerge(next[key], value);
    } else if (value !== undefined) {
      next[key] = value;
    }
  });

  return next as T;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
