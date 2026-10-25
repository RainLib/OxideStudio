import { afterEach, describe, expect, it, vi } from "vitest";
import { backupTimeZoneChoices, defaultBackupTimeZone, displayNextBackup } from "./sqliteBackupTimeZone";
import type { SqliteBackupSchedule } from "@/services/tauri/types";

afterEach(() => vi.unstubAllGlobals());

describe("backup time zone presentation", () => {
  it("formats the next instant in the saved zone and preserves unavailable identifiers", () => {
    const plan = { enabled: true, nextRunAt: "2026-10-21T18:00:00Z", timeZone: "Asia/Shanghai" } as SqliteBackupSchedule;
    expect(displayNextBackup(plan)).toBe(new Intl.DateTimeFormat(undefined, {
      month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai", timeZoneName: "short",
    }).format(new Date(plan.nextRunAt)));
    expect(displayNextBackup({ ...plan, timeZone: "Bad/Zone" })).toContain("2026-10-21T18:00:00.000Z · time zone unavailable");
    expect(backupTimeZoneChoices("Saved/Unavailable")).toContain("Saved/Unavailable");
  });

  it("keeps usable choices in older WebViews without silently choosing UTC", () => {
    vi.stubGlobal("Intl", { DateTimeFormat: () => { throw new Error("unavailable"); } });
    expect(defaultBackupTimeZone()).toBe("system");
    expect(backupTimeZoneChoices("Asia/Shanghai")).toEqual(expect.arrayContaining(["UTC", "Asia/Shanghai", "America/New_York"]));
    expect(backupTimeZoneChoices("system")).not.toContain("system");
  });
});
