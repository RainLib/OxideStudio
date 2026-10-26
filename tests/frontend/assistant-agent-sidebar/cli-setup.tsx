import { describe, expect, it } from "vitest";
import { act, AssistantSidebar, createRoot, deferred, fixture, flushAsyncWork, clickButton, clickButtonByAria, mocksForTests as mocks, useAiSettingsStore, useAssistantCliSetupStore, ApiError } from "./harness";

describe("AssistantSidebar CLI setup", () => {
  it("does not interrupt an active login when method discovery completes late", async () => {
    useAiSettingsStore.setState({ enabled: true, provider: "codex-cli" });
    mocks.testAiProvider.mockRejectedValueOnce(new ApiError("Sign in required", "AI_CLI_AUTH_REQUIRED"));
    const methods = deferred<Array<{ id: string; name: string }>>();
    mocks.listCliAuthenticationMethods.mockReturnValueOnce(methods.promise);
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    expect(useAssistantCliSetupStore.getState().setupByProvider["codex-cli"]?.authMethodsLoading).toBe(true);
    await act(async () => {
      useAssistantCliSetupStore.getState().updateSetup("codex-cli", (current) => ({
        ...current,
        phase: "authorizing",
        message: "Opening browser",
        authenticationSessionId: "active-login",
      }));
      await flushAsyncWork();
      methods.resolve([{ id: "browser", name: "ChatGPT / Codex account" }]);
      await flushAsyncWork();
    });
    const setup = useAssistantCliSetupStore.getState().setupByProvider["codex-cli"];
    expect(setup?.phase).toBe("authorizing");
    expect(setup?.authenticationSessionId).toBe("active-login");
    expect(setup?.authMethodsLoading).toBe(false);
  });
  it("guides a missing CLI through managed install and provider authentication", async () => {
    mocks.detectCliProvider
      .mockResolvedValueOnce({
        provider: "codex-cli",
        available: false,
        message: "Codex CLI is not installed",
        executablePath: null,
        version: null,
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

  it("waits for a delayed login session before polling authentication", async () => {
    useAiSettingsStore.setState({ enabled: true, provider: "codex-cli" });
    mocks.testAiProvider.mockRejectedValueOnce(new ApiError("Sign in required", "AI_CLI_AUTH_REQUIRED"));
    const launch = deferred<{ provider: "codex-cli"; sessionId: string; message: string }>();
    mocks.beginCliAuthentication.mockReturnValueOnce(launch.promise);
    await act(async () => {
      fixture.root = createRoot(fixture.container);
      fixture.root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    await clickButton(fixture.container, "ChatGPT / Codex account");
    expect(useAssistantCliSetupStore.getState().setupByProvider["codex-cli"]?.phase).toBe("checking");
    expect(mocks.getCliAuthenticationStatus).not.toHaveBeenCalled();
    await act(async () => {
      launch.resolve({ provider: "codex-cli", sessionId: "delayed-login", message: "Opening browser" });
      await flushAsyncWork();
    });
    expect(mocks.getCliAuthenticationStatus).toHaveBeenCalledWith("delayed-login");
    expect(useAssistantCliSetupStore.getState().setupByProvider["codex-cli"]?.phase).toBe("authorizing");
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

});
