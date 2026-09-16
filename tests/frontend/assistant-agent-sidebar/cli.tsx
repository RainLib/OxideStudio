import { describe, expect, it, vi } from "vitest";
import {
  act,
  AssistantSidebar,
  baseEvent,
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

describe("AssistantSidebar Agent Host path: cli", () => {
  it("confirms Ultra access and automatically revokes Full access outside Agent mode", async () => {
    useAiSettingsStore.setState({
      provider: "codex-cli",
      enabled: true,
      codexCliAssistantMode: "agent",
      codexCliReasoningEffort: "default",
      codexCliReasoningEffortByModel: { default: "default" },
      codexCliAccessMode: "restricted",
    });
    mocks.listCliModels.mockResolvedValue([
      {
        id: "default",
        label: "Default",
        isDefault: true,
        reasoningEfforts: ["low", "ultra"],
      },
    ]);

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    const modelTrigger = findButtonByAria(
      fixture.container,
      "Assistant model: Default",
    );
    await act(async () => {
      modelTrigger.click();
      await flushAsyncWork();
    });
    let reasoningTrack = document.body.querySelector<HTMLInputElement>(
      '[data-assistant-reasoning-track="true"]',
    );
    expect(reasoningTrack?.max).toBe("2");

    await setRangeValue(reasoningTrack!, "2");
    expect(useAiSettingsStore.getState().codexCliReasoningEffort).toBe(
      "default",
    );
    expect(
      document.body.querySelector(
        '[data-assistant-ultra-access-dialog="true"]',
      ),
    ).not.toBeNull();
    await clickButton(document.body, "Continue");
    expect(useAiSettingsStore.getState().codexCliReasoningEffort).toBe("ultra");
    expect(useAiSettingsStore.getState().codexCliAccessMode).toBe("restricted");

    await act(async () => {
      useAiSettingsStore.getState().updateSettings({
        codexCliReasoningEffort: "default",
      });
      await flushAsyncWork();
      if (modelTrigger.getAttribute("aria-expanded") !== "true") {
        modelTrigger.click();
        await flushAsyncWork();
      }
    });
    reasoningTrack = document.body.querySelector<HTMLInputElement>(
      '[data-assistant-reasoning-track="true"]',
    );
    await setRangeValue(reasoningTrack!, "2");
    await clickButton(document.body, "Use Full access");

    expect(useAiSettingsStore.getState().codexCliReasoningEffort).toBe("ultra");
    expect(useAiSettingsStore.getState().codexCliAccessMode).toBe("full");
    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual(
      expect.objectContaining({
        reasoningEffort: "ultra",
        accessMode: "full",
      }),
    );

    await act(async () => {
      useAiSettingsStore.getState().updateSettings({
        codexCliAssistantMode: "plan",
      });
      await flushAsyncWork();
    });
    expect(useAiSettingsStore.getState().codexCliAccessMode).toBe("restricted");
    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual(
      expect.objectContaining({ accessMode: "restricted" }),
    );
  });

  it("deduplicates same-identity CLI catalog loads and does not reload them for model or effort changes", async () => {
    const models = deferred<
      Array<{
        id: string;
        label: string;
        isDefault: boolean;
        reasoningEfforts: string[];
      }>
    >();
    const commands = deferred<Array<{ name: string; description: string }>>();
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.listCliModels.mockReturnValue(models.promise);
    mocks.listCliCommands.mockReturnValue(commands.promise);

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(
        <>
          <AssistantSidebar />
          <AssistantSidebar />
        </>,
      );
      await flushAsyncWork();
    });

    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(1);

    await act(async () => {
      models.resolve([
        {
          id: "codex-sol",
          label: "Codex Sol",
          isDefault: false,
          isProviderDefault: true,
          reasoningEfforts: ["low", "high"],
        },
      ]);
      commands.resolve([{ name: "status", description: "Show status" }]);
      await flushAsyncWork();
    });

    const detectionCalls = mocks.detectCliProvider.mock.calls.length;
    await act(async () => {
      fixture.root!.render(
        <>
          <AssistantSidebar />
          <AssistantSidebar />
        </>,
      );
      useAiSettingsStore.setState({
        codexCliModel: "codex-sol",
        codexCliReasoningEffort: "high",
      });
      await flushAsyncWork();
    });

    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(1);
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(detectionCalls);
  });

  it("keeps CLI models non-editable while the catalog loads and exposes an actionable error", async () => {
    const models =
      deferred<Array<{ id: string; label: string; isDefault: boolean }>>();
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.listCliModels.mockReturnValue(models.promise);

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(fixture.container, "Assistant model: Default");
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    );
    expect(modelPopover).not.toBeNull();
    await clickButton(modelPopover!, "Advanced");

    expect(
      modelPopover!.querySelector(
        '[data-assistant-model-catalog-status="loading"]',
      ),
    ).not.toBeNull();
    expect(
      modelPopover!.querySelector('input[placeholder="Model identifier"]'),
    ).toBeNull();

    await act(async () => {
      models.reject(new Error("catalog offline"));
      await flushAsyncWork();
    });

    const catalogError = modelPopover!.querySelector<HTMLElement>(
      '[data-assistant-model-catalog-status="error"]',
    );
    expect(catalogError).not.toBeNull();
    expect(catalogError?.getAttribute("role")).toBe("alert");
    expect(catalogError?.textContent).toContain(
      "Provider capabilities are unavailable.",
    );
    expect(catalogError?.querySelector("summary")?.textContent).toContain(
      "Technical details",
    );
    expect(catalogError?.querySelector("details")?.open).toBe(false);
    expect(catalogError?.textContent).toContain("Retry");
    expect(
      modelPopover!.querySelector('input[placeholder="Model identifier"]'),
    ).toBeNull();
  });

  it("retains the last-known-good catalog when a refresh fails", async () => {
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.listCliModels
      .mockResolvedValueOnce([
        {
          id: "codex-sol",
          label: "Codex Sol",
          isDefault: false,
          isProviderDefault: true,
          reasoningEfforts: ["low", "high"],
        },
      ])
      .mockRejectedValueOnce(new Error("model refresh failed"));
    mocks.listCliCommands
      .mockRejectedValueOnce(new Error("command catalog failed"))
      .mockRejectedValueOnce(new Error("command refresh failed"));

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(fixture.container, "Assistant model: Default");
    const detectionCalls = mocks.detectCliProvider.mock.calls.length;
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    )!;
    expect(
      modelPopover.querySelector(
        '[data-assistant-model-catalog-status="ready"]',
      )?.textContent,
    ).toContain("Some provider capabilities could not refresh");
    await clickButton(modelPopover, "Advanced");
    await clickButtonByAria(modelPopover, "Toggle model list");
    expect(
      modelPopover.querySelector('input[aria-label="Codex Sol"]'),
    ).not.toBeNull();

    await clickButton(
      modelPopover.querySelector<HTMLElement>(
        '[data-assistant-model-catalog-status="ready"]',
      )!,
      "Retry",
    );
    await act(async () => {
      await flushAsyncWork();
    });

    expect(mocks.listCliModels).toHaveBeenCalledTimes(2);
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(detectionCalls);
    const refreshError = modelPopover.querySelector<HTMLElement>(
      '[data-assistant-model-catalog-status="error"]',
    );
    expect(refreshError).toBeNull();
    const staleCatalog = modelPopover.querySelector<HTMLElement>(
      '[data-assistant-model-catalog-status="ready"]',
    );
    expect(staleCatalog?.textContent).toContain(
      "Some provider capabilities could not refresh",
    );
    expect(staleCatalog?.textContent).toContain("model refresh failed");
    expect(staleCatalog?.textContent).toContain("Retry");
    expect(
      modelPopover.querySelector('input[aria-label="Codex Sol"]'),
    ).not.toBeNull();
    expect(
      modelPopover.querySelector('input[placeholder="Model identifier"]'),
    ).toBeNull();
  });

  it("ignores a late catalog result after the CLI provider identity changes", async () => {
    const lateCodexModels =
      deferred<Array<{ id: string; label: string; isDefault: boolean }>>();
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });
    mocks.detectCliProvider.mockImplementation(async (config) => ({
      provider: config.kind,
      available: true,
      executablePath:
        config.kind === "codex-cli"
          ? "C:/tools/codex.cmd"
          : "C:/tools/codebuddy.cmd",
      version: "1.0.0",
      message: "CLI is available",
    }));
    mocks.testAiProvider.mockImplementation(async (config) => ({
      message: "CLI is installed and authenticated",
      model: "default",
      executablePath: config.executablePath,
      version: "1.0.0",
    }));
    mocks.listCliModels.mockImplementation((config) =>
      config.kind === "codex-cli"
        ? lateCodexModels.promise
        : Promise.resolve([
            {
              id: "buddy-model",
              label: "Buddy Model",
              isDefault: false,
              isProviderDefault: true,
            },
          ]),
    );

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);

    await clickButtonByAria(
      fixture.container,
      "Assistant provider: OpenAI Codex",
    );
    await clickButtonByAria(document.body, "Use CodeBuddy Code");
    await act(async () => {
      await flushAsyncWork();
    });
    expect(mocks.listCliModels).toHaveBeenCalledTimes(2);

    await clickButtonByAria(fixture.container, "Assistant model: Default");
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    )!;
    await clickButton(modelPopover, "Advanced");
    await clickButtonByAria(modelPopover, "Toggle model list");
    expect(
      modelPopover.querySelector('input[aria-label="Buddy Model"]'),
    ).not.toBeNull();

    await act(async () => {
      lateCodexModels.resolve([
        { id: "late-codex", label: "Late Codex", isDefault: true },
      ]);
      await flushAsyncWork();
    });

    expect(
      modelPopover.querySelector('input[aria-label="Buddy Model"]'),
    ).not.toBeNull();
    expect(modelPopover.textContent).not.toContain("Late Codex");
  });

  it("loads CodeBuddy reasoning capability for the selected model without reloading its model catalog", async () => {
    useAiSettingsStore.setState({
      provider: "codebuddy-cli",
      enabled: true,
      codeBuddyCliReasoningEffort: "enabled",
      codeBuddyCliReasoningEffortByModel: { default: "enabled" },
    });
    mocks.detectCliProvider.mockImplementation(async (config) => ({
      provider: config.kind,
      available: true,
      executablePath: "C:/tools/codebuddy.cmd",
      version: "1.0.0",
      message: "CodeBuddy CLI is available",
    }));
    mocks.testAiProvider.mockImplementation(async (config) => ({
      message: "CLI is installed and authenticated",
      model: config.model,
      executablePath: config.executablePath,
      version: "1.0.0",
    }));
    mocks.listCliModels.mockResolvedValue([
      { id: "default", label: "Default", isDefault: true },
      { id: "buddy-sol", label: "Buddy Sol", isDefault: false },
      { id: "buddy-terra", label: "Buddy Terra", isDefault: false },
    ]);
    mocks.listCliEfforts.mockImplementation(async (config) =>
      config.model === "buddy-terra"
        ? ["enabled", "minimal", "max"]
        : ["enabled", "low", "medium"],
    );

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliEfforts).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "codebuddy-cli", model: "default" }),
      { runtimeVersion: "1.0.0", forceRefresh: false },
    );

    await clickButtonByAria(fixture.container, "Assistant model: Default");
    expect(
      findButtonByAria(fixture.container, "Assistant model: Default")
        .textContent,
    ).not.toContain("Enabled");
    const modelPopover = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    )!;
    await clickButton(modelPopover, "Advanced");
    await clickButtonByAria(modelPopover, "Toggle model list");
    const terra = modelPopover.querySelector<HTMLInputElement>(
      'input[aria-label="Buddy Terra"]',
    );
    expect(terra).not.toBeNull();
    await act(async () => {
      terra!.click();
      await flushAsyncWork();
    });

    expect(useAiSettingsStore.getState().codeBuddyCliModel).toBe("buddy-terra");
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliEfforts).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "codebuddy-cli", model: "buddy-terra" }),
      { runtimeVersion: "1.0.0", forceRefresh: false },
    );
    const reasoningTrack = modelPopover.querySelector<HTMLInputElement>(
      "input[data-assistant-reasoning-track]",
    );
    expect(reasoningTrack?.max).toBe("2");
    expect(modelPopover.textContent).not.toContain("Enabled");
    await act(async () => {
      modelPopover
        .querySelector<HTMLButtonElement>("[data-assistant-advanced-toggle]")
        ?.click();
      await flushAsyncWork();
    });
    await setRangeValue(reasoningTrack!, "2");
    expect(useAiSettingsStore.getState().codeBuddyCliReasoningEffort).toBe(
      "max",
    );
    expect(
      modelPopover.querySelector(
        '[data-assistant-reasoning-animation="maximum"] [data-assistant-animation-speed="standard"]',
      ),
    ).not.toBeNull();
    expect(
      modelPopover.querySelector<HTMLElement>(".wb-assistant-fast-particle")
        ?.style.animationDuration,
    ).toBe("1200ms");
    expect(
      modelPopover.querySelector('[data-assistant-reasoning-stop="true"]'),
    ).toBeNull();
    expect(
      modelPopover.querySelector("[data-assistant-fast-toggle]"),
    ).toBeNull();
  });

  it("keeps the conversation surface mounted while a ready CLI is revalidated", async () => {
    const detection = deferred<{
      provider: "codex-cli";
      available: boolean;
      executablePath: string;
      version: string;
      message: string;
    }>();
    mocks.detectCliProvider.mockReturnValueOnce(detection.promise);

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

    expect(fixture.container.textContent).not.toContain("Set up Codex CLI");
    expect(fixture.container.querySelector("textarea")).not.toBeNull();
    expect(
      fixture.container
        .querySelector("button[data-assistant-provider]")
        ?.getAttribute("title"),
    ).toContain("Verifying CLI");

    await act(async () => {
      detection.resolve({
        provider: "codex-cli",
        available: true,
        executablePath: "C:/tools/codex.cmd",
        version: "codex 1.0.0",
        message: "Codex CLI is available",
      });
      await flushAsyncWork();
    });

    expect(fixture.container.textContent).not.toContain("Set up Codex CLI");
    expect(fixture.container.querySelector("textarea")).not.toBeNull();
  });

  it("keeps a verified CLI ready when the Assistant panel remounts", async () => {
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(1);
    expect(fixture.container.querySelector("textarea")).not.toBeNull();

    await act(async () => fixture.root?.unmount());
    fixture.root = null;
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(1);
    expect(fixture.container.querySelector("textarea")).not.toBeNull();
    expect(fixture.container.textContent).not.toContain("Set up Codex CLI");
  });

  it("revalidates a CLI provider after its probe TTL expires", async () => {
    vi.useFakeTimers();
    useAiSettingsStore.setState({ provider: "codex-cli", enabled: true });

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(1);

    await act(async () => fixture.root?.unmount());
    fixture.root = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000 + 1);
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.detectCliProvider).toHaveBeenCalledTimes(2);
  });

  it("guides a missing CLI through managed install and provider authentication", async () => {
    mocks.detectCliProvider
      .mockResolvedValueOnce({
        provider: "codex-cli",
        available: false,
        message: "Codex CLI is not installed",
      })
      .mockResolvedValueOnce({
        provider: "codex-cli",
        available: true,
        executablePath: "C:/managed/codex.cmd",
        version: "codex 1.0.0",
        message: "Codex CLI is available",
      });
    mocks.testAiProvider.mockRejectedValueOnce(
      new ApiError(
        "Provider-specific diagnostic that does not need an English auth regex",
        "AI_CLI_AUTH_REQUIRED",
      ),
    );

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

    expect(fixture.container.textContent).toContain("Set up Codex CLI");
    expect(fixture.container.textContent).toContain("Install for OxideStudio");

    await clickButton(fixture.container, "Install for OxideStudio");
    await act(async () => {
      await flushAsyncWork();
    });

    expect(mocks.beginCliInstallation).toHaveBeenCalledWith("codex-cli");
    expect(mocks.getCliInstallationStatus).toHaveBeenCalledWith(
      "install-session-1",
    );
    expect(useAiSettingsStore.getState().codexCliPath).toBe(
      "C:/managed/codex.cmd",
    );
    await act(async () => {
      await flushAsyncWork();
    });
    expect(fixture.container.textContent).toContain("ChatGPT / Codex account");

    await clickButton(fixture.container, "ChatGPT / Codex account");
    expect(mocks.beginCliAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "codex-cli",
        executablePath: "C:/managed/codex.cmd",
      }),
      "browser",
    );
    expect(fixture.container.textContent).toContain(
      "Complete sign-in in your browser",
    );
  });

  it("keeps provider diagnostics behind the localized setup status", async () => {
    mocks.detectCliProvider.mockResolvedValue({
      provider: "codex-cli",
      available: false,
      message: "npm failed to start at C:/Users/example/AppData/Local/nvm/npm",
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

    const status = fixture.container.querySelector(
      "[data-assistant-cli-setup='missing'] [role='status']",
    );
    expect(status?.querySelector("p")?.textContent).toBe(
      "CLI installation is required.",
    );
    expect(status?.querySelector("summary")?.textContent).toBe(
      "Technical details",
    );
    expect(status?.querySelector("details")?.open).toBe(false);
  });

  it("returns to account authorization when a completed browser flow still fails the CLI probe", async () => {
    mocks.getCliAuthenticationStatus.mockResolvedValue({
      sessionId: "auth-session-1",
      provider: "codex-cli",
      phase: "succeeded",
      message: "Browser sign-in completed",
      methodId: "browser",
    });
    mocks.testAiProvider
      .mockRejectedValueOnce(
        new ApiError(
          "The provider needs a browser sign-in",
          "AI_CLI_AUTH_REQUIRED",
        ),
      )
      .mockRejectedValueOnce(
        new ApiError(
          "The provider did not grant CLI access yet",
          "AI_CLI_AUTH_REQUIRED",
        ),
      );

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

    await clickButton(fixture.container, "ChatGPT / Codex account");
    await act(async () => {
      await flushAsyncWork();
    });

    expect(fixture.container.textContent).toContain("Set up Codex CLI");
    expect(fixture.container.textContent).toContain(
      "Sign-in completed, but the CLI still needs account access",
    );
    expect(fixture.container.textContent).toContain("ChatGPT / Codex account");
    expect(fixture.container.querySelector("textarea")).toBeNull();
  });

  it("reattaches an active managed CLI installation after the Assistant panel remounts", async () => {
    mocks.detectCliProvider.mockResolvedValue({
      provider: "codex-cli",
      available: false,
      message: "Codex CLI is not installed",
    });
    mocks.beginCliInstallation.mockResolvedValue({
      provider: "codex-cli",
      sessionId: "install-session-remount",
      message: "Downloading Codex CLI",
    });
    mocks.getCliInstallationStatus.mockResolvedValue({
      provider: "codex-cli",
      sessionId: "install-session-remount",
      phase: "downloading",
      message: "Downloading Codex CLI",
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

    await clickButton(fixture.container, "Install for OxideStudio");
    await act(async () => {
      await flushAsyncWork();
    });
    expect(mocks.beginCliInstallation).toHaveBeenCalledTimes(1);
    expect(mocks.getCliInstallationStatus).toHaveBeenCalledWith(
      "install-session-remount",
    );

    await act(async () => fixture.root?.unmount());
    fixture.root = null;
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(mocks.beginCliInstallation).toHaveBeenCalledTimes(1);
    expect(mocks.getCliInstallationStatus).toHaveBeenCalledTimes(2);
    expect(fixture.container.textContent).toContain("Downloading Codex CLI");
  });

  it("manages the model from the composer without an extra settings action", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await clickButtonByAria(fixture.container, "Assistant model: agent-model");
    const modelPanel = document.body.querySelector<HTMLElement>(
      "[data-assistant-model-popover]",
    );
    expect(modelPanel).not.toBeNull();
    await clickButton(modelPanel!, "Advanced");
    await clickButtonByAria(modelPanel!, "Toggle model list");
    const modelInput = modelPanel!.querySelector<HTMLInputElement>(
      'input[placeholder="Model identifier"]',
    );
    expect(modelInput).not.toBeNull();
    await setInputValue(modelInput!, "agent-model-v2");
    await clickButton(document.body, "Apply");
    expect(useAiSettingsStore.getState().model).toBe("agent-model-v2");
    expect(
      fixture.container.querySelector("header")?.textContent,
    ).not.toContain("agent-model-v2");

    expect(
      findButtonByAria(
        fixture.container,
        "Assistant model: agent-model-v2",
      ).getAttribute("aria-expanded"),
    ).toBe("true");
    await clickButtonByAria(modelPanel!, "Toggle model list");
    expect(
      modelPanel!.querySelector('button[aria-label="Settings"]'),
    ).toBeNull();
  });

  it("blocks tool modes when the model cannot call tools but keeps Chat usable", async () => {
    useAiSettingsStore.setState({ toolCalling: false, assistantMode: "agent" });
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    await submitPrompt(fixture.container, "Inspect the database", "Run agent");
    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(fixture.container.textContent).toContain(
      "Agent mode requires a model with tool calling",
    );

    await act(async () => {
      useAiSettingsStore.getState().updateSettings({ assistantMode: "chat" });
      await flushAsyncWork();
    });
    await submitPrompt(fixture.container, "Explain normalization", "Send");
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    expect(mocks.startTurn.mock.calls[0]?.[0].profile).toBe("chat");
  });

  it("treats an empty capability list as a starting runtime instead of rejecting Plan", async () => {
    useAiSettingsStore.setState({ assistantMode: "plan", toolCalling: true });
    mocks.getStatus.mockResolvedValue({
      protocolVersion: 1,
      available: false,
      state: "starting",
      capabilities: [],
      storageMode: "project",
      binaryPath: "/tmp/oxide-agent-host",
      lastError: null,
    });

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    expect(
      fixture.container.querySelector(
        'button[aria-label*="Starting AI runtime"]',
      ),
    ).not.toBeNull();
    expect(fixture.container.textContent).not.toContain(
      "The AI runtime does not support Plan mode",
    );
  });

  it("keeps polling a starting runtime until the sidecar becomes ready", async () => {
    vi.useFakeTimers();
    mocks.getStatus
      .mockResolvedValueOnce({
        protocolVersion: 1,
        available: false,
        state: "starting",
        capabilities: [],
        storageMode: "project",
        binaryPath: "/tmp/oxide-agent-host",
        lastError: null,
      })
      .mockResolvedValue({
        protocolVersion: 1,
        available: true,
        state: "ready",
        capabilities: ["chat", "plan", "agent"],
        storageMode: "project",
        binaryPath: "/tmp/oxide-agent-host",
        lastError: null,
      });

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await flushAsyncWork();
    });

    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(
      fixture.container.querySelector(
        'button[aria-label*="Starting AI runtime"]',
      ),
    ).toBeNull();
  });

  it("does not reject Plan when a transitional host has not published capabilities", async () => {
    useAiSettingsStore.setState({ assistantMode: "plan", toolCalling: true });
    mocks.getStatus.mockResolvedValue({
      protocolVersion: 1,
      available: true,
      state: "starting",
      capabilities: [],
      storageMode: "project",
      binaryPath: "/tmp/oxide-agent-host",
      lastError: null,
    });

    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(
      fixture.container,
      "Explain the active SQL",
      "Create plan",
    );

    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(fixture.container.textContent).toContain(
      "has not published its installed tool catalog",
    );
    expect(fixture.container.textContent).not.toContain(
      "The AI runtime does not support Plan mode",
    );
  });

  it("surfaces a 401 at the model control and allows an explicit retry", async () => {
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root!.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await submitPrompt(fixture.container, "Inspect the database", "Run agent");
    const request = mocks.startTurn.mock.calls[0]?.[0];

    await emit({
      ...baseEvent(request.threadId, request.turnId, 1),
      type: "failure",
      code: "provider_authentication_failed",
      message: "401 Unauthorized: invalid API key",
      retryable: false,
    });

    expect(
      fixture.container.querySelector(
        'button[aria-label*="Authentication failed"]',
      ),
    ).not.toBeNull();
    await submitPrompt(fixture.container, "Try again", "Run agent");
    expect(mocks.startTurn).toHaveBeenCalledTimes(1);

    await clickButtonByAria(fixture.container, "Assistant model: agent-model");
    await clickButton(document.body, "Retry");
    await submitPrompt(fixture.container, "Try again", "Run agent");
    expect(mocks.startTurn).toHaveBeenCalledTimes(2);
  });
});
