/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { ThemeContext, type ThemeContextType } from "@/theme/ThemeProvider";

const mocks = vi.hoisted(() => ({
  testProvider: vi.fn(),
}));

vi.mock("@/services/tauri/ai.service", () => ({
  aiService: {
    testProvider: mocks.testProvider,
  },
}));

const initialAiSettings = useAiSettingsStore.getState();
const themeContext: ThemeContextType = {
  mode: "dark",
  theme: {} as ThemeContextType["theme"],
  toggleTheme: vi.fn(),
  setTheme: vi.fn(),
};

function buttonWithText(container: ParentNode, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text)
  );
}

async function flushAsyncWork() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe("AI settings", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.testProvider.mockResolvedValue({
      message: "AI provider connection is available",
      model: "gpt-test",
    });
    useAiSettingsStore.setState(
      {
        ...initialAiSettings,
        enabled: true,
        plannerKind: "langgraph",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-test",
        apiKey: "test-key",
      },
      true
    );
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    document.body.innerHTML = "";
    useAiSettingsStore.setState(initialAiSettings, true);
  });

  it("tests the provider in place without rendering a navigation link", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeContext.Provider value={themeContext}>
          <SettingsDialog open onOpenChange={vi.fn()} />
        </ThemeContext.Provider>
      );
      await flushAsyncWork();
    });

    await act(async () => {
      buttonWithText(document, "AI Assistant")?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        })
      );
      await flushAsyncWork();
    });

    const testButton = buttonWithText(document, "Test Provider");
    expect(testButton).toBeTruthy();
    expect(document.body.textContent).toContain("LangGraph planner plugin");
    expect(document.body.textContent).toContain("@langchain/langgraph");
    expect(testButton?.getAttribute("type")).toBe("button");
    expect(
      Array.from(document.querySelectorAll("a")).some((anchor) =>
        anchor.textContent?.includes("Test Provider")
      )
    ).toBe(false);

    await act(async () => {
      testButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(mocks.testProvider).toHaveBeenCalledWith({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
      apiKey: "test-key",
      timeoutMs: 30_000,
    });
    expect(document.body.textContent).toContain(
      "AI provider connection is available: gpt-test"
    );
  });
});
