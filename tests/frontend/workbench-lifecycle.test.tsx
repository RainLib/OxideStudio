// @vitest-environment happy-dom
import { useWorkbenchWindowNavigation } from "@/features/workbench/hooks/useWorkbenchWindowNavigation";
import { WorkspaceStartupHydration } from "@/features/workbench/ui/WorkspaceStartupHydration";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
  settings: vi.fn(),
  projects: vi.fn(),
  connections: vi.fn(),
  drivers: vi.fn(),
  closeTab: vi.fn(),
}));
vi.mock("@/startup/startupProgress", () => ({
  startWorkspaceHydration: mocks.hydrate,
}));
vi.mock("@/store/useSettingsStore", () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({ loadSettings: mocks.settings }),
}));
vi.mock("@/store/useProjectStore", () => ({
  useProjectStore: (select: (state: unknown) => unknown) =>
    select({ loadProjects: mocks.projects }),
}));
vi.mock("@/store/useConnectionStore", () => ({
  useConnectionStore: (select: (state: unknown) => unknown) =>
    select({ loadConnections: mocks.connections }),
}));
vi.mock("@/store/useDatabaseDriverCatalogStore", () => ({
  useDatabaseDriverCatalogStore: (select: (state: unknown) => unknown) =>
    select({ load: mocks.drivers }),
}));
vi.mock("@/store/useTabStore", () => ({
  useTabStore: {
    getState: () => ({ activeTabId: "query", closeTab: mocks.closeTab }),
  },
}));

let root: Root;
let container: HTMLDivElement;
let frame: FrameRequestCallback;
let cancelFrame = vi.fn<(handle: number) => void>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.hydrate.mockResolvedValue(undefined);
  cancelFrame = vi.fn();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 12;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(cancelFrame);
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.stubGlobal("cancelIdleCallback", undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("cancels scheduled startup before the first paint when the runtime unmounts", async () => {
  await act(async () => root.render(<WorkspaceStartupHydration />));
  expect(mocks.hydrate).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(cancelFrame).toHaveBeenCalledWith(12);
  expect(mocks.drivers).not.toHaveBeenCalled();
});

it("does not schedule driver discovery after a pending hydration finishes on an unmounted runtime", async () => {
  let finish!: () => void;
  mocks.hydrate.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  await act(async () => root.render(<WorkspaceStartupHydration />));
  await act(async () => frame(0));
  await act(async () => root.render(null));
  await act(async () => finish());
  expect(idle).not.toHaveBeenCalled();
  expect(mocks.drivers).not.toHaveBeenCalled();
});

it("cancels idle driver discovery when the runtime unmounts", async () => {
  const idle = vi.fn(() => 37),
    cancelIdle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  vi.stubGlobal("cancelIdleCallback", cancelIdle);
  await act(async () => root.render(<WorkspaceStartupHydration />));
  await act(async () => frame(0));
  expect(mocks.hydrate).toHaveBeenCalledWith({
    loadSettings: mocks.settings,
    loadProjects: mocks.projects,
    loadConnections: mocks.connections,
  });
  expect(idle).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(cancelIdle).toHaveBeenCalledWith(37);
  expect(mocks.drivers).not.toHaveBeenCalled();
});

it("cancels the driver discovery timer fallback and removes focus listeners", async () => {
  await act(async () => root.render(<WorkspaceStartupHydration />));
  await act(async () => frame(0));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(mocks.settings).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.drivers).not.toHaveBeenCalled();
  expect(mocks.settings).toHaveBeenCalledTimes(1);
});

type NavigationOptions = Parameters<typeof useWorkbenchWindowNavigation>[0];
function navigationOptions(): NavigationOptions {
  return {
    setActiveToolWindow: vi.fn(),
    leftToolWindow: "databaseExplorer",
    rightToolWindow: null,
    showQueryResultPanel: true,
    appSettings: { editor: { keybindingMode: "vim" } },
    layout: { activeToolWindow: "results" },
    setToolWindowVisible: vi.fn(),
  };
}
function NavigationHarness(props: NavigationOptions) {
  useWorkbenchWindowNavigation(props);
  return null;
}
function key(key: string, ctrlKey = false) {
  container.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}
it("expires the Vim window prefix before an unrelated later key", async () => {
  const props = navigationOptions();
  await act(async () => root.render(<NavigationHarness {...props} />));
  key("w", true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  key("q");
  expect(props.setToolWindowVisible).not.toHaveBeenCalled();
  key("w", true);
  key("q");
  expect(props.setToolWindowVisible).toHaveBeenCalledExactlyOnceWith(
    "results",
    false,
  );
});
it("clears the pending Vim prefix and listeners when the runtime unmounts", async () => {
  const props = navigationOptions();
  await act(async () => root.render(<NavigationHarness {...props} />));
  key("w", true);
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  key("q");
  expect(props.setToolWindowVisible).not.toHaveBeenCalled();
});
