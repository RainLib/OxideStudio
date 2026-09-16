import { describe, expect, it, vi } from "vitest";
import {
  act,
  AssistantSidebar,
  createRoot,
  deferred,
  emit,
  fixture,
  flushAsyncWork,
  clickButton,
  clickButtonByAria,
  findButtonByAria,
  mocksForTests as mocks,
  setInputValue,
  setRangeValue,
  setTextareaValue,
  submitPrompt,
  useAiSettingsStore,
  useAssistantCliSetupStore,
  useAssistantComposerStore,
  useConnectionStore,
  useProjectStore,
  useSchemaStore,
  useTabStore,
  ApiError,
} from "./harness";

describe("AssistantSidebar Agent Host path: composer", () => {
  it("onboards the first Assistant provider before showing the composer", async () => {
    useAiSettingsStore.setState({ enabled: false });
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(fixture.container.textContent).toContain(
      "Choose how Assistant runs",
    );
    expect(fixture.container.textContent).toContain("Codex CLI");
    expect(fixture.container.textContent).toContain("CodeBuddy CLI");
    expect(fixture.container.querySelector("textarea")).toBeNull();

    await clickButtonByAria(fixture.container, "Use Oxide Assistant");
    expect(useAiSettingsStore.getState()).toEqual(
      expect.objectContaining({
        enabled: true,
        provider: "openai-compatible",
      }),
    );
    expect(fixture.container.querySelector("textarea")).not.toBeNull();
  });

  it("switches Assistant providers from the persistent runtime control", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    const assistantHeader = fixture.container.querySelector("header");
    expect(
      assistantHeader?.querySelector("[data-assistant-provider]"),
    ).not.toBeNull();
    expect(
      fixture.container.querySelector(":scope > [data-assistant-provider]"),
    ).toBeNull();

    await clickButtonByAria(
      fixture.container,
      "Assistant provider: Oxide Assistant",
    );
    const providerMenu = document.body.querySelector<HTMLElement>(
      '[data-assistant-provider-menu="true"]',
    );
    expect(providerMenu).not.toBeNull();
    expect(providerMenu?.className).toContain("w-[220px]");
    expect(
      providerMenu?.querySelectorAll("[data-assistant-provider-option]"),
    ).toHaveLength(3);
    for (const providerOption of providerMenu?.querySelectorAll<HTMLElement>(
      "[data-assistant-provider-option]",
    ) ?? []) {
      expect(providerOption.className).toContain("h-9");
      expect(providerOption.childElementCount).toBe(2);
    }
    expect(providerMenu?.textContent).toContain("Oxide Assistant");
    expect(providerMenu?.textContent).toContain("OpenAI Codex");
    expect(providerMenu?.textContent).toContain("CodeBuddy Code");
    expect(providerMenu?.textContent).not.toContain("Run Assistant with");
    expect(providerMenu?.textContent).not.toContain(
      "SQL inline completion keeps its separate HTTP provider",
    );
    expect(providerMenu?.textContent).not.toContain(
      "A native Codex agent session",
    );
    expect(providerMenu?.textContent).not.toContain("API");
    expect(providerMenu?.textContent).not.toContain("CLI");
    expect(providerMenu?.textContent).not.toContain("Ready");
    expect(providerMenu?.textContent).not.toContain("Provider settings");
    expect(
      providerMenu?.querySelector(
        '[data-assistant-provider-brand="openai-compatible"] img[src="/oxide-logo.png"]',
      ),
    ).not.toBeNull();
    expect(
      providerMenu?.querySelector(
        '[data-assistant-provider-brand="codex-cli"] svg',
      ),
    ).not.toBeNull();
    expect(
      providerMenu?.querySelector(
        '[data-assistant-provider-brand="codebuddy-cli"] img[src="/provider-icons/codebuddy.svg"]',
      ),
    ).not.toBeNull();
    expect(
      fixture.container.querySelector(
        '[data-assistant-provider] [data-assistant-provider-brand="openai-compatible"] img[src="/oxide-logo.png"]',
      ),
    ).not.toBeNull();

    await clickButtonByAria(providerMenu!, "Use OpenAI Codex");
    expect(useAiSettingsStore.getState()).toEqual(
      expect.objectContaining({
        enabled: true,
        provider: "codex-cli",
      }),
    );
    const codexProviderTrigger =
      fixture.container.querySelector<HTMLButtonElement>(
        'button[aria-label^="Assistant provider: OpenAI Codex"]',
      );
    expect(codexProviderTrigger?.textContent).toContain("OpenAI Codex");
    expect(
      codexProviderTrigger?.querySelector(
        '[data-assistant-provider-brand="codex-cli"] svg',
      ),
    ).not.toBeNull();
    expect(mocks.loadConversationSnapshot).toHaveBeenCalledWith(
      "project-1",
      expect.stringMatching(/^provider:cli:[0-9a-f]{32}$/u),
    );
  });

  it("surfaces provider-native CLI commands beside the composer", async () => {
    mocks.listCliCommands.mockResolvedValue([
      {
        name: "review",
        description: "Start the provider review workflow",
        argumentHint: "optional review focus",
      },
      {
        name: "status",
        description: "Show the active provider status",
      },
    ]);

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(
      fixture.container,
      "Assistant provider: Oxide Assistant",
    );
    await clickButtonByAria(document.body, "Use OpenAI Codex");
    await act(async () => {
      await flushAsyncWork();
    });

    const commandTrigger = fixture.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Provider commands (2)"]',
    );
    expect(commandTrigger).not.toBeNull();
    await act(async () => {
      commandTrigger!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      await flushAsyncWork();
    });
    expect(document.body.textContent).toContain("/review");
    expect(document.body.textContent).toContain(
      "Start the provider review workflow",
    );
    expect(document.body.textContent).toContain("optional review focus");
    expect(document.body.textContent).toContain("/status");
  });

  it("opens slash commands above the composer and keeps keyboard focus in the prompt", async () => {
    mocks.listCliCommands.mockResolvedValue([
      {
        name: "review",
        description: "Start the provider review workflow",
        argumentHint: "optional review focus",
      },
      {
        name: "status",
        description: "Show the active provider status",
      },
    ]);

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await clickButtonByAria(
      fixture.container,
      "Assistant provider: Oxide Assistant",
    );
    await clickButtonByAria(document.body, "Use OpenAI Codex");
    await act(async () => {
      await flushAsyncWork();
    });

    const textarea =
      fixture.container.querySelector<HTMLTextAreaElement>("textarea")!;
    await setTextareaValue(textarea, "/");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(textarea.getAttribute("aria-controls")).toBe(
      "assistant-provider-commands",
    );
    expect(
      fixture.container
        .querySelector('[data-assistant-composer="true"]')
        ?.querySelector('[role="listbox"]'),
    ).toBeNull();
    expect(
      document.body.querySelector(
        '#assistant-provider-commands[role="listbox"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await flushAsyncWork();
    });
    expect(textarea.getAttribute("aria-activedescendant")).toBe(
      "assistant-provider-command-1",
    );

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flushAsyncWork();
    });
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.body.querySelector("#assistant-provider-commands"),
    ).toBeNull();

    await setTextareaValue(textarea, "/r");
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await flushAsyncWork();
    });
    expect(textarea.value).toBe("/review ");
    expect(
      document.body.querySelector("#assistant-provider-commands"),
    ).toBeNull();

    await setTextareaValue(textarea, "");
    await setTextareaValue(textarea, "/");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.body.querySelector(
        '#assistant-provider-commands[role="listbox"]',
      ),
    ).not.toBeNull();
  });

  it("filters and replaces only the slash token immediately before the caret", async () => {
    mocks.listCliCommands.mockResolvedValue([
      {
        name: "review",
        description: "Start the provider review workflow",
        argumentHint: "optional review focus",
      },
      { name: "status", description: "Show the active provider status" },
    ]);

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await clickButtonByAria(
      fixture.container,
      "Assistant provider: Oxide Assistant",
    );
    await clickButtonByAria(document.body, "Use OpenAI Codex");
    await act(async () => {
      await flushAsyncWork();
    });

    const textarea =
      fixture.container.querySelector<HTMLTextAreaElement>("textarea")!;
    const original = "Compare /rev with the existing /status output";
    const caret = original.indexOf("/rev") + "/rev".length;
    await setTextareaValue(textarea, original, caret);

    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    const options = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '#assistant-provider-commands [role="option"]',
      ),
    );
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("/review");

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await flushAsyncWork();
    });

    expect(textarea.value).toBe(
      "Compare /review  with the existing /status output",
    );
    expect(textarea.selectionStart).toBe("Compare /review ".length);
    expect(textarea.selectionEnd).toBe("Compare /review ".length);
    expect(
      document.body.querySelector("#assistant-provider-commands"),
    ).toBeNull();

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await act(async () => {
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
      await flushAsyncWork();
    });
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps slash suggestions closed throughout IME composition and opens after commit", async () => {
    mocks.listCliCommands.mockResolvedValue([
      { name: "review", description: "Start review" },
    ]);

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await clickButtonByAria(
      fixture.container,
      "Assistant provider: Oxide Assistant",
    );
    await clickButtonByAria(document.body, "Use OpenAI Codex");
    await act(async () => {
      await flushAsyncWork();
    });

    const textarea =
      fixture.container.querySelector<HTMLTextAreaElement>("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      textarea.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      setter?.call(textarea, "/rev");
      textarea.setSelectionRange(4, 4);
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "/rev",
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
      await flushAsyncWork();
    });

    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.body.querySelector("#assistant-provider-commands"),
    ).toBeNull();

    await act(async () => {
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "/rev",
        }),
      );
      await flushAsyncWork();
    });

    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("/review");
  });

  it("opens one Codex-style model popover with quick reasoning and an advanced model view", async () => {
    mocks.listCliModels.mockResolvedValue([
      {
        id: "default",
        label: "Default",
        isDefault: true,
        reasoningEfforts: ["low", "medium", "high", "xhigh"],
        serviceTiers: [
          {
            id: "priority",
            name: "Fast",
            description: "1.5x speed, increased usage",
          },
        ],
      },
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        isDefault: false,
        isProviderDefault: true,
        reasoningEfforts: ["low", "medium", "high", "xhigh"],
        serviceTiers: [
          {
            id: "priority",
            name: "Fast",
            description: "1.5x speed, increased usage",
          },
        ],
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        isDefault: false,
        reasoningEfforts: ["low", "medium", "high"],
      },
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `codex-specialized-${index}`,
        label: `Codex Specialized ${index}`,
        isDefault: false,
        reasoningEfforts: ["low", "medium", "high"],
      })),
    ]);
    mocks.testAiProvider.mockResolvedValue({
      message: "CLI is installed and authenticated",
      model: "gpt-5.6-sol",
      executablePath: "C:/tools/codex.cmd",
      version: "codex 1.0.0",
    });

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await clickButtonByAria(
      fixture.container,
      "Assistant provider: Oxide Assistant",
    );
    await clickButtonByAria(document.body, "Use OpenAI Codex");
    await act(async () => {
      await flushAsyncWork();
    });

    expect(useAiSettingsStore.getState().codexCliModel).toBe("default");
    const providerTrigger = fixture.container.querySelector<HTMLButtonElement>(
      "button[data-assistant-provider]",
    );
    expect(providerTrigger?.textContent).toContain("OpenAI Codex · Ready");
    expect(providerTrigger?.textContent).not.toContain("Codex CLI · Codex CLI");

    const detectionCalls = mocks.detectCliProvider.mock.calls.length;
    const modelTrigger = findButtonByAria(
      fixture.container,
      "Assistant model: Default",
    );
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      modelTrigger.click();
      await flushAsyncWork();
    });

    expect(modelTrigger.getAttribute("aria-expanded")).toBe("true");
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    );
    expect(modelPopover).not.toBeNull();
    expect(
      document.body.querySelectorAll("[data-assistant-model-popover]"),
    ).toHaveLength(1);
    expect(modelTrigger.querySelector(".lucide-zap")).toBeNull();
    expect(modelTrigger.querySelector(".lucide-sliders-horizontal")).toBeNull();

    const quickView = modelPopover!.querySelector<HTMLElement>(
      '[data-assistant-model-view="quick"]',
    );
    expect(quickView).not.toBeNull();
    expect(quickView?.className).toMatch(/transition|animate/);
    expect(
      modelPopover!.querySelectorAll('[data-assistant-model-panel="true"]'),
    ).toHaveLength(1);
    expect(modelPopover!.className).toContain("bg-transparent");
    const quickAdvancedToggle = quickView?.querySelector<HTMLButtonElement>(
      '[data-assistant-quick-advanced-toggle="true"]',
    );
    expect(quickAdvancedToggle).not.toBeNull();
    expect(quickAdvancedToggle?.className).not.toContain("hover:bg-");
    expect(quickAdvancedToggle?.className).not.toContain("rounded-");
    const reasoningTrack = quickView?.querySelector<HTMLInputElement>(
      'input[type="range"][data-assistant-reasoning-track]',
    );
    expect(reasoningTrack).not.toBeNull();
    expect(reasoningTrack?.min).toBe("0");
    expect(reasoningTrack?.max).toBe("4");
    expect(reasoningTrack?.getAttribute("aria-label")).toBe("Reasoning effort");
    expect(reasoningTrack?.getAttribute("aria-valuetext")).toBe("Default");
    expect(quickView?.textContent).not.toContain("GPT-5.6 Terra");
    const fastToggle = quickView?.querySelector<HTMLButtonElement>(
      '[data-assistant-fast-toggle="true"]',
    );
    expect(fastToggle).not.toBeNull();
    expect(fastToggle?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      fastToggle!.click();
      await flushAsyncWork();
    });
    expect(useAiSettingsStore.getState().codexCliServiceTier).toBe("priority");
    expect(fastToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(
      quickView?.querySelector('[data-assistant-speed-tier="priority"]'),
    ).not.toBeNull();
    expect(
      quickView?.querySelector('[data-assistant-fast-particles="true"]'),
    ).not.toBeNull();
    expect(
      quickView
        ?.querySelector('[data-assistant-fast-particles="true"]')
        ?.getAttribute("data-assistant-animation-speed"),
    ).toBe("1.5x");
    expect(
      quickView?.querySelector<HTMLElement>(".wb-assistant-fast-particle")
        ?.style.animationDuration,
    ).toBe("800ms");
    await act(async () => {
      fastToggle!.click();
      await flushAsyncWork();
    });
    expect(useAiSettingsStore.getState().codexCliServiceTier).toBe("default");
    expect(
      quickView?.querySelector('[data-assistant-fast-particles="true"]'),
    ).toBeNull();

    await setRangeValue(reasoningTrack!, "3");
    expect(useAiSettingsStore.getState().codexCliReasoningEffort).toBe("high");
    expect(reasoningTrack?.getAttribute("aria-valuetext")).toBe("High");
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.querySelector("[data-assistant-model-popover]")).toBe(
      modelPopover,
    );
    expect(
      modelPopover!.querySelector("[data-assistant-fast-toggle]"),
    ).not.toBeNull();
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(detectionCalls);

    await setRangeValue(reasoningTrack!, "4");
    expect(useAiSettingsStore.getState().codexCliReasoningEffort).toBe("xhigh");
    expect(
      quickView
        ?.querySelector('[data-assistant-reasoning-animation="maximum"]')
        ?.querySelector('[data-assistant-animation-speed="standard"]'),
    ).not.toBeNull();
    expect(
      quickView?.querySelector('[data-assistant-reasoning-stop="true"]'),
    ).toBeNull();

    await clickButton(modelPopover!, "Advanced");

    const advancedView = modelPopover!.querySelector<HTMLElement>(
      '[data-assistant-model-view="advanced"]',
    );
    expect(advancedView).not.toBeNull();
    expect(advancedView?.className).toMatch(/transition|animate/);
    expect(
      document.body.querySelectorAll("[data-assistant-model-popover]"),
    ).toHaveLength(1);
    expect(document.body.querySelector("[data-assistant-model-popover]")).toBe(
      modelPopover,
    );
    expect(advancedView?.textContent).not.toContain("GPT-5.6 Terra");

    const modelListToggle = advancedView!.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle model list"]',
    );
    expect(modelListToggle).not.toBeNull();
    expect(modelListToggle?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      modelListToggle!.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await flushAsyncWork();
    });
    expect(modelListToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(
      advancedView!.querySelector('[data-assistant-submenu="model"]'),
    ).not.toBeNull();

    const modelSearch = advancedView!.querySelector<HTMLInputElement>(
      'input[placeholder="Search models"]',
    );
    expect(modelSearch).not.toBeNull();
    expect(
      advancedView!.querySelectorAll(
        '[role="radiogroup"][aria-label="Assistant model"] input[type="radio"]',
      ),
    ).toHaveLength(100);
    expect(advancedView!.textContent).toContain("Showing 100 of 123");
    await setInputValue(modelSearch!, "terra");
    expect(
      advancedView!.querySelectorAll(
        '[role="radiogroup"][aria-label="Assistant model"] input[type="radio"]',
      ),
    ).toHaveLength(1);

    const terraModel = advancedView!.querySelector<HTMLInputElement>(
      'input[type="radio"][aria-label="GPT-5.6 Terra"]',
    );
    expect(terraModel).not.toBeNull();
    await act(async () => {
      terraModel!.click();
      await flushAsyncWork();
    });
    expect(useAiSettingsStore.getState().codexCliModel).toBe("gpt-5.6-terra");
    await clickButtonByAria(advancedView!, "Reasoning effort");
    const terraReasoning = advancedView!.querySelector<HTMLInputElement>(
      'input[type="radio"][aria-label="Default"]',
    );
    expect(terraReasoning).not.toBeNull();
    expect(terraReasoning?.checked).toBe(true);
    expect(
      advancedView!.querySelector(
        'button[data-assistant-menu-trigger="speed"]',
      ),
    ).toBeNull();
    expect(useAiSettingsStore.getState().codexCliServiceTier).toBe("default");
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      modelPopover!.querySelector("[data-assistant-fast-toggle]"),
    ).toBeNull();
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(detectionCalls);

    await act(async () => {
      modelPopover!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flushAsyncWork();
    });
    expect(modelTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.body.querySelector("[data-assistant-model-popover]"),
    ).toBeNull();
    expect(document.activeElement).toBe(modelTrigger);

    await act(async () => {
      modelTrigger.click();
      await flushAsyncWork();
    });
    const reopenedPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    );
    expect(reopenedPopover).not.toBeNull();
    expect(
      reopenedPopover
        ?.querySelector('[data-assistant-model-view="quick"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("false");
    expect(
      reopenedPopover
        ?.querySelector('[data-assistant-model-view="advanced"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
