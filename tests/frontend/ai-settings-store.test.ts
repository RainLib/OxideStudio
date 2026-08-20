import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CODEBUDDY_CLI_PROFILE_ID,
  DEFAULT_CODEX_CLI_PROFILE_ID,
  migratePersistedAiSettings,
  useAiSettingsStore,
} from "@/store/useAiSettingsStore";

describe("AI settings provider channels", () => {
  beforeEach(() => {
    useAiSettingsStore.setState({
      enabled: true,
      provider: "openai-compatible",
      baseUrl: "https://assistant.example/v1",
      model: "assistant-model",
      inlineBaseUrl: "https://inline.example/v1",
      inlineCompletionModel: "inline-model",
      inlineCompletionProtocol: "text-completions-fim",
      codexCliProfileId: DEFAULT_CODEX_CLI_PROFILE_ID,
      codexCliPath: "codex",
      codexCliModel: "gpt-cli",
      codexCliReasoningEffort: "high",
      codexCliReasoningEffortByModel: { "gpt-cli": "high" },
      codexCliServiceTier: "default",
      codexCliAccessMode: "restricted",
      codexCliEnvironmentKeys: ["HTTPS_PROXY"],
    });
  });

  it("migrates a legacy HTTP profile into independent Assistant and inline defaults", () => {
    const migrated = migratePersistedAiSettings(
      {
        enabled: true,
        baseUrl: "https://legacy.example/v1",
        model: "legacy-model",
      },
      1,
    );

    expect(migrated).toEqual(
      expect.objectContaining({
        provider: "openai-compatible",
        baseUrl: "https://legacy.example/v1",
        model: "legacy-model",
        inlineBaseUrl: "https://legacy.example/v1",
        inlineCompletionModel: "legacy-model",
        codexCliProfileId: DEFAULT_CODEX_CLI_PROFILE_ID,
        codeBuddyCliProfileId: DEFAULT_CODEBUDDY_CLI_PROFILE_ID,
      }),
    );
  });

  it("selecting Codex CLI leaves inline completion on its HTTP profile", () => {
    useAiSettingsStore.getState().updateSettings({ provider: "codex-cli" });

    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual({
      kind: "codex-cli",
      profileId: DEFAULT_CODEX_CLI_PROFILE_ID,
      executablePath: "codex",
      model: "gpt-cli",
      reasoningEffort: "high",
      serviceTier: "default",
      accessMode: "restricted",
      timeoutMs: useAiSettingsStore.getState().timeoutMs,
      environmentKeys: ["HTTPS_PROXY"],
    });
    expect(useAiSettingsStore.getState().inlineProviderConfig()).toEqual({
      kind: "openai-compatible",
      baseUrl: "https://inline.example/v1",
      model: "inline-model",
      timeoutMs: useAiSettingsStore.getState().inlineTimeoutMs,
    });
  });

  it("only emits Full access for Codex Agent turns using Ultra", () => {
    useAiSettingsStore.getState().updateSettings({
      provider: "codex-cli",
      codexCliAssistantMode: "agent",
      codexCliReasoningEffort: "ultra",
      codexCliAccessMode: "full",
    });

    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual(
      expect.objectContaining({
        kind: "codex-cli",
        reasoningEffort: "ultra",
        accessMode: "full",
      }),
    );

    useAiSettingsStore.getState().updateSettings({
      codexCliAssistantMode: "plan",
    });
    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual(
      expect.objectContaining({ accessMode: "restricted" }),
    );

    useAiSettingsStore.getState().updateSettings({
      codexCliAssistantMode: "agent",
      codexCliReasoningEffort: "high",
    });
    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual(
      expect.objectContaining({ accessMode: "restricted" }),
    );
  });

  it("migrates and preserves an independent mode for each Assistant provider", () => {
    const migrated = migratePersistedAiSettings(
      { assistantMode: "plan" },
      2,
    );
    expect(migrated).toEqual(
      expect.objectContaining({
        assistantMode: "plan",
        codexCliAssistantMode: "plan",
        codeBuddyCliAssistantMode: "plan",
      }),
    );

    useAiSettingsStore.getState().updateSettings({
      assistantMode: "chat",
      codexCliAssistantMode: "agent",
      codeBuddyCliAssistantMode: "plan",
    });
    expect(useAiSettingsStore.getState()).toEqual(
      expect.objectContaining({
        assistantMode: "chat",
        codexCliAssistantMode: "agent",
        codeBuddyCliAssistantMode: "plan",
      }),
    );
  });

  it("migrates legacy CLI effort and retains separate reasoning choices per model", () => {
    const migrated = migratePersistedAiSettings(
      {
        codexCliModel: "gpt-legacy",
        codexCliReasoningEffort: "high",
        codeBuddyCliModel: "buddy-legacy",
        codeBuddyCliReasoningEffort: "medium",
      },
      3,
    );
    expect(migrated).toEqual(
      expect.objectContaining({
        codexCliReasoningEffortByModel: { "gpt-legacy": "high" },
        codeBuddyCliReasoningEffortByModel: { "buddy-legacy": "medium" },
      }),
    );

    useAiSettingsStore.getState().updateSettings({ provider: "codex-cli" });
    useAiSettingsStore.getState().updateSettings({
      codexCliModel: "gpt-fast",
      codexCliReasoningEffort: "low",
    });
    useAiSettingsStore.getState().updateSettings({
      codexCliModel: "gpt-deep",
      codexCliReasoningEffort: "high",
    });
    useAiSettingsStore.getState().updateSettings({
      codexCliModel: "gpt-fast",
    });

    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual(
      expect.objectContaining({
        model: "gpt-fast",
        reasoningEffort: "low",
      }),
    );
    expect(
      useAiSettingsStore.getState().codexCliReasoningEffortByModel,
    ).toEqual(expect.objectContaining({ "gpt-fast": "low", "gpt-deep": "high" }));

    useAiSettingsStore.getState().updateSettings({
      codexCliModel: "gpt-new",
    });
    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual(
      expect.objectContaining({
        model: "gpt-new",
        reasoningEffort: "default",
      }),
    );
  });
});
