import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  getVersion: vi.fn(async () => "0.1.0"),
  check: vi.fn(),
  relaunch: vi.fn(async () => undefined),
  invoke: vi.fn(),
  closeResource: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri,
  Channel: class { onmessage = (_event: unknown) => {}; },
  Resource: class { constructor(public rid: number) {} close() { return Promise.resolve(mocks.closeResource(this.rid)); } },
}));
vi.mock("@/services/tauri/client", () => ({ invokeRawCommand: mocks.invoke }));
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
  cancelAppUpdatePreparation,
  AppUpdatePreparationCancelled,
  AppUpdateRestartRequired,
  restartAfterAppUpdate,
} from "@/services/appUpdateService";

function createUpdate() {
  return {
    rid: 11,
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
    mocks.relaunch.mockResolvedValue(undefined);
    mocks.closeResource.mockClear();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "download_app_update") {
        args.onEvent.onmessage({ event: "Started", data: { contentLength: 100 } });
        args.onEvent.onmessage({ event: "Progress", data: { chunkLength: 35 } });
        args.onEvent.onmessage({ event: "Progress", data: { chunkLength: 65 } });
        args.onEvent.onmessage({ event: "Finished" });
        return 22;
      }
      if (command === "prepare_app_update" || command === "poll_app_update_preparation") return { token: "native-preparation", ready: true };
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
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
    mocks.check.mockResolvedValue(update);
    await checkForAppUpdate();

    const progress = vi.fn();
    await downloadAppUpdate(progress);
    await installAppUpdateAndRestart();

    expect(progress).toHaveBeenLastCalledWith({
      downloadedBytes: 100,
      totalBytes: 100,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("prepare_app_update", { bytesRid: 22 });
    expect(mocks.invoke).toHaveBeenCalledWith("install_app_update", { bytesRid: 22, token: "native-preparation" });
    expect(update.install).not.toHaveBeenCalled();
    expect(update.download).not.toHaveBeenCalled();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("waits for native worker exit before submitting installation", async () => {
    vi.useFakeTimers();
    mocks.check.mockResolvedValue(createUpdate());
    await checkForAppUpdate(); await downloadAppUpdate(vi.fn());
    mocks.invoke.mockResolvedValueOnce({ token: "waiting", ready: false }).mockResolvedValueOnce({ token: "waiting", ready: true });
    const phases = vi.fn();
    const pending = installAppUpdateAndRestart(phases);
    await Promise.resolve();
    expect(phases).toHaveBeenLastCalledWith("preparing");
    expect(mocks.invoke.mock.calls.some(([command]) => command === "install_app_update")).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(mocks.invoke).toHaveBeenCalledWith("poll_app_update_preparation", { bytesRid: 22, token: "waiting" });
    expect(phases).toHaveBeenLastCalledWith("installing");
  });

  it("cancels preparation once and never starts an installer", async () => {
    vi.useFakeTimers();
    mocks.check.mockResolvedValue(createUpdate());
    await checkForAppUpdate(); await downloadAppUpdate(vi.fn());
    mocks.invoke.mockResolvedValueOnce({ token: "waiting", ready: false });
    const pending = expect(installAppUpdateAndRestart()).rejects.toBeInstanceOf(AppUpdatePreparationCancelled);
    await Promise.resolve();
    await cancelAppUpdatePreparation();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "cancel_app_update_preparation")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "install_app_update")).toBe(false);
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("leaves rollback to native code after an installer submission fails", async () => {
    mocks.check.mockResolvedValue(createUpdate());
    await checkForAppUpdate(); await downloadAppUpdate(vi.fn());
    mocks.invoke.mockResolvedValueOnce({ token: "ready", ready: true }).mockRejectedValueOnce(new Error("Native installer failed; scheduling resumed"));
    await expect(installAppUpdateAndRestart()).rejects.toThrow("scheduling resumed");
    expect(mocks.invoke.mock.calls.some(([command]) => command === "cancel_app_update_preparation")).toBe(false);
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("releases preparation when foreground work resumes before installation", async () => {
    mocks.check.mockResolvedValue(createUpdate());
    await checkForAppUpdate(); await downloadAppUpdate(vi.fn());
    await expect(installAppUpdateAndRestart((phase) => { if (phase === "installing") throw new Error("new work started"); })).rejects.toThrow("new work started");
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_app_update_preparation", { bytesRid: 22, token: "native-preparation" });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "install_app_update")).toBe(false);
  });

  it("honors cancellation even before the native preparation token arrives", async () => {
    mocks.check.mockResolvedValue(createUpdate());
    await checkForAppUpdate(); await downloadAppUpdate(vi.fn());
    let resolvePreparation: ((prepared: {token: string; ready: boolean}) => void) | undefined;
    mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { resolvePreparation = resolve; }));
    const pending = expect(installAppUpdateAndRestart()).rejects.toBeInstanceOf(AppUpdatePreparationCancelled);
    await cancelAppUpdatePreparation();
    resolvePreparation?.({ token: "late-token", ready: true });
    await pending;
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_app_update_preparation", { bytesRid: 22, token: "late-token" });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "install_app_update")).toBe(false);
  });

  it("keeps backups paused after installation when relaunch fails", async () => {
    mocks.check.mockResolvedValue(createUpdate());
    await checkForAppUpdate(); await downloadAppUpdate(vi.fn());
    mocks.relaunch.mockRejectedValueOnce(new Error("restart denied"));
    await expect(installAppUpdateAndRestart()).rejects.toBeInstanceOf(AppUpdateRestartRequired);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "cancel_app_update_preparation")).toBe(false);
    await restartAfterAppUpdate();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "install_app_update")).toHaveLength(1);
  });

  it("does not prepare an update whose native signature check failed", async () => {
    mocks.check.mockResolvedValue(createUpdate()); await checkForAppUpdate();
    mocks.invoke.mockRejectedValueOnce(new Error("Signature mismatch"));
    await expect(downloadAppUpdate(vi.fn())).rejects.toThrow("Signature mismatch");
    await expect(installAppUpdateAndRestart()).rejects.toThrow("No downloaded");
    expect(mocks.invoke.mock.calls.some(([command]) => command === "prepare_app_update")).toBe(false);
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
