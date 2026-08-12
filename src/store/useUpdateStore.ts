import { create } from "zustand";
import type { AppUpdateInfo } from "@/services/appUpdateService";

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
  ignoredVersion: string | null;
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installAndRestart: () => Promise<void>;
  ignoreAvailableVersion: () => void;
  clearError: () => void;
}

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const LAST_CHECK_STORAGE_KEY = "oxide-update-last-check";
const IGNORED_VERSION_STORAGE_KEY = "oxide-update-ignored-version";

function normalizedVersion(value: string) {
  return value.trim().replace(/^v/i, "").toLocaleLowerCase();
}

function parsedVersion(value: string) {
  const base = normalizedVersion(value).split(/[+-]/, 1)[0] || "";
  const parts = base.split(".");
  if (!parts.length || parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.map(Number);
}

export function isUpdateVersionIgnored(
  availableVersion: string,
  ignoredVersion: string | null,
) {
  if (!ignoredVersion) return false;
  const available = parsedVersion(availableVersion);
  const ignored = parsedVersion(ignoredVersion);
  if (!available || !ignored) {
    return normalizedVersion(availableVersion) === normalizedVersion(ignoredVersion);
  }
  const length = Math.max(available.length, ignored.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (available[index] || 0) - (ignored[index] || 0);
    if (difference) return difference < 0;
  }
  return true;
}

function readIgnoredVersion() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(IGNORED_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeIgnoredVersion(version: string | null) {
  try {
    if (typeof localStorage === "undefined") return;
    if (version) localStorage.setItem(IGNORED_VERSION_STORAGE_KEY, version);
    else localStorage.removeItem(IGNORED_VERSION_STORAGE_KEY);
  } catch {
    // Update preferences remain best-effort when storage is unavailable.
  }
}

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
  return (
    status === "checking" || status === "downloading" || status === "installing"
  );
}

export const useUpdateStore = create<AppUpdateState>((set, get) => ({
  currentVersion: "",
  update: null,
  status: "idle",
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  lastCheckedAt: readLastCheck(),
  ignoredVersion: readIgnoredVersion(),

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
      const { checkForAppUpdate, getCurrentAppVersion } =
        await import("@/services/appUpdateService");
      const currentVersion = await getCurrentAppVersion();
      const update = await checkForAppUpdate();
      const checkedAt = Date.now();
      writeLastCheck(checkedAt);
      set({
        currentVersion,
        update:
          update && !options.force && isUpdateVersionIgnored(update.version, get().ignoredVersion)
            ? null
            : update,
        status:
          update && !options.force && isUpdateVersionIgnored(update.version, get().ignoredVersion)
            ? "up-to-date"
            : update
              ? "available"
              : "up-to-date",
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
      const { installAppUpdateAndRestart } =
        await import("@/services/appUpdateService");
      await installAppUpdateAndRestart();
    } catch (error) {
      set({ status: "downloaded", error: describeUpdateError(error) });
    }
  },

  ignoreAvailableVersion: () => {
    const version = get().update?.version || null;
    if (!version) return;
    writeIgnoredVersion(version);
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
}));
