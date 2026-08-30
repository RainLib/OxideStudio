// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listRuns: vi.fn(),
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
    selector({ activeProjectId: "project-1" }),
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

    await act(async () => button("Save schedule")?.click());
    await flush();
    expect(mocks.ensureConnection).toHaveBeenCalledWith("sqlite-1");
    expect(mocks.saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        connectionId: "sqlite-1",
        destinationDirectory: "C:/backups",
        frequency: "daily",
        retentionCount: 7,
      }),
    );
  });
});
