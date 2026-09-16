import { DEFAULT_APP_SETTINGS } from "@/features/settings/model/defaultSettings";
import { normalizeAppSettings } from "@/features/settings/model/normalizeSettings";
import { type AppSettings } from "@/features/settings/model/settingsTypes";

export const STARTUP_APPEARANCE_CACHE_KEY = "oxide-studio-appearance-cache-v1";

export function readStartupAppearanceCache(): AppSettings["appearance"] {
  if (typeof window === "undefined") {
    return DEFAULT_APP_SETTINGS.appearance;
  }
  try {
    const cached = window.localStorage.getItem(STARTUP_APPEARANCE_CACHE_KEY);
    if (!cached) return DEFAULT_APP_SETTINGS.appearance;
    return normalizeAppSettings({ appearance: JSON.parse(cached) }).appearance;
  } catch {
    return DEFAULT_APP_SETTINGS.appearance;
  }
}

export function writeStartupAppearanceCache(
  appearance: AppSettings["appearance"],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STARTUP_APPEARANCE_CACHE_KEY,
      JSON.stringify(appearance),
    );
  } catch {
    // This cache is an optional first-paint optimization. The persisted Tauri
    // settings document remains the source of truth.
  }
}
