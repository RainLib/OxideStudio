import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import packageJson from "../../package.json";

export interface AppUpdateInfo {
  currentVersion: string;
  version: string;
  date: string | null;
  body: string | null;
}

export interface AppUpdateDownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
}

export class AppUpdateUnsupportedError extends Error {
  constructor() {
    super("Application updates are only available in the desktop app.");
    this.name = "AppUpdateUnsupportedError";
  }
}

let activeUpdate: Update | null = null;

async function replaceActiveUpdate(update: Update | null) {
  const previousUpdate = activeUpdate;
  activeUpdate = update;

  if (previousUpdate && previousUpdate !== update) {
    await previousUpdate.close().catch(() => undefined);
  }
}

function requireDesktopRuntime() {
  if (!isTauri()) {
    throw new AppUpdateUnsupportedError();
  }
}

function mapUpdate(update: Update): AppUpdateInfo {
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date ?? null,
    body: update.body ?? null,
  };
}

export async function getCurrentAppVersion(): Promise<string> {
  if (!isTauri()) {
    return packageJson.version;
  }

  return getVersion();
}

export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  requireDesktopRuntime();

  const update = await check({ timeout: 15_000, allowDowngrades: false });
  await replaceActiveUpdate(update);
  return update ? mapUpdate(update) : null;
}

export async function downloadAppUpdate(
  onProgress: (progress: AppUpdateDownloadProgress) => void
): Promise<void> {
  if (!activeUpdate) {
    throw new Error("No application update is ready to download.");
  }

  let downloadedBytes = 0;
  let totalBytes: number | null = null;

  const handleEvent = (event: DownloadEvent) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? null;
      downloadedBytes = 0;
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
    } else if (event.event === "Finished" && totalBytes !== null) {
      downloadedBytes = totalBytes;
    }

    onProgress({ downloadedBytes, totalBytes });
  };

  await activeUpdate.download(handleEvent, { timeout: 120_000 });
}

export async function installAppUpdateAndRestart(): Promise<void> {
  if (!activeUpdate) {
    throw new Error("No downloaded application update is ready to install.");
  }

  await activeUpdate.install();
  await relaunch();
}

export async function disposeAppUpdate(): Promise<void> {
  await replaceActiveUpdate(null);
}

