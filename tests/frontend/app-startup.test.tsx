/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { StartupWorkbenchShell } from "@/App";
import {
  subscribeStartupIntents,
  type StartupIntent,
} from "@/startup/startupIntents";

const mocks = vi.hoisted(() => ({
  loadConnections: vi.fn(async () => undefined),
  loadSettings: vi.fn(() => new Promise<void>(() => undefined)),
  loadDriverCatalog: vi.fn(() => new Promise<void>(() => undefined)),
  loadError: null as string | null,
}));

vi.mock("@/store/useConnectionStore", () => ({
  useConnectionStore: () => ({
    loadConnections: mocks.loadConnections,
    isLoading: true,
    loadError: mocks.loadError,
    connectionDisplayCache: [],
    hasConnectionDisplayCache: false,
  }),
}));

vi.mock("@/store/useSettingsStore", () => ({
  useSettingsStore: () => ({ loadSettings: mocks.loadSettings }),
}));

vi.mock("@/store/useDatabaseDriverCatalogStore", () => ({
  useDatabaseDriverCatalogStore: (
    selector: (state: { load: typeof mocks.loadDriverCatalog }) => unknown,
  ) => selector({ load: mocks.loadDriverCatalog }),
}));

vi.mock("@/hooks/useShortcuts", () => ({ useShortcuts: vi.fn() }));
vi.mock("@/components/lsp", () => ({ LspConnectionSyncer: () => null }));
vi.mock("@/pages/workspace", () => ({
  WorkspacePage: () => <div>Workspace ready</div>,
}));

describe("application startup", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadError = null;
    window.__oxideStartupIntents = [];
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("mounts the workspace without starting backend hydration from App", async () => {
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
    });

    expect(mocks.loadSettings).not.toHaveBeenCalled();
    expect(mocks.loadConnections).not.toHaveBeenCalled();
    expect(mocks.loadDriverCatalog).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Workspace ready");
    expect(container.textContent).not.toContain("Loading...");
  });

  it("keeps the workspace available when loading data sources fails", async () => {
    mocks.loadError = "backend unavailable";
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Workspace ready");
    expect(container.textContent).not.toContain("backend unavailable");
  });

  it("queues startup actions while the full workspace is still loading", async () => {
    const received: StartupIntent[] = [];
    const unsubscribe = subscribeStartupIntents((intent) =>
      received.push(intent),
    );
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <StartupWorkbenchShell cachedDataSources={[]} hasDataSourceCache />,
      );
    });

    const newQuery = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("New Query"),
    );
    await act(async () => newQuery?.click());

    expect(received).toEqual(["new-query"]);
    expect(newQuery?.textContent).toContain("Opening…");
    unsubscribe();
  });

  it("keeps an inline startup action pending across the React shell handoff", async () => {
    window.__oxideStartupIntents = ["project-files"];
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <StartupWorkbenchShell cachedDataSources={[]} hasDataSourceCache />,
      );
    });

    const projectFiles = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Project Files"),
    );
    expect(projectFiles?.textContent).toContain("Opening…");
    expect(
      container
        .querySelector(".wb-workspace-track")
        ?.hasAttribute("aria-hidden"),
    ).toBe(false);
  });

  it("does not turn a slow workspace transform into a false Reload error", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toContain("Still preparing the workspace…");
    expect(html).toContain("oxide:react-shell-ready");
    expect(html).not.toContain(
      "OxideStudio did not finish starting. Reload the window to try again.",
    );
  });

  it("starts the React entry and workspace request without a serial frame waterfall", () => {
    const main = readFileSync(
      resolve(process.cwd(), "src/main.tsx"),
      "utf8",
    );
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(main).toContain('import App from "./App"');
    expect(main).toContain('import { mountApp } from "./bootstrap"');
    expect(main).not.toContain('import("./bootstrap")');
    expect(app).toContain('void import("@/pages/workspace")');
    expect(app).not.toContain("setWorkspaceEnabled");
    expect(app).not.toContain("requestAnimationFrame");
  });
});
