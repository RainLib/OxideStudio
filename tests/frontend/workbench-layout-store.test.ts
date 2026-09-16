/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/appSettings";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";

const mocks = vi.hoisted(() => ({
  saveAppSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/tauri/settings.service", () => ({
  settingsService: {
    saveAppSettings: mocks.saveAppSettings,
    getAppSettings: vi.fn(),
    resetAppSettings: vi.fn(),
  },
}));

function defaultSettings(): AppSettings {
  return structuredClone(DEFAULT_APP_SETTINGS);
}

describe("workbench layout store", () => {
  beforeEach(() => {
    mocks.saveAppSettings.mockClear();
    useSettingsStore.setState({
      settings: defaultSettings(),
      isLoading: false,
      error: null,
    });
    useWorkbenchLayoutStore.setState({
      lastToolWindow: "databaseExplorer",
      hiddenToolWindowLayout: null,
    });
  });

  it("opens a side tool while preserving the shared settings persistence path", () => {
    useWorkbenchLayoutStore
      .getState()
      .setActiveToolWindow("databaseExplorer");

    const layout = useSettingsStore.getState().settings.workbench.layout;
    expect(layout.activeToolWindow).toBe("databaseExplorer");
    expect(layout.visibility.databaseExplorer).toBe(true);
    expect(useWorkbenchLayoutStore.getState().lastToolWindow).toBe(
      "databaseExplorer",
    );
    expect(mocks.saveAppSettings).toHaveBeenCalledTimes(1);
  });

  it("restores a complete tool-window layout after hiding every tool", () => {
    const store = useWorkbenchLayoutStore.getState();
    store.setActiveToolWindow("results");
    const visibleLayout = useSettingsStore.getState().settings.workbench.layout;

    store.toggleAllToolWindows();
    const hiddenLayout = useSettingsStore.getState().settings.workbench.layout;
    expect(Object.values(hiddenLayout.visibility).every((visible) => !visible)).toBe(
      true,
    );
    expect(hiddenLayout.activeToolWindow).toBe("editor");

    useWorkbenchLayoutStore.getState().toggleAllToolWindows();
    expect(useSettingsStore.getState().settings.workbench.layout).toEqual(
      visibleLayout,
    );
  });

  it("clamps persisted panel dimensions at the established layout limits", () => {
    const store = useWorkbenchLayoutStore.getState();
    store.setLeftWidth(12);
    store.setRightWidth(9_999);
    store.setBottomHeight(-1);

    const layout = useSettingsStore.getState().settings.workbench.layout;
    expect(layout.leftWidth).toBe(240);
    expect(layout.rightWidth).toBe(640);
    expect(layout.bottomHeight).toBe(140);
  });
});
