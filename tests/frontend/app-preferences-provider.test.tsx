/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPreferencesProvider, useI18n } from "@/i18n";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from "@/lib/appSettings";
import { useSettingsStore } from "@/store/useSettingsStore";

vi.mock("@/services/tauri/settings.service", () => ({
  settingsService: {
    getAppSettings: vi.fn(async () => ({
      appearance: {
        locale: "zh-CN",
        uiFontSize: 16,
      },
    })),
    saveAppSettings: vi.fn(async () => undefined),
    resetAppSettings: vi.fn(async () => undefined),
  },
}));

function LocalizedProbe({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <div>{children ?? t("common.settings")}</div>;
}

describe("AppPreferencesProvider", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    document.documentElement.removeAttribute("lang");
    useSettingsStore.setState({
      settings: DEFAULT_APP_SETTINGS,
      isLoading: false,
      error: null,
    });
  });

  it("applies persisted locale and typography without workspace hydration", async () => {
    useSettingsStore.setState({
      settings: normalizeAppSettings({
        appearance: { locale: "zh-CN", uiFontSize: 16 },
      }),
    });
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <AppPreferencesProvider>
          <LocalizedProbe />
        </AppPreferencesProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("设置");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(
      document.documentElement.style.getPropertyValue("--wb-ui-font-size"),
    ).toBe("16px");
    expect(
      document.documentElement.style.getPropertyValue("--wb-ui-font-size-xs"),
    ).toBe("14px");
  });
});
