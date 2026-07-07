/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { ThemeContext, type ThemeContextType } from "@/theme/ThemeProvider";

vi.mock("@/services/tauri/ai.service", () => ({
  aiService: {
    testProvider: vi.fn(),
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

describe("LeftPanel settings entry", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    document.body.innerHTML = "";
  });

  it("opens workspace settings with the AI configuration tab available", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeContext.Provider value={themeContext}>
          <LeftPanel
            activeTab={null}
            onTabClick={vi.fn()}
            isDrawerOpen={false}
            sidebarWidth={280}
            onDragStart={vi.fn()}
          />
        </ThemeContext.Provider>
      );
      await flushAsyncWork();
    });

    const settingsButton = container.querySelector(
      'button[aria-label="Settings"]'
    );
    expect(settingsButton).toBeTruthy();

    await act(async () => {
      settingsButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(document.body.textContent).toContain("Settings");
    expect(document.body.textContent).toContain("AI");

    const aiTab = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("AI")
    );
    expect(aiTab).toBeTruthy();

    await act(async () => {
      aiTab?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        })
      );
      await flushAsyncWork();
    });

    expect(document.body.textContent).toContain("AI Assistant");
  });
});
