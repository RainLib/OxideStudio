/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppBar } from "@/components/AppBar";
import { ThemeContext, type ThemeContextType } from "@/theme/ThemeProvider";

vi.mock("@/services/tauri/ai.service", () => ({
  aiService: {
    testProvider: vi.fn(),
    hasProviderSecret: vi.fn(async () => false),
    setProviderSecret: vi.fn(async () => true),
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

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    document.body.innerHTML = "";
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

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Settings");
    });
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
