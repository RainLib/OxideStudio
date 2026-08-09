import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  getVersion: vi.fn(async () => "0.1.0"),
  check: vi.fn(),
  relaunch: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));

import {
  AppUpdateUnsupportedError,
  checkForAppUpdate,
  disposeAppUpdate,
  downloadAppUpdate,
  getCurrentAppVersion,
  installAppUpdateAndRestart,
} from "@/services/appUpdateService";

function createUpdate() {
  return {
    currentVersion: "0.1.0",
    version: "0.2.0",
    date: "2026-07-11T00:00:00Z",
    body: "- Faster metadata cache",
    download: vi.fn(),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("app update service", () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(true);
    mocks.getVersion.mockResolvedValue("0.1.0");
    mocks.check.mockReset();
    mocks.relaunch.mockClear();
  });

  afterEach(async () => {
    await disposeAppUpdate();
  });

  it("maps an available desktop update and disables downgrades", async () => {
    const update = createUpdate();
    mocks.check.mockResolvedValue(update);

    await expect(checkForAppUpdate()).resolves.toEqual({
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: "2026-07-11T00:00:00Z",
      body: "- Faster metadata cache",
    });
    expect(mocks.check).toHaveBeenCalledWith({
      timeout: 15_000,
      allowDowngrades: false,
    });
  });

  it("reports cumulative download progress before install and restart", async () => {
    const update = createUpdate();
    update.download.mockImplementation(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 35 } });
      onEvent({ event: "Progress", data: { chunkLength: 65 } });
      onEvent({ event: "Finished" });
    });
    mocks.check.mockResolvedValue(update);
    await checkForAppUpdate();

    const progress = vi.fn();
    await downloadAppUpdate(progress);
    await installAppUpdateAndRestart();

    expect(progress).toHaveBeenLastCalledWith({
      downloadedBytes: 100,
      totalBytes: 100,
    });
    expect(update.install).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("uses the package version in a browser and rejects update checks", async () => {
    mocks.isTauri.mockReturnValue(false);

    await expect(getCurrentAppVersion()).resolves.toBe(packageJson.version);
    await expect(checkForAppUpdate()).rejects.toBeInstanceOf(
      AppUpdateUnsupportedError
    );
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
