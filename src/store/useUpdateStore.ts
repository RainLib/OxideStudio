import { create } from "zustand";
import {
  AppUpdateUnsupportedError,
  checkForAppUpdate,
  downloadAppUpdate,
  getCurrentAppVersion,
  installAppUpdateAndRestart,
  type AppUpdateInfo,
} from "@/services/appUpdateService";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "unsupported"
  | "error";

interface CheckForUpdatesOptions {
  force?: boolean;
}

interface AppUpdateState {
  currentVersion: string;
  update: AppUpdateInfo | null;
  status: AppUpdateStatus;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installAndRestart: () => Promise<void>;
  clearError: () => void;
}

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const LAST_CHECK_STORAGE_KEY = "oxide-update-last-check";

function readLastCheck(): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = Number(localStorage.getItem(LAST_CHECK_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeLastCheck(value: number) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LAST_CHECK_STORAGE_KEY, String(value));
  } catch {
    // A blocked storage backend must not prevent update checks.
  }
}

function describeUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("public key") || normalized.includes("signature")) {
    return "This build is not configured with a trusted update signing key.";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return "The update server could not be reached. Check your network and try again.";
  }

  return message || "The update operation failed.";
}

function isBusy(status: AppUpdateStatus) {
  return status === "checking" || status === "downloading" || status === "installing";
}

export const useUpdateStore = create<AppUpdateState>((set, get) => ({
  currentVersion: "",
  update: null,
  status: "idle",
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  lastCheckedAt: readLastCheck(),

  checkForUpdates: async (options = {}) => {
    const state = get();
    if (isBusy(state.status) || state.status === "downloaded") return;

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
      const currentVersion = await getCurrentAppVersion();
      const update = await checkForAppUpdate();
      const checkedAt = Date.now();
      writeLastCheck(checkedAt);
      set({
        currentVersion,
        update,
        status: update ? "available" : "up-to-date",
        downloadedBytes: 0,
        totalBytes: null,
        lastCheckedAt: checkedAt,
      });
    } catch (error) {
      if (error instanceof AppUpdateUnsupportedError) {
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

  downloadUpdate: async () => {
    if (get().status !== "available") return;

    set({
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
    });
    try {
      await downloadAppUpdate(({ downloadedBytes, totalBytes }) => {
        set({ downloadedBytes, totalBytes });
      });
      set((state) => ({
        status: "downloaded",
        downloadedBytes: state.totalBytes ?? state.downloadedBytes,
      }));
    } catch (error) {
      set({ status: "available", error: describeUpdateError(error) });
    }
  },

  installAndRestart: async () => {
    if (get().status !== "downloaded") return;

    set({ status: "installing", error: null });
    try {
      await installAppUpdateAndRestart();
    } catch (error) {
      set({ status: "downloaded", error: describeUpdateError(error) });
    }
  },

  clearError: () => set({ error: null }),
}));
