/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

const mocks = vi.hoisted(() => ({
  loadConnections: vi.fn(async () => undefined),
  loadSettings: vi.fn(() => new Promise<void>(() => undefined)),
}));

vi.mock("@/store/useConnectionStore", () => ({
  useConnectionStore: () => ({
    loadConnections: mocks.loadConnections,
    isLoading: true,
    loadError: null,
  }),
}));

vi.mock("@/store/useSettingsStore", () => ({
  useSettingsStore: () => ({ loadSettings: mocks.loadSettings }),
}));

vi.mock("@/hooks/useShortcuts", () => ({ useShortcuts: vi.fn() }));
vi.mock("@/components/lsp", () => ({ LspConnectionSyncer: () => null }));
vi.mock("@/pages/workspace", () => ({ WorkspacePage: () => null }));

describe("application startup", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("starts loading connections without waiting for settings", async () => {
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
    });

    expect(mocks.loadSettings).toHaveBeenCalledOnce();
    expect(mocks.loadConnections).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Loading...");
  });
});
