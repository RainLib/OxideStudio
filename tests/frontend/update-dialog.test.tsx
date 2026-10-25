/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateDialog } from "@/components/update/UpdateDialog";
import { useUpdateStore } from "@/store/useUpdateStore";

vi.mock("@/services/appUpdateService", () => ({
  AppUpdateUnsupportedError: class AppUpdateUnsupportedError extends Error {},
  getCurrentAppVersion: vi.fn(),
  checkForAppUpdate: vi.fn(),
  downloadAppUpdate: vi.fn(),
  installAppUpdateAndRestart: vi.fn(),
  getAppUpdateInstallationStatus: vi.fn(async () => ({ installationId: null, phase: "idle", recoveryRequired: false, message: null })),
}));

describe("UpdateDialog", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    useUpdateStore.setState({
      currentVersion: "0.1.0",
      update: {
        currentVersion: "0.1.0",
        version: "0.2.0",
        date: "2026-07-11T00:00:00Z",
        body: "# Highlights\n- Faster metadata cache\n- Safer updates",
      },
      status: "available",
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      lastCheckedAt: null,
      nativeInstallation: null,
      preparationCancelable: false,
    });
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    document.body.innerHTML = "";
  });

  it("shows release details and keeps installation as a separate action", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<UpdateDialog open onOpenChange={vi.fn()} />);
    });

    expect(document.body.textContent).toContain("Version 0.2.0 is available");
    expect(document.body.textContent).toContain("Faster metadata cache");
    expect(document.body.textContent).toContain("Download in Background");
    expect(document.body.textContent).not.toContain("Install and Restart");
  });

  it("offers restart only after the package has downloaded", async () => {
    useUpdateStore.setState({
      status: "downloaded",
      downloadedBytes: 1_048_576,
      totalBytes: 1_048_576,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<UpdateDialog open onOpenChange={vi.fn()} />);
    });

    expect(document.body.textContent).toContain("Ready to install");
    expect(document.body.textContent).toContain("Install and Restart");
    expect(document.body.textContent).toContain("100%");
  });

  it("lets the owner cancel preparation while keeping the queued backups", async () => {
    const cancel = vi.fn(async () => {});
    useUpdateStore.setState({ status: "preparing", preparationCancelable: true, cancelInstallationPreparation: cancel });
    await act(async () => { root = createRoot(container); root.render(<UpdateDialog open onOpenChange={vi.fn()} />); });
    expect(document.body.textContent).toContain("Your current backup can finish");
    const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent === "Cancel update preparation");
    await act(async () => { button?.click(); });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("requires the installer-closed acknowledgement before backup recovery", async () => {
    const recover = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    useUpdateStore.setState({ status: "idle", update: null, nativeInstallation: { installationId: "failed", phase: "installing", recoveryRequired: true, message: "close installer" }, recoverBackupsAfterUpdate: recover, refreshInstallationStatus: refresh });
    await act(async () => { root = createRoot(container); root.render(<UpdateDialog open onOpenChange={vi.fn()} />); });
    const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent === "Resume backups");
    expect(button?.disabled).toBe(true);
    await act(async () => { (document.querySelector("input[type=checkbox]") as HTMLInputElement).click(); });
    expect(button?.disabled).toBe(false);
    await act(async () => { button?.click(); });
    expect(recover).toHaveBeenCalledOnce();
  });
});

