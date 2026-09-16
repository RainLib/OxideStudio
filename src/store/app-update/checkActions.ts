import type { AppUpdateGet, AppUpdateSet, CheckForUpdatesOptions } from "./contracts";
import {
  describeUpdateError,
  isUpdateBusy,
  isUpdateVersionIgnored,
  UPDATE_CHECK_INTERVAL_MS,
} from "./policy";
import { writeLastUpdateCheck } from "./storage";

export function createUpdateCheckActions(set: AppUpdateSet, get: AppUpdateGet) {
  return {
    checkForUpdates: async (options: CheckForUpdatesOptions = {}) => {
      const state = get();
      if (isUpdateBusy(state.status) || state.status === "downloaded") return;

      const now = Date.now();
      if (
        !options.force &&
        state.lastCheckedAt !== null &&
        now - state.lastCheckedAt < UPDATE_CHECK_INTERVAL_MS
      ) {
        return;
      }

      set({ status: "checking", error: null });
      try {
        const { checkForAppUpdate, getCurrentAppVersion } =
          await import("@/services/appUpdateService");
        const currentVersion = await getCurrentAppVersion();
        const update = await checkForAppUpdate();
        const checkedAt = Date.now();
        const ignored = Boolean(
          update &&
            !options.force &&
            isUpdateVersionIgnored(update.version, get().ignoredVersion),
        );
        writeLastUpdateCheck(checkedAt);
        set({
          currentVersion,
          update: ignored ? null : update,
          status: ignored ? "up-to-date" : update ? "available" : "up-to-date",
          downloadedBytes: 0,
          totalBytes: null,
          lastCheckedAt: checkedAt,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "AppUpdateUnsupportedError"
        ) {
          const { getCurrentAppVersion } =
            await import("@/services/appUpdateService");
          const currentVersion = await getCurrentAppVersion();
          set({ currentVersion, status: "unsupported", error: null });
          return;
        }
        set({
          status: state.update ? "available" : "error",
          error: describeUpdateError(error),
        });
      }
    },
  };
}
