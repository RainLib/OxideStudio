import { getVersion } from "@tauri-apps/api/app";
import { Channel, isTauri, Resource } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import packageJson from "../../package.json";
import { invokeRawCommand } from "@/services/tauri/client";

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

export interface AppUpdateInstallationStatus {
  installationId: string | null;
  phase: "idle" | "preparing" | "installing" | "restartRequired";
  recoveryRequired: boolean;
  message: string | null;
}

interface UpdatePreparation {
  token: string;
  ready: boolean;
}

export class AppUpdatePreparationCancelled extends Error {
  constructor() {
    super("Update preparation cancelled. Backup scheduling has resumed.");
    this.name = "AppUpdatePreparationCancelled";
  }
}

export class AppUpdateRestartRequired extends Error {
  constructor() {
    super("The update was installed. Restart OxideStudio to resume backups.");
    this.name = "AppUpdateRestartRequired";
  }
}

export class AppUpdateUnsupportedError extends Error {
  constructor() {
    super("Application updates are only available in the desktop app.");
    this.name = "AppUpdateUnsupportedError";
  }
}

let activeUpdate: Update | null = null;
let downloadedUpdate: Resource | null = null;
interface InstallationSession {
  bytesRid: number;
  token: string | null;
  cancelled: boolean;
  submitted: boolean;
  release: Promise<void> | null;
}
let installation: InstallationSession | null = null;

function releasePreparation(session: InstallationSession): Promise<void> {
  session.release ??= invokeRawCommand<void>("cancel_app_update_preparation", {
    bytesRid: session.bytesRid,
    token: session.token,
  });
  return session.release;
}

async function replaceActiveUpdate(update: Update | null) {
  if (installation) throw new Error("Finish the current update preparation before checking again.");
  const previousUpdate = activeUpdate;
  activeUpdate = update;
  const previousDownload = downloadedUpdate;
  downloadedUpdate = null;
  await previousDownload?.close().catch(() => undefined);

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

  const update = activeUpdate;
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = handleEvent;
  const rid = await invokeRawCommand<number>("download_app_update", { updateRid: update.rid, onEvent: channel });
  const resource = new Resource(rid);
  if (activeUpdate !== update) {
    await resource.close();
    throw new Error("The available update changed during download. Download it again.");
  }
  await downloadedUpdate?.close().catch(() => undefined);
  downloadedUpdate = resource;
}

export async function installAppUpdateAndRestart(
  onPhase?: (phase: "preparing" | "installing") => void,
): Promise<void> {
  if (!activeUpdate || !downloadedUpdate) {
    throw new Error("No downloaded application update is ready to install.");
  }
  if (installation) throw new Error("An update is already being prepared or installed.");
  const session: InstallationSession = { bytesRid: downloadedUpdate.rid, token: null, cancelled: false, submitted: false, release: null };
  installation = session;
  try {
    onPhase?.("preparing");
    let prepared = await invokeRawCommand<UpdatePreparation>("prepare_app_update", { bytesRid: session.bytesRid });
    session.token = prepared.token;
    while (!prepared.ready && !session.cancelled) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      if (session.cancelled) break;
      prepared = await invokeRawCommand<UpdatePreparation>("poll_app_update_preparation", { bytesRid: session.bytesRid, token: session.token });
    }
    if (session.cancelled) throw new AppUpdatePreparationCancelled();
    onPhase?.("installing");
    session.submitted = true;
    await invokeRawCommand<void>("install_app_update", { bytesRid: session.bytesRid, token: session.token });
    try {
      await relaunch();
    } catch {
      throw new AppUpdateRestartRequired();
    }
  } catch (error) {
    if (session.cancelled) throw new AppUpdatePreparationCancelled();
    throw error;
  } finally {
    try {
      if (!session.submitted && session.token) {
        // A submitted native installation owns its rollback. A renderer error
        // must never release the barrier while that installation is in flight.
        await releasePreparation(session);
      }
    } finally {
      installation = null;
    }
  }
}

export async function cancelAppUpdatePreparation(): Promise<void> {
  const session = installation;
  if (!session) return;
  if (session.submitted) throw new Error("The installer has started. Finish the installation before restarting.");
  session.cancelled = true;
  if (session.token) await releasePreparation(session);
}

export async function getAppUpdateInstallationStatus(): Promise<AppUpdateInstallationStatus> {
  requireDesktopRuntime();
  return invokeRawCommand("get_app_update_installation_status");
}

export async function recoverAppUpdateBackups(installationId: string): Promise<void> {
  requireDesktopRuntime();
  await invokeRawCommand("recover_app_update_backups", { installationId });
}

export async function restartAfterAppUpdate(): Promise<void> {
  requireDesktopRuntime();
  await relaunch();
}

export async function disposeAppUpdate(): Promise<void> {
  await replaceActiveUpdate(null);
}

