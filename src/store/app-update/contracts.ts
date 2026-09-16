import type { AppUpdateInfo } from "@/services/appUpdateService";
import type { StoreApi } from "zustand";

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

export interface CheckForUpdatesOptions {
  force?: boolean;
}

export interface AppUpdateState {
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

export type AppUpdateSet = StoreApi<AppUpdateState>["setState"];
export type AppUpdateGet = StoreApi<AppUpdateState>["getState"];
