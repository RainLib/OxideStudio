import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchTask } from "@/store/useTaskStore";
import { useTaskStore } from "@/store/useTaskStore";

const updateService = vi.hoisted(() => ({
  downloadAppUpdate: vi.fn(),
  installAppUpdateAndRestart: vi.fn(),
  checkForAppUpdate: vi.fn(),
  getCurrentAppVersion: vi.fn(),
}));

vi.mock("@/services/appUpdateService", () => ({
  ...updateService,
  AppUpdateUnsupportedError: class AppUpdateUnsupportedError extends Error {},
}));

import {
  activeUpdateBlockingTaskCount,
  useUpdateStore,
} from "./useUpdateStore";

const availableUpdate = {
  currentVersion: "1.0.0",
  version: "1.1.0",
  date: null,
  body: "Background update",
};

function task(status: WorkbenchTask["status"]): WorkbenchTask {
  return {
    id: `task-${status}`,
    kind: "query",
    title: "Database query",
    status,
    startedAt: 1,
  };
}

describe("application update state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    updateService.downloadAppUpdate.mockReset();
    updateService.installAppUpdateAndRestart.mockReset();
    updateService.checkForAppUpdate.mockReset();
    updateService.getCurrentAppVersion.mockReset();
    useTaskStore.setState({ tasks: [] });
    useUpdateStore.setState({
      currentVersion: "1.0.0",
      update: availableUpdate,
      status: "available",
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      lastCheckedAt: null,
      ignoredVersion: null,
    });
  });

  it("counts only tasks that make an update restart unsafe", () => {
    expect(
      activeUpdateBlockingTaskCount([
        task("running"),
        task("waiting"),
        task("success"),
        task("error"),
      ]),
    ).toBe(2);
  });

  it("keeps the download in global state after its launching surface closes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const publishedBytes: number[] = [];
    const unsubscribe = useUpdateStore.subscribe((state) => {
      if (state.status === "downloading" && state.downloadedBytes > 0) {
        publishedBytes.push(state.downloadedBytes);
      }
    });
    updateService.downloadAppUpdate.mockImplementation(async (onProgress) => {
      onProgress({ downloadedBytes: 10, totalBytes: 100 });
      onProgress({ downloadedBytes: 20, totalBytes: 100 });
      onProgress({ downloadedBytes: 30, totalBytes: 100 });
      onProgress({ downloadedBytes: 100, totalBytes: 100 });
    });

    await useUpdateStore.getState().downloadUpdate();
    unsubscribe();

    expect(updateService.downloadAppUpdate).toHaveBeenCalledTimes(1);
    expect(publishedBytes).toEqual([10, 100]);
    expect(useUpdateStore.getState()).toMatchObject({
      status: "downloaded",
      downloadedBytes: 100,
      totalBytes: 100,
      error: null,
    });
  });

  it("publishes the first progress event when the server omits content length", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    const publishedBytes: number[] = [];
    const unsubscribe = useUpdateStore.subscribe((state) => {
      if (state.status === "downloading" && state.downloadedBytes > 0) {
        publishedBytes.push(state.downloadedBytes);
      }
    });
    updateService.downloadAppUpdate.mockImplementation(async (onProgress) => {
      onProgress({ downloadedBytes: 12, totalBytes: null });
      onProgress({ downloadedBytes: 24, totalBytes: null });
    });

    await useUpdateStore.getState().downloadUpdate();
    unsubscribe();

    expect(publishedBytes).toEqual([12]);
    expect(useUpdateStore.getState()).toMatchObject({
      status: "downloaded",
      downloadedBytes: 24,
      totalBytes: null,
    });
  });

  it("coalesces concurrent attempts into the active background download", async () => {
    let finishDownload: (() => void) | undefined;
    updateService.downloadAppUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve;
        }),
    );

    const first = useUpdateStore.getState().downloadUpdate();
    const second = useUpdateStore.getState().downloadUpdate();
    expect(useUpdateStore.getState().status).toBe("downloading");
    await vi.waitFor(() => {
      expect(updateService.downloadAppUpdate).toHaveBeenCalledTimes(1);
    });

    finishDownload?.();
    await Promise.all([first, second]);
    expect(useUpdateStore.getState().status).toBe("downloaded");
  });

  it("blocks installation while workbench tasks are active", async () => {
    useUpdateStore.setState({ status: "downloaded" });
    useTaskStore.setState({ tasks: [task("running"), task("waiting")] });

    await useUpdateStore.getState().installAndRestart();

    expect(updateService.installAppUpdateAndRestart).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("downloaded");
    expect(useUpdateStore.getState().error).toContain("2 active background tasks");
  });

  it("installs only after all active tasks reach a terminal state", async () => {
    updateService.installAppUpdateAndRestart.mockResolvedValue(undefined);
    useUpdateStore.setState({ status: "downloaded" });
    useTaskStore.setState({ tasks: [task("success"), task("cancelled")] });

    await useUpdateStore.getState().installAndRestart();

    expect(updateService.installAppUpdateAndRestart).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().status).toBe("installing");
  });
});
