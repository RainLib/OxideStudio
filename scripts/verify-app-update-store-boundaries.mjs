import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/store/useUpdateStore.ts");
const moduleRoot = "src/store/app-update";
const contracts = read(`${moduleRoot}/contracts.ts`);
const policy = read(`${moduleRoot}/policy.ts`);
const storage = read(`${moduleRoot}/storage.ts`);
const checks = read(`${moduleRoot}/checkActions.ts`);
const downloads = read(`${moduleRoot}/downloadActions.ts`);
const installs = read(`${moduleRoot}/installActions.ts`);
const preferences = read(`${moduleRoot}/preferenceActions.ts`);
const factory = read(`${moduleRoot}/createAppUpdateStore.ts`);

for (const required of [
  "createAppUpdateStore",
  "AppUpdateStatus",
  "activeUpdateBlockingTaskCount",
  "isUpdateVersionIgnored",
]) {
  if (!facade.includes(required)) {
    throw new Error(`App update facade must retain ${required}.`);
  }
}

for (const source of [
  contracts,
  policy,
  storage,
  checks,
  downloads,
  installs,
  preferences,
  factory,
]) {
  if (source.includes("useUpdateStore")) {
    throw new Error("App update owners cannot import their compatibility facade.");
  }
}
if (
  contracts.includes("localStorage") ||
  policy.includes("localStorage") ||
  policy.includes("appUpdateService")
) {
  throw new Error("App update contracts and policy must stay free of storage and transport.");
}
if (
  !storage.includes("readLastUpdateCheck") ||
  !storage.includes("writeIgnoredUpdateVersion") ||
  storage.includes("appUpdateService")
) {
  throw new Error("App update storage must own only browser preferences.");
}
if (!checks.includes("checkForUpdates") || !checks.includes("checkForAppUpdate")) {
  throw new Error("App update check owner must retain update discovery.");
}
if (!downloads.includes("downloadUpdate") || !downloads.includes("downloadAppUpdate")) {
  throw new Error("App update download owner must retain progress lifecycle.");
}
if (
  !installs.includes("installAndRestart") ||
  !installs.includes("useTaskStore") ||
  installs.includes("downloadAppUpdate")
) {
  throw new Error("App update installation must own task gating without download lifecycle.");
}
if (
  !preferences.includes("ignoreAvailableVersion") ||
  !preferences.includes("clearError") ||
  preferences.includes("appUpdateService")
) {
  throw new Error("App update preferences must own ignored versions and error clearing.");
}
if (
  !factory.includes("createUpdateCheckActions") ||
  !factory.includes("createUpdateDownloadActions") ||
  !factory.includes("createUpdateInstallActions") ||
  !factory.includes("createUpdatePreferenceActions")
) {
  throw new Error("App update factory must compose every update action owner.");
}

console.log(
  "App update store boundaries verified: contract, policy, preference storage, check, download, install, and action composition are explicit.",
);
