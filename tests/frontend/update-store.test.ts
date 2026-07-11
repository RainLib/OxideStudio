/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/appUpdateService", () => {
  class AppUpdateUnsupportedError extends Error {}
  return {
    AppUpdateUnsupportedError,
    getCurrentAppVersion: vi.fn(),
    checkForAppUpdate: vi.fn(),
    downloadAppUpdate: vi.fn(),
    installAppUpdateAndRestart: vi.fn(),
  };
});

import {
  checkForAppUpdate,
  downloadAppUpdate,
  getCurrentAppVersion,
  installAppUpdateAndRestart,
} from "@/services/appUpdateService";
import { useUpdateStore } from "@/store/useUpdateStore";

const update = {
  currentVersion: "0.1.0",
  version: "0.2.0",
  date: "2026-07-11T00:00:00Z",
  body: "New release",
};

describe("update store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getCurrentAppVersion).mockReset();
    vi.mocked(checkForAppUpdate).mockReset();
    vi.mocked(downloadAppUpdate).mockReset();
    vi.mocked(installAppUpdateAndRestart).mockReset();
    useUpdateStore.setState({
      currentVersion: "",
      update: null,
      status: "idle",
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      lastCheckedAt: null,
    });
  });

  it("records an available update without downloading it", async () => {
    vi.mocked(getCurrentAppVersion).mockResolvedValue("0.1.0");
    vi.mocked(checkForAppUpdate).mockResolvedValue(update);

    await useUpdateStore.getState().checkForUpdates({ force: true });

    expect(useUpdateStore.getState()).toMatchObject({
      currentVersion: "0.1.0",
      update,
      status: "available",
      downloadedBytes: 0,
    });
    expect(downloadAppUpdate).not.toHaveBeenCalled();
  });

  it("tracks download progress and waits for explicit installation", async () => {
    useUpdateStore.setState({ status: "available", update });
    vi.mocked(downloadAppUpdate).mockImplementation(async (onProgress) => {
      onProgress({ downloadedBytes: 40, totalBytes: 100 });
      onProgress({ downloadedBytes: 100, totalBytes: 100 });
    });

    await useUpdateStore.getState().downloadUpdate();

    expect(useUpdateStore.getState()).toMatchObject({
      status: "downloaded",
      downloadedBytes: 100,
      totalBytes: 100,
    });
    expect(installAppUpdateAndRestart).not.toHaveBeenCalled();
  });

  it("installs only from the downloaded state", async () => {
    vi.mocked(installAppUpdateAndRestart).mockResolvedValue();

    await useUpdateStore.getState().installAndRestart();
    expect(installAppUpdateAndRestart).not.toHaveBeenCalled();

    useUpdateStore.setState({ status: "downloaded", update });
    await useUpdateStore.getState().installAndRestart();

    expect(installAppUpdateAndRestart).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState().status).toBe("installing");
  });
});

