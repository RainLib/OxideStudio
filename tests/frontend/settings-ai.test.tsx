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
  hasProviderSecret: vi.fn(),
  setProviderSecret: vi.fn(),
}));

vi.mock("@/services/tauri/ai.service", () => ({
  aiService: {
    testProvider: mocks.testProvider,
    hasProviderSecret: mocks.hasProviderSecret,
    setProviderSecret: mocks.setProviderSecret,
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
    mocks.hasProviderSecret.mockResolvedValue(false);
    mocks.setProviderSecret.mockResolvedValue(true);
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
    expect(document.body.textContent).toContain("Choose O2, Plan, Agent, or Chat");
    expect(document.body.textContent).toContain(
      "Planning and tool orchestration are selected automatically"
    );
    expect(document.body.textContent).toContain("Inline Completion");
    expect(document.body.textContent).toContain("Enable inline completion");
    expect(document.body.textContent).toContain("Include project context");
    expect(document.body.textContent).toContain("Chat completions");
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
      apiKey: undefined,
      timeoutMs: 30_000,
    });
    expect(mocks.setProviderSecret).toHaveBeenCalledWith(
      "https://api.openai.com/v1",
      "test-key",
    );
    expect(document.body.textContent).toContain(
      "AI provider connection is available: gpt-test"
    );
  });

  it("does not test with a draft key when the local credential file save fails", async () => {
    mocks.setProviderSecret.mockRejectedValueOnce(new Error("save failed"));
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeContext.Provider value={themeContext}>
          <SettingsDialog open initialSection="ai" onOpenChange={vi.fn()} />
        </ThemeContext.Provider>,
      );
      await flushAsyncWork();
    });

    await act(async () => {
      buttonWithText(document, "Test Provider")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    expect(mocks.testProvider).not.toHaveBeenCalled();
    expect(useAiSettingsStore.getState().apiKey).toBe("test-key");
    expect(document.body.textContent).toContain("save failed");
  });
});
