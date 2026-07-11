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
    expect(document.body.textContent).toContain("Download Update");
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
});

