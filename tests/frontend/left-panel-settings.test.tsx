/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBar } from "@/components/AppBar";
import { ThemeContext, type ThemeContextType } from "@/theme/ThemeProvider";

vi.mock("@/services/tauri/ai.service", () => ({
  aiService: {
    testProvider: vi.fn(),
    hasProviderSecret: vi.fn(async () => false),
    setProviderSecret: vi.fn(async () => true),
    getProviderHeaders: vi.fn(async () => ({})),
    setProviderHeaders: vi.fn(async () => []),
  },
}));

vi.mock("@/services/tauri/store.service", () => ({
  storeService: {
    getProjects: vi.fn(async () => []),
    saveProject: vi.fn(async () => undefined),
  },
}));

const themeContext: ThemeContextType = {
  mode: "dark",
  theme: {} as ThemeContextType["theme"],
  toggleTheme: vi.fn(),
  setTheme: vi.fn(),
};

async function flushAsyncWork() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe("Workbench settings entry", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    // Keep the title-bar test independent from the first-run account popover.
    // Under full-suite load its delayed auto-open can otherwise race the
    // settings popover, even though the settings behavior itself is correct.
    localStorage.setItem("oxide-enterprise-account-choice-seen", "1");
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    document.body.innerHTML = "";
    localStorage.removeItem("oxide-enterprise-account-choice-seen");
  });

  it("opens workspace settings from the title bar", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeContext.Provider value={themeContext}>
          <AppBar title="sqls" />
        </ThemeContext.Provider>,
      );
      await flushAsyncWork();
    });

    const settingsButton = container.querySelector(
      'button[aria-label="Settings"]',
    );
    expect(settingsButton).toBeTruthy();

    await act(async () => {
      settingsButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    const settingsMenuItem = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Settings..."));
    expect(settingsMenuItem).toBeTruthy();

    await act(async () => {
      settingsMenuItem?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain("Settings");
      },
      // SettingsDialog is intentionally lazy-loaded. Under a full parallel
      // Vitest run, module evaluation may exceed the default one-second poll
      // budget even though the click has already opened the dialog.
      { timeout: 5_000 },
    );
    expect(document.body.textContent).toContain("AI Assistant");

    const aiTab = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("AI Assistant"),
    );
    expect(aiTab).toBeTruthy();

    await act(async () => {
      aiTab?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      await flushAsyncWork();
    });

    expect(document.body.textContent).toContain("AI Assistant");
  });
});
