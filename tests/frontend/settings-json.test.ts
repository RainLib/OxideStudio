import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { findWorkbenchAction } from "@/lib/actions";
import { useSettingsStore } from "@/store/useSettingsStore";

const mocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  getAppSettingsPath: vi.fn(),
  saveAppSettings: vi.fn(),
  resetAppSettings: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("@/services/tauri/settings.service", () => ({
  settingsService: {
    getAppSettings: mocks.getAppSettings,
    getAppSettingsPath: mocks.getAppSettingsPath,
    saveAppSettings: mocks.saveAppSettings,
    resetAppSettings: mocks.resetAppSettings,
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: mocks.openPath,
}));

describe("settings.json workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: DEFAULT_APP_SETTINGS,
      isLoading: false,
      error: null,
    });
  });

  it("writes normalized settings before opening the JSON file", async () => {
    mocks.saveAppSettings.mockResolvedValue(undefined);
    mocks.getAppSettingsPath.mockResolvedValue("/tmp/oxide/settings.json");
    mocks.openPath.mockResolvedValue(undefined);

    await findWorkbenchAction("settings.openJson")?.run();

    expect(mocks.saveAppSettings).toHaveBeenCalledWith(DEFAULT_APP_SETTINGS);
    expect(mocks.openPath).toHaveBeenCalledWith("/tmp/oxide/settings.json");
  });

  it("keeps the active configuration when external JSON is invalid", async () => {
    const currentSettings = {
      ...DEFAULT_APP_SETTINGS,
      editor: {
        ...DEFAULT_APP_SETTINGS.editor,
        fontSize: 16,
      },
    };
    useSettingsStore.setState({ settings: currentSettings });
    mocks.getAppSettings.mockRejectedValue(
      new Error("Invalid settings.json: expected value")
    );

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().settings.editor.fontSize).toBe(16);
    expect(useSettingsStore.getState().error).toContain("Invalid settings.json");
  });
});
