import type { AppUpdateGet, AppUpdateSet } from "./contracts";
import {
  describeUpdateError,
  UPDATE_PROGRESS_PUBLISH_INTERVAL_MS,
} from "./policy";

export function createUpdateDownloadActions(set: AppUpdateSet, get: AppUpdateGet) {
  return {
    downloadUpdate: async () => {
      if (get().status !== "available") return;
      set({
        status: "downloading",
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      });
      try {
        const { downloadAppUpdate } = await import("@/services/appUpdateService");
        let hasPublishedProgress = false;
        let lastPublishedAt = 0;
        let lastObservedDownloadedBytes = 0;
        let lastTotalBytes: number | null = null;
        await downloadAppUpdate(({ downloadedBytes, totalBytes }) => {
          lastObservedDownloadedBytes = downloadedBytes;
          const now = Date.now();
          const totalChanged = totalBytes !== lastTotalBytes;
          const completed = totalBytes !== null && downloadedBytes >= totalBytes;
          if (
            !hasPublishedProgress ||
            totalChanged ||
            completed ||
            now - lastPublishedAt >= UPDATE_PROGRESS_PUBLISH_INTERVAL_MS
          ) {
            hasPublishedProgress = true;
            lastPublishedAt = now;
            lastTotalBytes = totalBytes;
            set({ downloadedBytes, totalBytes });
          }
        });
        set({
          status: "downloaded",
          downloadedBytes: lastTotalBytes ?? lastObservedDownloadedBytes,
          totalBytes: lastTotalBytes,
        });
      } catch (error) {
        set({ status: "available", error: describeUpdateError(error) });
      }
    },
  };
}
