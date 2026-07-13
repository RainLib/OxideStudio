// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowControls } from "@/components/WindowControls";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  minimize: vi.fn(async () => undefined),
  toggleMaximize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: mocks.minimize,
    toggleMaximize: mocks.toggleMaximize,
    close: mocks.close,
  }),
}));

describe("WindowControls", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
  });

  it("routes close to the native command for the current window", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<WindowControls />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
      await Promise.resolve();
    });

    expect(mocks.invoke).toHaveBeenCalledWith("close_current_window");
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("falls back to the Tauri window API when the native command fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("command unavailable"));
    await act(async () => {
      root = createRoot(container);
      root.render(<WindowControls />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
