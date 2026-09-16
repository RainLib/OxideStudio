import { create } from "zustand";
import { createUpdateCheckActions } from "./checkActions";
import type { AppUpdateState } from "./contracts";
import { createUpdateDownloadActions } from "./downloadActions";
import { createUpdateInstallActions } from "./installActions";
import { createUpdatePreferenceActions } from "./preferenceActions";
import { readIgnoredUpdateVersion, readLastUpdateCheck } from "./storage";

export function createAppUpdateStore() {
  return create<AppUpdateState>((set, get) => ({
    currentVersion: "",
    update: null,
    status: "idle",
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    lastCheckedAt: readLastUpdateCheck(),
    ignoredVersion: readIgnoredUpdateVersion(),
    ...createUpdateCheckActions(set, get),
    ...createUpdateDownloadActions(set, get),
    ...createUpdateInstallActions(set, get),
    ...createUpdatePreferenceActions(set, get),
  }));
}
