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
  getProviderHeaders: vi.fn(),
  setProviderHeaders: vi.fn(),
}));

vi.mock("@/services/tauri/ai.service", () => ({
  aiService: {
    testProvider: mocks.testProvider,
    hasProviderSecret: mocks.hasProviderSecret,
    setProviderSecret: mocks.setProviderSecret,
    getProviderHeaders: mocks.getProviderHeaders,
    setProviderHeaders: mocks.setProviderHeaders,
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
    mocks.getProviderHeaders.mockResolvedValue({});
    mocks.setProviderHeaders.mockResolvedValue(["Authorization"]);
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
      kind: "openai-compatible",
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

  it("loads assistant and inline credentials from their own scopes", async () => {
    useAiSettingsStore.setState({
      apiKey: "", inlineApiKey: "", baseUrl: "https://assistant.example/v1",
      inlineBaseUrl: "https://inline.example/v1",
    });
    mocks.hasProviderSecret.mockImplementation(async (_url: string, scope: string) => scope === "inline");
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeContext.Provider value={themeContext}>
          <SettingsDialog open initialSection="ai" onOpenChange={vi.fn()} />
        </ThemeContext.Provider>,
      );
      await flushAsyncWork();
    });
    expect(mocks.hasProviderSecret).toHaveBeenCalledWith("https://assistant.example/v1", "assistant");
    expect(mocks.hasProviderSecret).toHaveBeenCalledWith("https://inline.example/v1", "inline");
    const passwords = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    expect(passwords.map((input) => input.placeholder)).toEqual(["sk-...", "Stored in local credential file"]);
    expect(document.body.textContent).toContain("independently of the CLI");
  });

  it("pins the editor live preview above the scrolling settings body", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeContext.Provider value={themeContext}>
          <SettingsDialog open initialSection="editor" onOpenChange={vi.fn()} />
        </ThemeContext.Provider>,
      );
      await flushAsyncWork();
    });

    const preview = document.querySelector("[data-editor-settings-preview]");
    const scrollBody = document.querySelector("[data-settings-scroll-body]");
    expect(preview).toBeTruthy();
    expect(scrollBody).toBeTruthy();
    expect(preview?.parentElement?.nextElementSibling).toBe(scrollBody);
  });

  it("keeps assistant gateway headers in the Rust credential service", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeContext.Provider value={themeContext}>
          <SettingsDialog open initialSection="ai" onOpenChange={vi.fn()} />
        </ThemeContext.Provider>,
      );
      await flushAsyncWork();
    });

    const addHeader = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Add header"),
    );
    expect(addHeader).toBeTruthy();
    await act(async () => {
      addHeader?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="Request header name"]',
    );
    const value = document.querySelector<HTMLInputElement>(
      'input[aria-label="Request header value"]',
    );
    expect(name).toBeTruthy();
    expect(value).toBeTruthy();
    await act(async () => {
      const setInputValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (name) {
        setInputValue?.call(name, "Authorization");
        name.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (value) {
        setInputValue?.call(value, "Bearer gateway-token");
        value.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await flushAsyncWork();
    });

    await act(async () => {
      buttonWithText(document, "Save headers")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsyncWork();
    });

    expect(mocks.setProviderHeaders).toHaveBeenCalledWith(
      "https://api.openai.com/v1",
      "assistant",
      { Authorization: "Bearer gateway-token" },
    );
  });
});
