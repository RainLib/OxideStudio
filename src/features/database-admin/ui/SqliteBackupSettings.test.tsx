// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listRuns: vi.fn(),
  listArtifacts: vi.fn(),
  previewDelete: vi.fn(),
  workerStatus: vi.fn(),
  setBackground: vi.fn(),
  saveSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  runSchedule: vi.fn(),
  cancelRun: vi.fn(),
  deleteRun: vi.fn(),
  ensureConnection: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("@/services/tauri/database.service", () => ({
  databaseService: {
    listSqliteBackupSchedules: mocks.listSchedules,
    listSqliteBackupRuns: mocks.listRuns,
    listSqliteBackupArtifacts: mocks.listArtifacts,
    previewSqliteBackupFileDelete: mocks.previewDelete,
    getSqliteBackupWorkerStatus: mocks.workerStatus,
    setSqliteBackupBackgroundEnabled: mocks.setBackground,
    saveSqliteBackupSchedule: mocks.saveSchedule,
    deleteSqliteBackupSchedule: mocks.deleteSchedule,
    runSqliteBackupSchedule: mocks.runSchedule,
    cancelSqliteBackupRun: mocks.cancelRun,
    deleteSqliteBackupRun: mocks.deleteRun,
  },
}));

vi.mock("@/store/useConnectionStore", () => ({
  useConnectionStore: (selector: (state: unknown) => unknown) =>
    selector({
      connections: [
        {
          id: "sqlite-1",
          name: "Local analytics",
          driver: "sqlite",
        },
      ],
    }),
  ensureConnectionReadyInBackground: mocks.ensureConnection,
}));

vi.mock("@/store/useProjectStore", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({ activeProjectId: "project-1", projects: [{ id: "project-1", name: "Project 1" }] }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openPath }));

import { SqliteBackupSettings } from "./SqliteBackupSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (item) => item.textContent?.includes(label) || item.getAttribute("aria-label") === label,
  );
}

describe("SqliteBackupSettings", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.listSchedules.mockReset().mockResolvedValue([]);
    mocks.listRuns.mockReset().mockResolvedValue([]);
    mocks.listArtifacts.mockReset().mockResolvedValue({ items: [], nextCursor: null });
    mocks.previewDelete.mockReset().mockImplementation(async (id: string) => ({ id, filePath: null, byteLen: null, reviewRequired: false, confirmationToken: null }));
    mocks.workerStatus.mockReset().mockResolvedValue({ backgroundEnabled: false, running: true });
    mocks.setBackground.mockReset().mockResolvedValue({ backgroundEnabled: true, running: true });
    mocks.saveSchedule.mockReset().mockResolvedValue({ id: "schedule-1" });
    mocks.deleteSchedule.mockReset().mockResolvedValue(true);
    mocks.runSchedule.mockReset().mockResolvedValue({ status: "success" });
    mocks.cancelRun.mockReset().mockResolvedValue(true);
    mocks.deleteRun.mockReset().mockResolvedValue(true);
    mocks.ensureConnection.mockReset().mockResolvedValue({ status: "ready" });
    mocks.openPath.mockReset().mockResolvedValue("C:/backups");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("enables background backups only after the Host accepts the setting", async () => {
    await act(async () => root.render(<SqliteBackupSettings />));
    await flush();
    const toggle = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle?.checked).toBe(false);
    await act(async () => toggle?.click());
    await flush();
    expect(mocks.setBackground).toHaveBeenCalledWith(true);
    expect(toggle?.checked).toBe(true);
    expect(document.body.textContent).toContain("when you sign in");
  });

  it("keeps background backups off and explains a rejected startup registration", async () => {
    mocks.setBackground.mockRejectedValue(new Error("Startup manager unavailable"));
    await act(async () => root.render(<SqliteBackupSettings />));
    await flush();
    const toggle = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => toggle?.click());
    await flush();
    expect(toggle?.checked).toBe(false);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Startup manager unavailable");
  });

  it("shows upgrade and legacy-worker guidance without changing saved preferences", async () => {
    mocks.workerStatus.mockResolvedValue({ backgroundEnabled: true, running: true, upgrading: true,
      message: "Finishing the current backup before upgrading the worker. Queued backups will resume automatically" });
    await act(async () => root.render(<SqliteBackupSettings />));
    await flush();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Queued backups will resume automatically");
    expect(mocks.setBackground).not.toHaveBeenCalled();
    mocks.workerStatus.mockResolvedValue({ backgroundEnabled: true, running: true, upgrading: false,
      message: "An existing backup worker cannot be upgraded automatically. Close it from the previous OxideStudio version" });
    await act(async () => button("Refresh")?.click());
    await flush();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("previous OxideStudio version");
    expect(mocks.setBackground).not.toHaveBeenCalled();
  });

  it("shows Host progress and lets the user cancel the active run", async () => {
    mocks.listSchedules.mockResolvedValue([
      {
        id: "schedule-1",
        name: "Nightly app",
        projectId: "project-1",
        connectionId: "sqlite-1",
        destinationDirectory: "C:/backups",
        frequency: "daily",
        intervalHours: 24,
        timeOfDay: "02:00",
        weekday: 1,
        retentionCount: 7,
        enabled: true,
        createdAt: "2026-08-31T00:00:00Z",
        updatedAt: "2026-08-31T00:00:00Z",
        nextRunAt: "2026-09-01T02:00:00Z",
        lastRunAt: null,
        lastRunStatus: null,
      },
    ]);
    mocks.listRuns.mockResolvedValue([
      {
        id: "run-1",
        scheduleId: "schedule-1",
        scheduleName: "Nightly app",
        projectId: "project-1",
        connectionId: "sqlite-1",
        destinationDirectory: "C:/backups",
        trigger: "scheduled",
        status: "running",
        startedAt: "2026-08-31T00:00:00Z",
        completedAt: null,
        filePath: "C:/backups/oxide-sqlite-backup__Nightly.sqlite",
        byteLen: null,
        integrityCheck: null,
        progressPercent: 42,
        error: null,
      },
    ]);

    await act(async () => root.render(<SqliteBackupSettings />));
    await flush();

    expect(document.body.textContent).toContain("Nightly app");
    expect(document.body.textContent).toContain("42%");
    expect(document.body.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("42");

    await act(async () => button("Cancel")?.click());
    await flush();
    expect(mocks.cancelRun).toHaveBeenCalledWith("run-1");
  });

  it("creates a project-scoped schedule from a desktop-picked directory", async () => {
    await act(async () => root.render(<SqliteBackupSettings />));
    await flush();

    await act(async () => button("Add schedule")?.click());
    const folderButton = Array.from(document.body.querySelectorAll("button")).find(
      (item) => item.querySelector("svg") && !item.textContent,
    );
    // The first icon-only button inside the editor is the folder picker.
    await act(async () => folderButton?.click());
    await flush();
    expect(mocks.openPath).toHaveBeenCalledWith({
      title: "Choose scheduled backup folder",
      directory: true,
      multiple: false,
    });

    const compressionSelect = Array.from(document.body.querySelectorAll("label"))
      .find((item) => item.textContent?.includes("Compression"))
      ?.querySelector("select");
    expect(compressionSelect).not.toBeNull();
    await act(async () => {
      if (!compressionSelect) return;
      compressionSelect.value = "gzip";
      compressionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => button("Save schedule")?.click());
    await flush();
    expect(mocks.ensureConnection).not.toHaveBeenCalled();
    expect(mocks.saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        connectionId: "sqlite-1",
        destinationDirectory: "C:/backups",
        frequency: "daily",
        retentionCount: 7,
        compression: "gzip",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
  });

  it("retains legacy system time until the user explicitly chooses a named zone", async () => {
    mocks.listSchedules.mockResolvedValue([{
      id: "schedule-legacy", name: "Legacy plan", projectId: "project-1", connectionId: "sqlite-1",
      destinationDirectory: "C:/backups", frequency: "daily", intervalHours: 24,
      timeOfDay: "02:00", weekday: 1, retentionCount: 7, compression: "none", enabled: true,
      createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", nextRunAt: "2026-10-22T02:00:00Z",
    }]);
    await act(async () => root.render(<SqliteBackupSettings />));
    await flush();
    expect(host.textContent).toContain("Daily at 02:00 · System time zone");
    await act(async () => button("Edit schedule")?.click());
    const zone = Array.from(host.querySelectorAll("label")).find((label) => label.textContent?.startsWith("Time zone"))?.querySelector("select");
    expect(zone?.value).toBe("system");
    expect(host.querySelector(`#${CSS.escape(zone?.getAttribute("aria-describedby") ?? "")}`)?.textContent).toContain("including when it changes");
    await act(async () => { if (zone) { zone.value = "America/New_York"; zone.dispatchEvent(new Event("change", { bubbles: true })); } });
    await act(async () => button("Save schedule")?.click());
    await flush();
    expect(mocks.saveSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: "schedule-legacy", timeZone: "America/New_York" }));
  });

  it("preserves the saved zone when re-enabling a plan paused by the Host", async () => {
    mocks.listSchedules.mockResolvedValue([{
      id: "schedule-zoned", name: "Zoned plan", projectId: "project-1", connectionId: "sqlite-1",
      destinationDirectory: "C:/backups", frequency: "daily", intervalHours: 24,
      timeOfDay: "02:00", timeZone: "Asia/Shanghai", weekday: 1, retentionCount: 7, compression: "none", enabled: false,
      createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", nextRunAt: "2026-10-21T18:00:00Z",
      schedulingError: "Unknown backup time zone",
    }]);
    await act(async () => root.render(<SqliteBackupSettings />));
    await flush();
    expect(host.textContent).toContain("Daily at 02:00 · Asia/Shanghai");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Review the timing settings and enable this schedule to resume");
    await act(async () => button("Enable Zoned plan")?.click());
    await flush();
    expect(mocks.saveSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: "schedule-zoned", timeZone: "Asia/Shanghai", enabled: true }));
    expect(mocks.ensureConnection).not.toHaveBeenCalled();
  });

  it("filters backup history by status and text without discarding records", async () => {
    mocks.listRuns.mockResolvedValue([
      {
        id: "run-success",
        scheduleId: "schedule-1",
        scheduleName: "Nightly analytics",
        projectId: "project-1",
        connectionId: "sqlite-1",
        destinationDirectory: "C:/backups",
        compression: "gzip",
        trigger: "scheduled",
        status: "success",
        startedAt: "2026-08-31T00:00:00Z",
        filePath: "C:/backups/nightly.sqlite.gz",
        byteLen: 42,
        progressPercent: 100,
      },
      {
        id: "run-failed",
        scheduleId: "schedule-2",
        scheduleName: "Hourly cache",
        projectId: "project-1",
        connectionId: "sqlite-1",
        destinationDirectory: "C:/backups",
        compression: "none",
        trigger: "manual",
        status: "failed",
        startedAt: "2026-08-31T01:00:00Z",
        error: "Disk full",
        progressPercent: 80,
      },
    ]);

    await act(async () => root.render(<SqliteBackupSettings />));
    await flush();
    expect(document.body.textContent).toContain("Nightly analytics");
    expect(document.body.textContent).toContain("Hourly cache");

    const status = document.body.querySelector(
      'select[aria-label="Filter backup status"]',
    ) as HTMLSelectElement;
    await act(async () => {
      status.value = "failed";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.body.textContent).not.toContain("Nightly analytics");
    expect(document.body.textContent).toContain("Hourly cache");

    const search = document.body.querySelector(
      'input[aria-label="Filter backup history"]',
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "nightly",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain(
      "No backup runs match the current filters.",
    );
  });
});
