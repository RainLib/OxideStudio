import type { SqliteBackupSchedule } from "@/services/tauri/types";

export function defaultBackupTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "system";
  } catch {
    return "system";
  }
}

export function backupTimeZoneChoices(current: string): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  let choices: string[] = [];
  try {
    choices = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    // Older WebViews still offer common zones and preserve saved identifiers.
  }
  return [...new Set([
    "UTC", "Asia/Shanghai", "Asia/Tokyo", "Asia/Kolkata", "Europe/London",
    "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney",
    defaultBackupTimeZone(), current, ...choices,
  ])].filter((zone) => zone !== "system").sort();
}

export function displayNextBackup(schedule: SqliteBackupSchedule): string {
  if (!schedule.enabled) return "Paused";
  const date = new Date(schedule.nextRunAt);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: schedule.timeZone || undefined,
      timeZoneName: "short",
    }).format(date);
  } catch {
    // Do not display a different zone as though it were the saved one.
    return `${date.toISOString()} · time zone unavailable`;
  }
}
