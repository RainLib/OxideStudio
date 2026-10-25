// Runs only inside the isolated, packaged WebView built by test-desktop-updater.
// The production update service and native IPC commands are used without mocks.
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { appConfigDir, appDataDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkForAppUpdate,
  downloadAppUpdate,
  getAppUpdateInstallationStatus,
  installAppUpdateAndRestart,
  recoverAppUpdateBackups,
} from "@/services/appUpdateService";

const endpoint = __OXIDE_UPDATE_FIXTURE_ENDPOINT__;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(route, body) {
  const response = await fetch(`${endpoint}/${route}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Fixture ${route} returned ${response.status}`);
  return response.json();
}
const report = (stage, details = {}) => request("events", { stage, ...details });

async function command(name, args) {
  const response = await invoke(name, args);
  if (response && typeof response === "object" && "success" in response) {
    if (!response.success) throw new Error(response.error?.message ?? `Command ${name} failed`);
    return response.data;
  }
  return response;
}

async function waitFor(condition, description, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function queuePair(plans) {
  await request("control", { action: "block" });
  for (const scheduleId of plans) {
    await command("run_sqlite_backup_schedule", { request: { scheduleId, trigger: "manual" } });
  }
  await waitFor(async () => {
    const runs = await command("list_sqlite_backup_runs");
    return runs.some((run) => run.status === "running") && runs.some((run) => run.status === "queued");
  }, "the blocked running backup and its queued successor");
}

async function startInstallation(stage) {
  const update = await checkForAppUpdate();
  if (!update) throw new Error("The isolated update was not offered");
  await downloadAppUpdate(() => {});
  const install = installAppUpdateAndRestart((phase) => {
    if (phase === "preparing") void report(stage);
  });
  await install;
  throw new Error("Windows install unexpectedly returned without exiting its old process");
}

async function initial(config) {
  const plans = [];
  for (let index = 1; index <= 2; index++) {
    const projectId = `${config.runId}-project-${index}`;
    const connectionId = `${config.runId}-sqlite-${index}`;
    const now = Date.now();
    await command("save_project", { project: { id: projectId, name: `Updater fixture ${index}`, created_at: now, updated_at: now } });
    await command("save_connection", { connection: {
      id: connectionId, project_id: projectId, name: "Isolated SQLite", driver: "sqlite",
      config: { database: config.source }, created_at: now, updated_at: now,
    } });
    const plan = await command("save_sqlite_backup_schedule", { request: {
      name: `Installer project ${index}`, projectId, connectionId, destinationDirectory: config.backups,
      frequency: "hourly", intervalHours: 1, timeOfDay: "02:00", timeZone: "UTC",
      weekday: 1, retentionCount: 5, compression: "none", enabled: false,
    } });
    plans.push(plan.id);
  }
  await report("plans-saved", { plans });
  await checkForAppUpdate();
  let signatureError = "";
  try { await downloadAppUpdate(() => {}); } catch (error) {
    signatureError = error instanceof Error ? error.message : String(error);
  }
  if (!/signature verification failed/i.test(signatureError)) {
    throw new Error(`Expected a cryptographic payload/signature mismatch, received: ${signatureError || "download accepted"}`);
  }
  await report("signature-rejected", { signatureError, status: await getAppUpdateInstallationStatus() });
  await queuePair(plans);
  await startInstallation("failure-preparing");
}

async function recovery(config) {
  const status = await getAppUpdateInstallationStatus();
  if (!status.recoveryRequired || !status.installationId) throw new Error("The failed external installer did not leave a recovery barrier");
  const before = await command("list_sqlite_backup_runs");
  await report("recovery-reviewed", { status, runs: before });
  // The orchestrator verified that its own failing installer process exited.
  await request("control", { action: "recovery-acknowledged" });
  await recoverAppUpdateBackups(status.installationId);
  await waitFor(async () => {
    const runs = await command("list_sqlite_backup_runs");
    return runs.length === 2 && runs.every((run) => run.status === "success") && runs;
  }, "both recovered backups");
  await report("failure-recovered", { runs: await command("list_sqlite_backup_runs"), status: await getAppUpdateInstallationStatus() });
  await queuePair(config.plans);
  await startInstallation("success-preparing");
}

async function updated() {
  const runs = await waitFor(async () => {
    const found = await command("list_sqlite_backup_runs");
    return found.length === 4 && found.every((run) => run.status === "success") && found;
  }, "four completed backups after the actual application update");
  const status = await getAppUpdateInstallationStatus();
  if (status.phase !== "idle") throw new Error("The new application did not release the installation barrier");
  await report("updated", { version: await getVersion(), status, runs });
  await getCurrentWindow().close();
}

try {
  const config = await request("config");
  setInterval(() => {
    void request("config").then((current) => {
      if (current.phase === "shutdown") return getCurrentWindow().close();
    }).catch(() => {});
  }, 500);
  const version = await getVersion();
  await report("webview-ready", { version, data: await appDataDir(), config: await appConfigDir() });
  if (version === config.toVersion) await updated();
  else if (version !== config.fromVersion) throw new Error(`Unexpected installed version ${version}`);
  else if (config.phase === "recovery") await recovery(config);
  else await initial(config);
} catch (error) {
  await report("error", { message: error instanceof Error ? error.stack ?? error.message : String(error) }).catch(() => {});
  await getCurrentWindow().close().catch(() => {});
}
