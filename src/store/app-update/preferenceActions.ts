import type { AppUpdateGet, AppUpdateSet } from "./contracts";
import { writeIgnoredUpdateVersion } from "./storage";

export function createUpdatePreferenceActions(
  set: AppUpdateSet,
  get: AppUpdateGet,
) {
  return {
    ignoreAvailableVersion: () => {
      const version = get().update?.version || null;
      if (!version) return;
      writeIgnoredUpdateVersion(version);
      set({
        ignoredVersion: version,
        update: null,
        status: "idle",
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      });
    },
    clearError: () => set({ error: null }),
  };
}
