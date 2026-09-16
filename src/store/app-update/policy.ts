import type { WorkbenchTask } from "@/store/useTaskStore";
import type { AppUpdateStatus } from "./contracts";

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const UPDATE_PROGRESS_PUBLISH_INTERVAL_MS = 100;

export function activeUpdateBlockingTaskCount(
  tasks: readonly Pick<WorkbenchTask, "status">[],
) {
  return tasks.filter(
    (task) => task.status === "running" || task.status === "waiting",
  ).length;
}

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

export function describeUpdateError(error: unknown): string {
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

export function isUpdateBusy(status: AppUpdateStatus) {
  return (
    status === "checking" || status === "downloading" || status === "installing"
  );
}
