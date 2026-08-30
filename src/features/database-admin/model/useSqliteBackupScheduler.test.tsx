// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  runSchedule: vi.fn(),
  ensureConnection: vi.fn(),
}));

vi.mock("@/services/tauri/database.service", () => ({
  databaseService: {
    listSqliteBackupSchedules: mocks.listSchedules,
    runSqliteBackupSchedule: mocks.runSchedule,
  },
}));
vi.mock("@/store/useConnectionStore", () => ({
  ensureConnectionReadyInBackground: mocks.ensureConnection,
}));
vi.mock("@/store/useProjectStore", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({ activeProjectId: "project-1" }),
}));

import { useSqliteBackupScheduler } from "./useSqliteBackupScheduler";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useSqliteBackupScheduler();
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSqliteBackupScheduler", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.listSchedules.mockReset().mockResolvedValue([
      {
        id: "due-current-project",
        projectId: "project-1",
        connectionId: "sqlite-1",
        enabled: true,
        nextRunAt: "2020-01-01T00:00:00Z",
      },
      {
        id: "future-current-project",
        projectId: "project-1",
        connectionId: "sqlite-1",
        enabled: true,
        nextRunAt: "2099-01-01T00:00:00Z",
      },
      {
        id: "due-other-project",
        projectId: "project-2",
        connectionId: "sqlite-2",
        enabled: true,
        nextRunAt: "2020-01-01T00:00:00Z",
      },
    ]);
    mocks.ensureConnection.mockReset().mockResolvedValue({ status: "ready" });
    mocks.runSchedule.mockReset().mockResolvedValue({ status: "success" });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("runs only due schedules in the active project and restores sessions first", async () => {
    await act(async () => root.render(<Harness />));
    await flush();

    expect(mocks.ensureConnection).toHaveBeenCalledTimes(1);
    expect(mocks.ensureConnection).toHaveBeenCalledWith("sqlite-1");
    expect(mocks.runSchedule).toHaveBeenCalledWith(
      "due-current-project",
      "scheduled",
    );
  });
});
