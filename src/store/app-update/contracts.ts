import type { AppUpdateInfo, AppUpdateInstallationStatus } from "@/services/appUpdateService";
import type { StoreApi } from "zustand";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "preparing"
  | "installing"
  | "restart-required"
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
  nativeInstallation: AppUpdateInstallationStatus | null;
  preparationCancelable: boolean;
  packageDownloaded: boolean;
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installAndRestart: () => Promise<void>;
  cancelInstallationPreparation: () => Promise<void>;
  refreshInstallationStatus: () => Promise<void>;
  recoverBackupsAfterUpdate: () => Promise<void>;
  restartInstalledUpdate: () => Promise<void>;
  ignoreAvailableVersion: () => void;
  clearError: () => void;
}

export type AppUpdateSet = StoreApi<AppUpdateState>["setState"];
export type AppUpdateGet = StoreApi<AppUpdateState>["getState"];
